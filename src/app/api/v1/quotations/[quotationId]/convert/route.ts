import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission, requirePermissionForEntity } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { canonicalJson } from "@/lib/configuration/service";
import { calendarDateInTimeZone } from "@/lib/configuration/service";
import { validateDraftContext, resolveDraftLines, persistDraftLines, auditDraftChange, InvoiceDraftValidationError } from "@/lib/finance/invoice-draft-service";
import { auditQuotationChange, QuotationValidationError } from "@/lib/finance/quotation-service";
import { invoiceDraftCreateSchema } from "@/lib/validation/invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ quotationId: string }> };
function duplicateEntry(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY";
}

export async function POST(request: NextRequest, context: Context) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const quotationActor = await requirePermission("quotations:write");
    const { quotationId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(quotationId)) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "quotationId must be a UUID." } }, 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Idempotency-Key must contain 16–128 visible ASCII characters." } }, 400);
    }
    const fingerprint = createHash("sha256").update(canonicalJson({ quotationId, operation: "convert-to-invoice-draft" })).digest("hex");
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.execute<(RowDataPacket & {
      id: string; legal_entity_id: string; brand_id: string | null; customer_id: string; status: string; record_version: number;
      currency: string; notes: string | null; payment_terms_days: number | null; converted_invoice_id: string | null;
      conversion_idempotency_key: string | null; conversion_payload_sha256: string | null; quotation_number: string | null;
    })[]>(
      `SELECT id,legal_entity_id,brand_id,customer_id,status,record_version,currency,notes,payment_terms_days,converted_invoice_id,
        conversion_idempotency_key,conversion_payload_sha256,quotation_number
       FROM quotations WHERE id=? LIMIT 1 FOR UPDATE`, [quotationId],
    );
    if (!rows.length || !quotationActor.legalEntityIds.includes(rows[0].legal_entity_id)) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Quotation not found in your assigned scope." } }, 404);
    }
    const quote = rows[0];
    if (quote.status === "CONVERTED" && quote.converted_invoice_id) {
      await conn.rollback();
      if (quote.conversion_idempotency_key !== idempotencyKey || quote.conversion_payload_sha256 !== fingerprint) {
        return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This quotation was already converted using a different idempotency key." } }, 409);
      }
      return jsonNoStore({ data: { quotationId, invoiceId: quote.converted_invoice_id, status: "DRAFT", idempotentReplay: true } });
    }
    if (quote.status !== "ACCEPTED") {
      await conn.rollback();
      return jsonNoStore({ error: { code: "QUOTATION_NOT_ACCEPTED", message: "Only an accepted quotation can be converted to an invoice draft." } }, 409);
    }

    const actor = await requirePermissionForEntity("invoices:draft:create", quote.legal_entity_id);
    const [entities] = await conn.execute<(RowDataPacket & { time_zone: string | null })[]>(
      "SELECT time_zone FROM legal_entities WHERE id=? AND is_active=TRUE LIMIT 1 FOR UPDATE", [quote.legal_entity_id],
    );
    if (!entities.length) throw new QuotationValidationError("An active legal entity is required to convert this quotation.");
    const invoiceDate = calendarDateInTimeZone(entities[0].time_zone);
    if (invoiceDate === null) {
      await conn.rollback();
      return jsonNoStore({
        error: {
          code: "CONFIGURATION_NOT_READY",
          message: "The legal entity timezone is invalid; an invoice date cannot be assigned safely for conversion.",
        },
      }, 409);
    }
    const [lines] = await conn.execute<(RowDataPacket & {
      catalog_item_id: string | null; line_kind: string; description: string; unit_code: string;
      quantity: string; unit_price: string; discount_type: string; discount_value: string; tax_code: string | null;
    })[]>(
      `SELECT catalog_item_id,line_kind,description,unit_code,quantity,unit_price,discount_type,discount_value,tax_code
       FROM quotation_lines WHERE quotation_id=? ORDER BY line_number FOR UPDATE`, [quotationId],
    );
    if (!lines.length) throw new QuotationValidationError("The accepted quotation has no lines to convert.");
    const input = invoiceDraftCreateSchema.parse({
      legalEntityId: quote.legal_entity_id, brandId: quote.brand_id, customerId: quote.customer_id,
      currency: quote.currency, invoiceDate, dueDate: null, paymentTermsDays: quote.payment_terms_days ?? 0,
      notes: quote.notes ?? null,
      lines: lines.map(line => ({
        catalogItemId: line.catalog_item_id, lineKind: line.line_kind, description: line.description,
        unitCode: line.unit_code, quantity: String(line.quantity), unitPrice: String(line.unit_price),
        discountType: line.discount_type, discountValue: String(line.discount_value), taxCode: line.tax_code,
      })),
    });
    const payloadFingerprint = createHash("sha256").update(canonicalJson(input)).digest("hex");
    const [existingInvoices] = await conn.execute<(RowDataPacket & { id: string; idempotency_payload_sha256: string | null })[]>(
      "SELECT id,idempotency_payload_sha256 FROM invoices WHERE idempotency_key=? LIMIT 1 FOR UPDATE", [idempotencyKey],
    );
    if (existingInvoices.length) {
      await conn.rollback();
      if (existingInvoices[0].idempotency_payload_sha256 !== payloadFingerprint) {
        return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This Idempotency-Key was already used for a different invoice payload." } }, 409);
      }
      return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This idempotency key belongs to an existing invoice, not this quotation conversion." } }, 409);
    }
    const draftContext = await validateDraftContext(conn, actor, input);
    const prepared = await resolveDraftLines(conn, draftContext.entity, draftContext.invoiceDate, input.currency, input.lines);
    const invoiceId = randomUUID();
    await conn.execute(
      `INSERT INTO invoices
        (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,record_version,payment_terms_days,
         invoice_date,due_date,currency,subtotal,discount_total,tax_total,grand_total,notes,idempotency_key,idempotency_payload_sha256)
       VALUES (?,?,?,?,'INVOICE','DRAFT',1,?,?,?,?,?,?,?,?,?,?,?)`,
      [invoiceId,input.legalEntityId,input.brandId ?? null,input.customerId,draftContext.paymentTermsDays,
        draftContext.invoiceDate,draftContext.dueDate,input.currency,prepared.calculation.subtotal,prepared.calculation.discountTotal,
        prepared.calculation.taxTotal,prepared.calculation.grandTotal,input.notes ?? null,idempotencyKey,payloadFingerprint],
    );
    await persistDraftLines(conn, invoiceId, actor.userId, prepared.lines);
    await auditDraftChange(conn, actor.userId, invoiceId, "invoice.draft.created", null, {
      recordVersion: 1, sourceQuotationId: quotationId, changedFields: ["sourceQuotationId","legalEntityId","brandId","customerId","currency","invoiceDate","dueDate","paymentTermsDays","notes","lines","subtotal","discountTotal","taxTotal","grandTotal"],
    });
    const [updated] = await conn.execute<ResultSetHeader>(
      `UPDATE quotations SET status='CONVERTED',converted_invoice_id=?,conversion_idempotency_key=?,
        conversion_payload_sha256=?,record_version=record_version+1,updated_by=?
       WHERE id=? AND status='ACCEPTED' AND record_version=?`,
      [invoiceId,idempotencyKey,fingerprint,actor.userId,quotationId,quote.record_version],
    );
    if (updated.affectedRows !== 1) throw new QuotationValidationError("Quotation state changed during conversion. Reload it before retrying.");
    await auditQuotationChange(conn, actor.userId, quotationId, "quotation.converted", "Accepted quotation converted to invoice draft",
      { status: "ACCEPTED", recordVersion: Number(quote.record_version) },
      { status: "CONVERTED", recordVersion: Number(quote.record_version) + 1, invoiceId });
    await conn.commit();
    return jsonNoStore({ data: {
      quotationId, invoiceId, status: "DRAFT", idempotentReplay: false,
      currency: input.currency, grandTotal: prepared.calculation.grandTotal,
    } }, 201);
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    if (error instanceof QuotationValidationError || error instanceof InvoiceDraftValidationError) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: error.message } }, 422);
    }
    if (duplicateEntry(error)) return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This invoice submission conflicted with an existing record. Refresh the quotation before retrying." } }, 409);
    return apiError(error);
  } finally { conn?.release(); }
}
