import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { calendarDateInTimeZone, captureDocumentConfigurationSnapshot } from "@/lib/configuration/service";
import { quotationStatusSchema } from "@/lib/validation/quotation";
import { auditQuotationChange, normalizeStoredJson, QuotationValidationError, quoteSnapshotObject } from "@/lib/finance/quotation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ quotationId: string }> };
function dateText(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function POST(request: NextRequest, context: Context) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("quotations:write");
    const { quotationId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(quotationId)) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "quotationId must be a UUID." } }, 400);
    const input = quotationStatusSchema.parse(await request.json());
    if (["REJECTED", "CANCELLED", "EXPIRED"].includes(input.status) && !input.reason?.trim()) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "A reason is required for rejection, cancellation or expiry." } }, 422);
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.execute<(RowDataPacket & {
      id: string; legal_entity_id: string; brand_id: string | null; customer_id: string; status: string;
      record_version: number; issue_date: Date | string | null; valid_until: Date | string | null;
      quotation_number: string | null; currency: string; time_zone: string | null;
    })[]>(
      "SELECT q.id,q.legal_entity_id,q.brand_id,q.customer_id,q.status,q.record_version,q.issue_date,q.valid_until,q.quotation_number,q.currency,le.time_zone FROM quotations q JOIN legal_entities le ON le.id=q.legal_entity_id WHERE q.id=? LIMIT 1 FOR UPDATE",
      [quotationId],
    );
    if (!rows.length || !actor.legalEntityIds.includes(rows[0].legal_entity_id)) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Quotation not found in your assigned scope." } }, 404);
    }
    const row = rows[0];
    if (Number(row.record_version) !== input.expectedVersion) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "VERSION_CONFLICT", message: "This quotation changed. Reload it before changing status." } }, 409);
    }
    const today = calendarDateInTimeZone(row.time_zone);
    if (today === null) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "CONFIGURATION_NOT_READY", message: "The legal entity timezone is invalid; quotation validity cannot be evaluated safely." } }, 409);
    }
    const validUntil = dateText(row.valid_until);
    const expired = validUntil !== null && validUntil < today;
    const current = row.status;
    const target = input.status;
    const allowed =
      (current === "DRAFT" && target === "SENT" && !expired) ||
      (current === "DRAFT" && target === "CANCELLED") ||
      (current === "SENT" && ["ACCEPTED", "REJECTED", "CANCELLED"].includes(target) && !expired) ||
      (current === "SENT" && target === "EXPIRED" && expired);
    if (!allowed) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "INVALID_STATUS_TRANSITION", message: "This quotation cannot make that status transition. Refresh the quotation and check its current status and validity date." } }, 409);
    }
    let quotationNumber = row.quotation_number;
    let issueDate = dateText(row.issue_date);
    let customerSnapshot: unknown = null;
    let supplierSnapshot: unknown = null;
    if (target === "SENT") {
      const [entities] = await conn.execute<(RowDataPacket & { id: string })[]>(
        "SELECT id FROM legal_entities WHERE id=? AND is_active=TRUE LIMIT 1 FOR UPDATE", [row.legal_entity_id],
      );
      if (!entities.length) throw new QuotationValidationError("An active legal entity is required before sending a quotation.");
      // Reuse the business date computed from the locked entity row so a midnight boundary
      // cannot produce a different date halfway through this transition.
      issueDate = today;
      const [customerRows] = await conn.execute<(RowDataPacket & {
        id: string; name: string; email: string | null; phone: string | null; billing_address_json: unknown; tax_identifier: string | null;
      })[]>(
        "SELECT id,name,email,phone,billing_address_json,tax_identifier FROM customers WHERE id=? AND is_active=TRUE LIMIT 1 FOR UPDATE", [row.customer_id],
      );
      if (!customerRows.length) throw new QuotationValidationError("An active customer record is required before sending a quotation.");
      const [lines] = await conn.execute<(RowDataPacket & { tax_rule_id: string | null; tax_registration_id: string | null })[]>(
        "SELECT tax_rule_id,tax_registration_id FROM quotation_lines WHERE quotation_id=? ORDER BY line_number FOR UPDATE", [quotationId],
      );
      if (!lines.length) throw new QuotationValidationError("A quotation must contain at least one line before it can be sent.");
      const taxRuleIds = [...new Set(lines.map(line => line.tax_rule_id).filter((v): v is string => Boolean(v)))];
      const taxRegistrationIds = [...new Set(lines.map(line => line.tax_registration_id).filter((v): v is string => Boolean(v)))];
      const snapshot = await captureDocumentConfigurationSnapshot(conn, {
        resourceType: "QUOTATION", resourceId: quotationId, legalEntityId: row.legal_entity_id,
        brandId: row.brand_id, documentDate: issueDate, actorId: actor.userId, taxRuleIds, taxRegistrationIds,
      });
      const [snapshotRows] = await conn.execute<(RowDataPacket & { configuration_snapshot: unknown })[]>(
        "SELECT configuration_snapshot FROM document_configuration_snapshots WHERE id=? LIMIT 1", [snapshot.snapshotId],
      );
      if (!snapshotRows.length) throw new QuotationValidationError("The quotation configuration snapshot could not be reloaded.");
      const config = quoteSnapshotObject(snapshotRows[0].configuration_snapshot);
      const supplier = quoteSnapshotObject(config.legalEntity);
      delete supplier.bankDetails;
      supplierSnapshot = supplier;
      const customer = customerRows[0];
      customerSnapshot = {
        customerId: customer.id, name: customer.name, email: customer.email, phone: customer.phone,
        billingAddress: normalizeStoredJson(customer.billing_address_json), taxIdentifier: customer.tax_identifier,
      };
      quotationNumber = snapshot.invoiceNumber;
    }
    const [updated] = await conn.execute<ResultSetHeader>(
      `UPDATE quotations SET status=?,quotation_number=?,issue_date=?,customer_snapshot=COALESCE(?,customer_snapshot),
        supplier_snapshot=COALESCE(?,supplier_snapshot),record_version=record_version+1,updated_by=?
       WHERE id=? AND status=? AND record_version=?`,
      [target,quotationNumber,issueDate,customerSnapshot===null?null:JSON.stringify(customerSnapshot),
        supplierSnapshot===null?null:JSON.stringify(supplierSnapshot),actor.userId,quotationId,current,input.expectedVersion],
    );
    if (updated.affectedRows !== 1) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "VERSION_CONFLICT", message: "Quotation state changed while updating. Refresh and retry." } }, 409);
    }
    await auditQuotationChange(conn, actor.userId, quotationId, "quotation.status.changed", "Quotation status changed",
      { status: current, recordVersion: input.expectedVersion },
      { status: target, recordVersion: input.expectedVersion + 1, quotationNumber, reason: input.reason ?? null });
    await conn.commit();
    return jsonNoStore({ data: {
      id: quotationId, status: target, quotationNumber, issueDate, validUntil,
      recordVersion: input.expectedVersion + 1,
      message: target === "SENT"
        ? "Quotation marked sent. Its approved numbering and configuration snapshot are saved; PDF generation and email delivery are not yet available."
        : `Quotation status updated to ${target.toLowerCase()}.`,
    } });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    if (error instanceof QuotationValidationError) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: error.message } }, 422);
    return apiError(error);
  } finally { conn?.release(); }
}
