import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { subtractMoney } from "@/lib/finance/invoice-calculation";
import { isQuotationExpired } from "@/lib/finance/quotation-expiry";
import { InvoiceDraftValidationError } from "@/lib/finance/invoice-draft-service";
import { quotationUpdateSchema } from "@/lib/validation/quotation";
import {
  auditQuotationChange, persistQuotationLines, prepareQuotationLines, QuotationValidationError,
  validateQuotationContext,
} from "@/lib/finance/quotation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ quotationId: string }> };
function dateText(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}
function validationError(error: unknown) {
  if (error instanceof QuotationValidationError || error instanceof InvoiceDraftValidationError) {
    return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: error.message } }, 422);
  }
  return apiError(error);
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const actor = await requirePermission("quotations:read");
    const { quotationId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(quotationId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "quotationId must be a UUID." } }, 400);
    }
    const [rows] = await pool.execute<(RowDataPacket & {
      id: string; legal_entity_id: string; brand_id: string | null; customer_id: string; customer_name: string;
      quotation_number: string | null; status: string; record_version: number; issue_date: Date | string | null;
      valid_until: Date | string | null; currency: string; subtotal: string; discount_total: string; tax_total: string;
      grand_total: string; notes: string | null; payment_terms_days: number | null; time_zone: string | null; customer_snapshot: unknown;
      supplier_snapshot: unknown; converted_invoice_id: string | null; created_at: Date | string; updated_at: Date | string;
    })[]>(
      `SELECT q.id,q.legal_entity_id,q.brand_id,q.customer_id,c.name AS customer_name,q.quotation_number,q.status,
        q.record_version,q.issue_date,q.valid_until,q.currency,q.subtotal,q.discount_total,q.tax_total,q.grand_total,
        q.notes,q.payment_terms_days,le.time_zone,q.customer_snapshot,q.supplier_snapshot,q.converted_invoice_id,q.created_at,q.updated_at
       FROM quotations q JOIN customers c ON c.id=q.customer_id
       JOIN legal_entities le ON le.id=q.legal_entity_id WHERE q.id=? LIMIT 1`,
      [quotationId],
    );
    if (!rows.length || !actor.legalEntityIds.includes(rows[0].legal_entity_id)) {
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Quotation not found in your assigned scope." } }, 404);
    }
    const [lineRows] = await pool.execute<(RowDataPacket & {
      id: string; catalog_item_id: string | null; line_kind: string; description: string; unit_code: string;
      quantity: string; unit_price: string; discount_amount: string; discount_type: string; discount_value: string;
      tax_code: string | null; tax_rule_id: string | null; tax_registration_id: string | null; tax_rate: string;
      tax_calculation_mode: string; tax_amount: string; line_total: string;
    })[]>(
      `SELECT id,catalog_item_id,line_kind,description,unit_code,quantity,unit_price,discount_amount,
        discount_type,discount_value,tax_code,tax_rule_id,tax_registration_id,tax_rate,tax_calculation_mode,tax_amount,line_total
       FROM quotation_lines WHERE quotation_id=? ORDER BY line_number`,
      [quotationId],
    );
    const row = rows[0];
    const validUntil = dateText(row.valid_until);
    const expired = isQuotationExpired(validUntil, row.time_zone);
    const status = row.status === "SENT" && expired === true ? "EXPIRED" : row.status;
    return jsonNoStore({ data: {
      id: row.id, legalEntityId: row.legal_entity_id, brandId: row.brand_id, customerId: row.customer_id,
      customerName: row.customer_name, quotationNumber: row.quotation_number, status,
      issueDate: dateText(row.issue_date), validUntil, currency: row.currency,
      subtotal: String(row.subtotal), discountTotal: String(row.discount_total),
      taxableValue: subtractMoney(String(row.subtotal), String(row.discount_total)),
      taxTotal: String(row.tax_total), grandTotal: String(row.grand_total),
      notes: row.notes, paymentTermsDays: row.payment_terms_days === null ? 0 : Number(row.payment_terms_days),
      recordVersion: Number(row.record_version), convertedInvoiceId: row.converted_invoice_id,
      customerSnapshot: parseJson(row.customer_snapshot), supplierSnapshot: parseJson(row.supplier_snapshot),
      createdAt: row.created_at, updatedAt: row.updated_at,
      lines: lineRows.map(line => ({
        id: line.id, catalogItemId: line.catalog_item_id, lineKind: line.line_kind, description: line.description,
        unitCode: line.unit_code, quantity: String(line.quantity), unitPrice: String(line.unit_price),
        discountAmount: String(line.discount_amount), discountType: line.discount_type, discountValue: String(line.discount_value),
        taxCode: line.tax_code, taxRuleId: line.tax_rule_id, taxRegistrationId: line.tax_registration_id,
        taxRatePercent: String(line.tax_rate), taxCalculationMode: line.tax_calculation_mode,
        taxAmount: String(line.tax_amount), lineTotal: String(line.line_total),
      })),
    } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("quotations:write");
    const { quotationId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(quotationId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "quotationId must be a UUID." } }, 400);
    }
    const input = quotationUpdateSchema.parse(await request.json());
    const { expectedVersion, ...fields } = input;
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [existing] = await conn.execute<(RowDataPacket & {
      id: string; legal_entity_id: string; status: string; record_version: number; quotation_number: string | null;
    })[]>(
      "SELECT id,legal_entity_id,status,record_version,quotation_number FROM quotations WHERE id=? LIMIT 1 FOR UPDATE",
      [quotationId],
    );
    if (!existing.length || !actor.legalEntityIds.includes(existing[0].legal_entity_id)) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Quotation not found in your assigned scope." } }, 404);
    }
    const row = existing[0];
    if (row.status !== "DRAFT") {
      await conn.rollback();
      return jsonNoStore({ error: { code: "QUOTATION_NOT_EDITABLE", message: "Only quotation drafts can be edited. Sent quotations keep their historical values." } }, 409);
    }
    if (Number(row.record_version) !== expectedVersion) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "VERSION_CONFLICT", message: "This quotation changed. Reload it before saving." } }, 409);
    }
    const quotationContext = await validateQuotationContext(conn, actor, fields);
    const prepared = await prepareQuotationLines(conn, { entity: quotationContext.entity, effectiveDate: quotationContext.effectiveDate }, fields);
    const [updated] = await conn.execute<ResultSetHeader>(
      `UPDATE quotations SET legal_entity_id=?,brand_id=?,customer_id=?,issue_date=?,valid_until=?,currency=?,
        subtotal=?,discount_total=?,tax_total=?,grand_total=?,notes=?,payment_terms_days=?,record_version=record_version+1,updated_by=?
       WHERE id=? AND status='DRAFT' AND record_version=?`,
      [fields.legalEntityId,fields.brandId ?? null,fields.customerId,quotationContext.issueDate,fields.validUntil ?? null,fields.currency,
        prepared.calculation.subtotal,prepared.calculation.discountTotal,prepared.calculation.taxTotal,prepared.calculation.grandTotal,
        fields.notes ?? null,quotationContext.paymentTermsDays,actor.userId,quotationId,expectedVersion],
    );
    if (updated.affectedRows !== 1) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "VERSION_CONFLICT", message: "Quotation state changed while saving. Reload and retry." } }, 409);
    }
    await persistQuotationLines(conn, quotationId, prepared.lines);
    await auditQuotationChange(conn, actor.userId, quotationId, "quotation.draft.updated", "Quotation draft updated",
      { recordVersion: expectedVersion }, { recordVersion: expectedVersion + 1, changedFields: ["legalEntityId", "brandId", "customerId", "currency", "issueDate", "validUntil", "paymentTermsDays", "notes", "lines", "subtotal", "discountTotal", "taxTotal", "grandTotal"] });
    await conn.commit();
    return jsonNoStore({ data: {
      id: quotationId, status: "DRAFT", quotationNumber: row.quotation_number, recordVersion: expectedVersion + 1,
      issueDate: quotationContext.issueDate, validUntil: fields.validUntil ?? null, currency: fields.currency,
      ...prepared.calculation,
    } });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    return validationError(error);
  } finally { conn?.release(); }
}
