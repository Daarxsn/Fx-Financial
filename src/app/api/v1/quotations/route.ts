import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { subtractMoney } from "@/lib/finance/invoice-calculation";
import { calendarDateInTimeZone, canonicalJson } from "@/lib/configuration/service";
import { InvoiceDraftValidationError } from "@/lib/finance/invoice-draft-service";
import { quotationCreateSchema } from "@/lib/validation/quotation";
import {
  auditQuotationChange, persistQuotationLines, prepareQuotationLines, QuotationValidationError,
  validateQuotationContext,
} from "@/lib/finance/quotation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validationError(error: unknown) {
  if (error instanceof QuotationValidationError || error instanceof InvoiceDraftValidationError) {
    return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: error.message } }, 422);
  }
  return apiError(error);
}
function duplicateEntry(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY";
}
function dateText(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission("quotations:read");
    const scope = [...new Set(actor.legalEntityIds)];
    const status = request.nextUrl.searchParams.get("status") ?? "all";
    const statuses = ["all", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED", "CONVERTED"];
    if (!statuses.includes(status)) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Unsupported quotation status filter." } }, 400);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "limit must be 1–100 and offset must be between 0 and 1000000." } }, 400);
    }
    if (!scope.length) return jsonNoStore({ data: [], pagination: { limit, offset, total: 0, hasMore: false } });
    const [entityRows] = await pool.query<(RowDataPacket & { id: string; time_zone: string | null })[]>(
      "SELECT id,time_zone FROM legal_entities WHERE id IN (" + scope.map(() => "?").join(",") + ")",
      scope,
    );
    const expiryParams: unknown[] = [];
    const expiryConditions: string[] = [];
    for (const entity of entityRows) {
      const businessDate = calendarDateInTimeZone(entity.time_zone);
      if (businessDate === null) continue;
      expiryConditions.push("(q.legal_entity_id=? AND q.valid_until < ?)");
      expiryParams.push(entity.id, businessDate);
    }
    const expiryPredicate = expiryConditions.length ? expiryConditions.join(" OR ") : "1=0";
    const effectiveStatus = "CASE WHEN q.status='SENT' AND q.valid_until IS NOT NULL AND (" +
      expiryPredicate + ") THEN 'EXPIRED' ELSE q.status END";
    const clauses = [`q.legal_entity_id IN (${scope.map(() => "?").join(",")})`];
    const params: unknown[] = [...scope];
    if (status !== "all") {
      clauses.push(`${effectiveStatus}=?`);
      params.push(...expiryParams, status);
    }
    const query = (request.nextUrl.searchParams.get("query") ?? "").trim().slice(0, 100);
    if (query) {
      const escaped = query.replace(/[\\%_]/g, "\\$&");
      clauses.push("(q.quotation_number LIKE ? OR c.name LIKE ?)");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    const where = "WHERE " + clauses.join(" AND ");
    const [rows] = await pool.query<(RowDataPacket & {
      id: string; legal_entity_id: string; brand_id: string | null; customer_id: string; customer_name: string;
      quotation_number: string | null; status: string; valid_until: Date | string | null; issue_date: Date | string | null;
      currency: string; subtotal: string; discount_total: string; tax_total: string; grand_total: string;
      record_version: number; converted_invoice_id: string | null; created_at: Date | string; updated_at: Date | string;
    })[]>(
      `SELECT q.id,q.legal_entity_id,q.brand_id,q.customer_id,c.name AS customer_name,q.quotation_number,
        ${effectiveStatus} AS status,q.valid_until,q.issue_date,q.currency,q.subtotal,q.discount_total,q.tax_total,q.grand_total,
        q.record_version,q.converted_invoice_id,q.created_at,q.updated_at
       FROM quotations q JOIN customers c ON c.id=q.customer_id ${where}
       ORDER BY COALESCE(q.issue_date,DATE(q.created_at)) DESC,q.created_at DESC,q.id DESC LIMIT ? OFFSET ?`,
      [...expiryParams, ...params, limit, offset],
    );
    const [[count]] = await pool.query<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM quotations q JOIN customers c ON c.id=q.customer_id ${where}`, params,
    );
    return jsonNoStore({
      data: rows.map(q => ({
        id: q.id, legalEntityId: q.legal_entity_id, brandId: q.brand_id, customerId: q.customer_id,
        customerName: q.customer_name, quotationNumber: q.quotation_number, status: q.status,
        issueDate: dateText(q.issue_date), validUntil: dateText(q.valid_until), currency: q.currency,
        subtotal: String(q.subtotal), discountTotal: String(q.discount_total),
        taxableValue: subtractMoney(q.subtotal, q.discount_total),
        taxTotal: String(q.tax_total), grandTotal: String(q.grand_total), recordVersion: Number(q.record_version),
        convertedInvoiceId: q.converted_invoice_id, createdAt: q.created_at, updatedAt: q.updated_at,
      })),
      pagination: { limit, offset, total: Number(count[0]?.total ?? 0), hasMore: offset + rows.length < Number(count[0]?.total ?? 0) },
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("quotations:write");
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Idempotency-Key must contain 16–128 visible ASCII characters." } }, 400);
    }
    const input = quotationCreateSchema.parse(await request.json());
    const fingerprint = createHash("sha256").update(canonicalJson(input)).digest("hex");
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [existing] = await conn.execute<(RowDataPacket & { id: string; idempotency_payload_sha256: string | null; status: string })[]>(
      "SELECT id,idempotency_payload_sha256,status FROM quotations WHERE idempotency_key=? LIMIT 1 FOR UPDATE",
      [idempotencyKey],
    );
    if (existing.length) {
      await conn.rollback();
      if (existing[0].idempotency_payload_sha256 !== fingerprint) {
        return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This Idempotency-Key was already used for a different quotation payload." } }, 409);
      }
      return jsonNoStore({ data: { id: existing[0].id, status: existing[0].status, idempotentReplay: true } }, 200);
    }
    const context = await validateQuotationContext(conn, actor, input);
    const prepared = await prepareQuotationLines(conn, { entity: context.entity, effectiveDate: context.effectiveDate }, input);
    const id = randomUUID();
    await conn.execute(
      `INSERT INTO quotations
       (id,legal_entity_id,brand_id,customer_id,quotation_number,status,record_version,issue_date,valid_until,currency,
        subtotal,discount_total,tax_total,grand_total,notes,payment_terms_days,idempotency_key,idempotency_payload_sha256,created_by,updated_by)
       VALUES (?,?,?, ?,NULL,'DRAFT',1,?,?,?,?,?,?,?,?,?,?,?, ?,?)`,
      [id,input.legalEntityId,input.brandId ?? null,input.customerId,context.issueDate,input.validUntil ?? null,input.currency,
        prepared.calculation.subtotal,prepared.calculation.discountTotal,prepared.calculation.taxTotal,prepared.calculation.grandTotal,
        input.notes ?? null,context.paymentTermsDays,idempotencyKey,fingerprint,actor.userId,actor.userId],
    );
    await persistQuotationLines(conn, id, prepared.lines);
    await auditQuotationChange(conn, actor.userId, id, "quotation.draft.created", "Quotation draft created", null, {
      status: "DRAFT", recordVersion: 1, changedFields: ["legalEntityId", "brandId", "customerId", "currency", "issueDate", "validUntil", "paymentTermsDays", "notes", "lines", "subtotal", "discountTotal", "taxTotal", "grandTotal"],
    });
    await conn.commit();
    return jsonNoStore({ data: {
      id, legalEntityId: input.legalEntityId, brandId: input.brandId ?? null, customerId: input.customerId,
      status: "DRAFT", quotationNumber: null, issueDate: context.issueDate, validUntil: input.validUntil ?? null,
      currency: input.currency, recordVersion: 1, convertedInvoiceId: null, ...prepared.calculation, idempotentReplay: false,
    } }, 201);
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    if (duplicateEntry(error)) return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This quotation was submitted more than once. Refresh the list before retrying." } }, 409);
    return validationError(error);
  } finally { conn?.release(); }
}
