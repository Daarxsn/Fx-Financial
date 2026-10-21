import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { invoiceCalendarDateSchema } from "@/lib/validation/invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCALE = 10_000n;
const MONEY = /^(0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$/;
function units(value: string | number): bigint {
  const [whole, fraction = ""] = String(value).split(".");
  if (!MONEY.test(String(value))) throw new Error("Stored monetary value is outside the supported decimal format.");
  return BigInt(whole) * SCALE + BigInt((fraction + "0000").slice(0, 4));
}
function money(value: bigint): string {
  if (value < 0n) throw new Error("Calculated payment balance cannot be negative.");
  return (value / SCALE).toString() + "." + (value % SCALE).toString().padStart(4, "0");
}
function uuid(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
function dateText(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function snapshotValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; }
    catch { /* malformed legacy snapshot is unavailable rather than fabricated */ }
  }
  return null;
}
function duplicate(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY";
}
const positiveMoney = z.string().regex(MONEY, "Enter a non-negative decimal with up to four fractional digits.")
  .refine(value => units(value) > 0n, "Receipt amount must be greater than zero.");
const inputSchema = z.object({
  legalEntityId: z.string().uuid(),
  customerId: z.string().uuid(),
  amount: positiveMoney,
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentDate: invoiceCalendarDateSchema,
  method: z.string().trim().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/)
    .transform(value => value.toUpperCase().replace(/[ -]+/g, "_")),
  reference: z.string().trim().max(160).optional().transform(value => value || null),
  notes: z.string().trim().max(2000).optional().transform(value => value || null),
}).strict();

async function serializeReceipt(row: RowDataPacket & {
  id: string; legal_entity_id: string | null; customer_id: string; amount: string | number; currency: string;
  payment_date: Date | string; method: string; reference: string | null; status: string; notes: string | null;
  receipt_reference: string | null; reversed_at: Date | string | null; reversal_reason: string | null;
  customer_snapshot: unknown; legal_entity_snapshot: unknown;
  created_at: Date | string; allocated_amount: string | number;
}) {
  const amount = units(row.amount);
  const allocated = units(row.allocated_amount);
  const [allocations] = await pool.execute<(RowDataPacket & {
    id: string; invoice_id: string; amount: string | number; created_at: Date | string;
    invoice_number: string | null; invoice_status: string;
  })[]>(
    "SELECT pa.id,pa.invoice_id,pa.amount,pa.created_at,i.invoice_number,i.lifecycle_status AS invoice_status " +
    "FROM payment_allocations pa JOIN invoices i ON i.id=pa.invoice_id " +
    "WHERE pa.payment_id=? ORDER BY pa.created_at,pa.id",
    [row.id],
  );
  return {
    id: row.id,
    receiptReference: row.receipt_reference ?? "RCPT-" + row.id.replaceAll("-", "").toUpperCase(),
    legalEntityId: row.legal_entity_id,
    customerId: row.customer_id,
    amount: money(amount),
    allocatedAmount: money(allocated),
    unallocatedAmount: row.status === "RECORDED" ? money(amount - allocated) : "0.0000",
    currency: row.currency,
    paymentDate: dateText(row.payment_date),
    method: row.method,
    reference: row.reference,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
    customerSnapshot: snapshotValue(row.customer_snapshot),
    legalEntitySnapshot: snapshotValue(row.legal_entity_snapshot),
    allocations: allocations.map(item => ({
      id: item.id, invoiceId: item.invoice_id, invoiceNumber: item.invoice_number,
      invoiceStatus: item.invoice_status, amount: money(units(item.amount)), createdAt: item.created_at,
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission("payments:read");
    const query = request.nextUrl.searchParams;
    const limit = Number(query.get("limit") ?? "25");
    const offset = Number(query.get("offset") ?? "0");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "limit must be 1–100 and offset must be between 0 and 1000000." } }, 400);
    }
    const scopes = [...new Set(actor.legalEntityIds)];
    if (!scopes.length) return jsonNoStore({ data: [], meta: { pagination: { limit, offset, total: 0, hasMore: false } } });
    const where = ["p.legal_entity_id IN (" + scopes.map(() => "?").join(",") + ")"];
    const values: string[] = [...scopes];
    const entity = query.get("legalEntityId");
    const customer = query.get("customerId");
    const status = query.get("status");
    const from = query.get("paymentDateFrom");
    const to = query.get("paymentDateTo");
    if (entity !== null) {
      if (!uuid(entity) || !scopes.includes(entity)) return jsonNoStore({ error: { code: "NOT_FOUND", message: "Payment scope not found." } }, 404);
      where.push("p.legal_entity_id=?"); values.push(entity);
    }
    if (customer !== null) {
      if (!uuid(customer)) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "customerId must be a UUID." } }, 400);
      where.push("p.customer_id=?"); values.push(customer);
    }
    if (status !== null) {
      if (!["RECORDED", "REVERSED"].includes(status)) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "status must be RECORDED or REVERSED." } }, 400);
      where.push("p.status=?"); values.push(status);
    }
    for (const [key, value, operator] of [["paymentDateFrom", from, ">="], ["paymentDateTo", to, "<="]] as const) {
      if (value !== null && !invoiceCalendarDateSchema.safeParse(value).success) {
        return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: key + " must be a real YYYY-MM-DD date." } }, 400);
      }
      if (value !== null) { where.push("p.payment_date" + operator + "?"); values.push(value); }
    }
    if (from && to && from > to) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "paymentDateFrom cannot be later than paymentDateTo." } }, 400);
    const predicate = where.join(" AND ");
    const [countRows] = await pool.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM payments p WHERE " + predicate, values,
    );
    const [rows] = await pool.execute<(RowDataPacket & {
      id: string; legal_entity_id: string | null; customer_id: string; amount: string | number; currency: string;
      payment_date: Date | string; method: string; reference: string | null; status: string; notes: string | null;
      receipt_reference: string | null; reversed_at: Date | string | null; reversal_reason: string | null;
      customer_snapshot: unknown; legal_entity_snapshot: unknown;
      created_at: Date | string; allocated_amount: string | number;
    })[]>(
      "SELECT p.id,p.legal_entity_id,p.customer_id,p.customer_snapshot,p.legal_entity_snapshot,p.amount,p.currency,DATE_FORMAT(p.payment_date,'%Y-%m-%d') AS payment_date," +
      "p.method,p.reference,p.status,p.notes,p.receipt_reference,p.reversed_at,p.reversal_reason,p.created_at," +
      "COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.payment_id=p.id),0) AS allocated_amount " +
      "FROM payments p WHERE " + predicate + " ORDER BY p.payment_date DESC,p.created_at DESC,p.id DESC LIMIT ? OFFSET ?",
      [...values, limit, offset],
    );
    const data = [];
    for (const row of rows) data.push(await serializeReceipt(row));
    const total = Number(countRows[0]?.total ?? 0);
    return jsonNoStore({ data, meta: { pagination: { limit, offset, total, hasMore: offset + rows.length < total } } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("payments:record");
    const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!/^[\x21-\x7e]{16,128}$/.test(key)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Idempotency-Key must contain 16–128 visible ASCII characters." } }, 400);
    }
    const input = inputSchema.parse(await request.json());
    if (!actor.legalEntityIds.includes(input.legalEntityId)) return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [entities] = await conn.execute<(RowDataPacket & {
      id:string;legal_name:string;display_name:string;currency:string;country_code:string|null;time_zone:string|null;
      invoice_email:string|null;invoice_phone:string|null;address_json:unknown;
    })[]>(
      "SELECT id,legal_name,display_name,currency,country_code,time_zone,invoice_email,invoice_phone,address_json " +
      "FROM legal_entities WHERE id=? AND is_active=TRUE LIMIT 1 FOR UPDATE", [input.legalEntityId],
    );
    if (!entities.length) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity is unavailable." } }, 404);
    }
    const [customers] = await conn.execute<(RowDataPacket & {
      id:string;name:string;email:string|null;phone:string|null;billing_address_json:unknown;tax_identifier:string|null;
    })[]>(
      "SELECT id,name,email,phone,billing_address_json,tax_identifier FROM customers WHERE id=? AND is_active=TRUE LIMIT 1 FOR UPDATE", [input.customerId],
    );
    if (!customers.length) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "An active customer is required to record a receipt." } }, 422);
    }
    const [existingRows] = await conn.execute<(RowDataPacket & {
      id: string; legal_entity_id: string | null; customer_id: string; amount: string | number; currency: string;
      payment_date: Date | string; method: string; reference: string | null; notes: string | null;
      status: string; receipt_reference: string | null; customer_snapshot: unknown; legal_entity_snapshot: unknown;
    })[]>(
      "SELECT id,legal_entity_id,customer_id,amount,currency,DATE_FORMAT(payment_date,'%Y-%m-%d') AS payment_date," +
      "method,reference,notes,status,receipt_reference,customer_snapshot,legal_entity_snapshot FROM payments WHERE idempotency_key=? LIMIT 1 FOR UPDATE", [key],
    );
    if (existingRows.length) {
      const row = existingRows[0];
      const same = row.legal_entity_id === input.legalEntityId && row.customer_id === input.customerId &&
        units(row.amount) === units(input.amount) && row.currency === input.currency &&
        dateText(row.payment_date) === input.paymentDate && row.method === input.method &&
        row.reference === input.reference && row.notes === input.notes;
      if (!same) {
        await conn.rollback();
        return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This Idempotency-Key was already used for a different payment." } }, 409);
      }
      await conn.commit();
      const [allocationRows] = await pool.execute<(RowDataPacket & { allocated: string | number })[]>(
        "SELECT COALESCE(SUM(amount),0) AS allocated FROM payment_allocations WHERE payment_id=?", [row.id],
      );
      const allocated = units(allocationRows[0]?.allocated ?? "0");
      const amount = units(row.amount);
      return jsonNoStore({ data: {
        id: row.id, receiptReference: row.receipt_reference ?? "RCPT-" + row.id.replaceAll("-", "").toUpperCase(),
        legalEntityId: row.legal_entity_id, customerId: row.customer_id, amount: money(amount),
        allocatedAmount: money(allocated), unallocatedAmount: row.status === "RECORDED" ? money(amount - allocated) : "0.0000",
        currency: row.currency, paymentDate: input.paymentDate, method: row.method, reference: row.reference,
        notes: row.notes, customerSnapshot:snapshotValue(row.customer_snapshot),legalEntitySnapshot:snapshotValue(row.legal_entity_snapshot),
        status: row.status, idempotentReplay: true,
      }, meta: {} }, 200);
    }
    // A receipt is denominated in the legal entity's configured currency. Never trust
    // the client-provided currency, even when the UI currently renders it read-only.
    if (input.currency !== entities[0].currency) {
      await conn.rollback();
      return jsonNoStore({ error: {
        code: "CURRENCY_MISMATCH",
        message: "Receipt currency must match the selected legal entity's configured currency.",
      } }, 422);
    }
    const paymentId = randomUUID();
    const receiptReference = "RCPT-" + paymentId.replaceAll("-", "").toUpperCase();
    await conn.execute(
      "INSERT INTO payments (id,legal_entity_id,receipt_reference,customer_id,customer_snapshot,legal_entity_snapshot,amount,currency,payment_date,method,reference,status,notes,recorded_by,idempotency_key) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,'RECORDED',?,?,?)",
      [paymentId,input.legalEntityId,receiptReference,input.customerId,
        JSON.stringify({customerId:customers[0].id,name:customers[0].name,email:customers[0].email,phone:customers[0].phone,
          billingAddress:snapshotValue(customers[0].billing_address_json),taxIdentifier:customers[0].tax_identifier}),
        JSON.stringify({legalName:entities[0].legal_name,displayName:entities[0].display_name,address:snapshotValue(entities[0].address_json),
          countryCode:entities[0].country_code,currency:entities[0].currency,timeZone:entities[0].time_zone,
          invoiceEmail:entities[0].invoice_email,invoicePhone:entities[0].invoice_phone}),
        money(units(input.amount)),input.currency,input.paymentDate,input.method,input.reference,input.notes,actor.userId,key],
    );
    await conn.execute(
      "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json) " +
      "VALUES (?,?,'payment.receipt.recorded','payment',?,'SUCCESS',NULL,?)",
      [randomUUID(),actor.userId,paymentId,JSON.stringify({
        receiptReference,legalEntityId:input.legalEntityId,customerId:input.customerId,
        amount:money(units(input.amount)),currency:input.currency,paymentDate:input.paymentDate,method:input.method,allocationCount:0,
      })],
    );
    await conn.commit();
    return jsonNoStore({ data: {
      id:paymentId,receiptReference,legalEntityId:input.legalEntityId,customerId:input.customerId,
      amount:money(units(input.amount)),allocatedAmount:"0.0000",unallocatedAmount:money(units(input.amount)),
      currency:input.currency,paymentDate:input.paymentDate,method:input.method,reference:input.reference,
      notes:input.notes,
      customerSnapshot:{customerId:customers[0].id,name:customers[0].name,email:customers[0].email,phone:customers[0].phone,
        billingAddress:snapshotValue(customers[0].billing_address_json),taxIdentifier:customers[0].tax_identifier},
      legalEntitySnapshot:{legalName:entities[0].legal_name,displayName:entities[0].display_name,address:snapshotValue(entities[0].address_json),
        countryCode:entities[0].country_code,currency:entities[0].currency,timeZone:entities[0].time_zone,
        invoiceEmail:entities[0].invoice_email,invoicePhone:entities[0].invoice_phone},
      status:"RECORDED",idempotentReplay:false,
    }, meta:{} }, 201);
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    if (duplicate(error)) return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This receipt submission conflicted with an existing idempotency key." } }, 409);
    return apiError(error);
  } finally { conn?.release(); }
}
