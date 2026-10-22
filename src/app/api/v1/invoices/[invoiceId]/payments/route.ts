import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { invoiceCalendarDateSchema } from "@/lib/validation/invoice";
import { captureDocumentSourceSnapshot } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ invoiceId: string }> };
const MONEY_SCALE = 10_000n;
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$/;

function toUnits(value: string | number | bigint): bigint {
  const raw = String(value);
  if (!MONEY_PATTERN.test(raw)) throw new Error("Stored monetary amount is outside the supported decimal format.");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * MONEY_SCALE + BigInt((fraction + "0000").slice(0, 4));
}
function fromUnits(value: bigint): string {
  if (value < 0n) throw new Error("Calculated monetary amount cannot be negative.");
  return (value / MONEY_SCALE).toString() + "." + (value % MONEY_SCALE).toString().padStart(4, "0");
}
function paymentStatus(total: bigint, paid: bigint): "UNPAID" | "PARTIALLY_PAID" | "PAID" {
  if (total > 0n && paid >= total) return "PAID";
  if (paid > 0n) return "PARTIALLY_PAID";
  return "UNPAID";
}
function dateText(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY";
}
function validUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

const paymentInputSchema = z.object({
  amount: z.string().regex(MONEY_PATTERN, "Payment amount must be a non-negative decimal with up to four fractional digits.")
    .refine((value) => toUnits(value) > 0n, "Payment amount must be greater than zero."),
  paymentDate: invoiceCalendarDateSchema,
  method: z.string().trim().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/, "Use a simple payment method label.")
    .transform((value) => value.toUpperCase().replace(/[ -]+/g, "_")),
  reference: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

type InvoiceRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  customer_id: string;
  document_type: string;
  lifecycle_status: string;
  currency: string;
  grand_total: string | number;
  customer_snapshot: unknown;
  supplier_snapshot: unknown;
};
type PaymentRow = RowDataPacket & {
  id: string;
  legal_entity_id: string | null;
  receipt_reference: string | null;
  customer_id: string;
  amount: string | number;
  currency: string;
  payment_date: string;
  method: string;
  reference: string | null;
  status: "RECORDED" | "REVERSED";
  notes: string | null;
  created_at: Date | string;
  reversed_at: Date | string | null;
  reversal_reason: string | null;
  invoice_id: string | null;
  allocated_amount: string | number | null;
  allocation_count?: number;
};

async function getPaymentByKey(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  idempotencyKey: string,
): Promise<PaymentRow | undefined> {
  const [rows] = await conn.execute<PaymentRow[]>(
    `SELECT p.id,p.legal_entity_id,p.receipt_reference,p.customer_id,p.amount,p.currency,DATE_FORMAT(p.payment_date,'%Y-%m-%d') AS payment_date,
      p.method,p.reference,p.status,p.notes,p.created_at,p.reversed_at,p.reversal_reason,
      pa.invoice_id,pa.amount AS allocated_amount
     FROM payments p
     LEFT JOIN payment_allocations pa ON pa.payment_id=p.id
     WHERE p.idempotency_key=? LIMIT 1 FOR UPDATE`,
    [idempotencyKey],
  );
  return rows[0];
}

async function getBalances(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  invoiceId: string,
  invoiceTotal: bigint,
) {
  const [rows] = await conn.execute<(RowDataPacket & { paid_total: string | number })[]>(
    `SELECT COALESCE(SUM(pa.amount),0) AS paid_total
       FROM payment_allocations pa
       JOIN payments p ON p.id=pa.payment_id
      WHERE pa.invoice_id=? AND p.status='RECORDED'`,
    [invoiceId],
  );
  const paid = toUnits(rows[0]?.paid_total ?? "0");
  const outstanding = invoiceTotal > paid ? invoiceTotal - paid : 0n;
  return { paid, outstanding, status: paymentStatus(invoiceTotal, paid) };
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const actor = await requirePermission("payments:read");
    const { invoiceId } = await context.params;
    if (!validUuid(invoiceId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "invoiceId must be a UUID." } }, 400);
    }
    const [invoices] = await pool.execute<(RowDataPacket & { id: string; legal_entity_id: string })[]>(
      "SELECT id,legal_entity_id FROM invoices WHERE id=? LIMIT 1",
      [invoiceId],
    );
    if (!invoices.length || !actor.legalEntityIds.includes(invoices[0].legal_entity_id)) {
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Invoice not found in your assigned scope." } }, 404);
    }
    const [rows] = await pool.execute<PaymentRow[]>(
      `SELECT p.id,p.legal_entity_id,p.receipt_reference,p.customer_id,p.amount,p.currency,
        DATE_FORMAT(p.payment_date,'%Y-%m-%d') AS payment_date,p.method,p.reference,p.status,p.notes,
        p.created_at,p.reversed_at,p.reversal_reason,? AS invoice_id,
        COALESCE(SUM(pa.amount),0) AS allocated_amount,COUNT(pa.id) AS allocation_count
       FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id
       WHERE pa.invoice_id=? GROUP BY p.id
       ORDER BY p.payment_date DESC,p.created_at DESC,p.id DESC`,
      [invoiceId, invoiceId],
    );
    return jsonNoStore({ data: rows.map((row) => ({
      id: row.id,
      invoiceId,
      receiptReference: row.receipt_reference ?? "RCPT-" + row.id.replaceAll("-", "").toUpperCase(),
      customerId: row.customer_id,
      amount: fromUnits(toUnits(row.amount)),
      allocatedAmount: fromUnits(toUnits(row.allocated_amount ?? row.amount)),
      allocationCount: Number(row.allocation_count ?? 1),
      currency: row.currency,
      paymentDate: dateText(row.payment_date),
      method: row.method,
      reference: row.reference,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      reversedAt: row.reversed_at,
      reversalReason: row.reversal_reason,
    })), meta: {} });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("payments:record");
    const { invoiceId } = await context.params;
    if (!validUuid(invoiceId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "invoiceId must be a UUID." } }, 400);
    }
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Idempotency-Key must contain 16–128 visible ASCII characters." } }, 400);
    }
    const input = paymentInputSchema.parse(await request.json());
    const amountUnits = toUnits(input.amount);
    const amount = fromUnits(amountUnits);
    const reference = input.reference || null;
    const notes = input.notes || null;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [invoiceRows] = await conn.execute<InvoiceRow[]>(
      `SELECT id,legal_entity_id,customer_id,document_type,lifecycle_status,currency,grand_total,customer_snapshot,supplier_snapshot
         FROM invoices WHERE id=? LIMIT 1 FOR UPDATE`,
      [invoiceId],
    );
    if (!invoiceRows.length || !actor.legalEntityIds.includes(invoiceRows[0].legal_entity_id)) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Invoice not found in your assigned scope." } }, 404);
    }
    const invoice = invoiceRows[0];
    const invoiceTotal = toUnits(invoice.grand_total);

    const existing = await getPaymentByKey(conn, idempotencyKey);
    if (existing) {
      const sameRequest = existing.invoice_id === invoiceId &&
        existing.customer_id === invoice.customer_id &&
        toUnits(existing.amount) === amountUnits &&
        existing.currency === invoice.currency &&
        dateText(existing.payment_date) === input.paymentDate &&
        existing.method === input.method &&
        existing.reference === reference &&
        existing.notes === notes &&
        existing.allocated_amount !== null && toUnits(existing.allocated_amount) === amountUnits;
      if (!sameRequest) {
        await conn.rollback();
        return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This Idempotency-Key was already used for a different payment." } }, 409);
      }
      const balances = await getBalances(conn, invoiceId, invoiceTotal);
      await conn.commit();
      return jsonNoStore({ data: {
        id: existing.id, invoiceId, customerId: invoice.customer_id,
        receiptReference: existing.receipt_reference ?? "RCPT-" + existing.id.replaceAll("-", "").toUpperCase(),
        amount, currency: invoice.currency, paymentDate: input.paymentDate,
        method: input.method, status: existing.status, paidAmount: fromUnits(balances.paid),
        outstandingBalance: fromUnits(balances.outstanding), paymentStatus: balances.status, idempotentReplay: true,
      }, meta: {} }, 200);
    }

    if (invoice.document_type !== "INVOICE" || invoice.lifecycle_status !== "ISSUED") {
      await conn.rollback();
      return jsonNoStore({ error: { code: "PAYMENT_NOT_ALLOWED", message: "Payments can only be allocated to issued invoices." } }, 409);
    }
    const balances = await getBalances(conn, invoiceId, invoiceTotal);
    if (amountUnits > balances.outstanding) {
      await conn.rollback();
      return jsonNoStore({ error: {
        code: "PAYMENT_EXCEEDS_BALANCE",
        message: "Payment amount exceeds the invoice's outstanding balance.",
        details: { outstandingBalance: fromUnits(balances.outstanding), currency: invoice.currency },
      } }, 409);
    }

    const paymentId = randomUUID();
    const receiptReference = "RCPT-" + paymentId.replaceAll("-", "").toUpperCase();
    await conn.execute(
      `INSERT INTO payments
        (id,legal_entity_id,receipt_reference,customer_id,customer_snapshot,legal_entity_snapshot,amount,currency,payment_date,method,reference,status,notes,recorded_by,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'RECORDED',?,?,?)`,
      [paymentId, invoice.legal_entity_id, receiptReference, invoice.customer_id,
        invoice.customer_snapshot===null?null:JSON.stringify(typeof invoice.customer_snapshot==="string"?JSON.parse(invoice.customer_snapshot):invoice.customer_snapshot),
        invoice.supplier_snapshot===null?null:JSON.stringify(typeof invoice.supplier_snapshot==="string"?JSON.parse(invoice.supplier_snapshot):invoice.supplier_snapshot),
        amount, invoice.currency, input.paymentDate, input.method, reference, notes, actor.userId, idempotencyKey],
    );
    await conn.execute(
      "INSERT INTO payment_allocations (id,payment_id,invoice_id,amount,idempotency_key,created_by) VALUES (?,?,?,?,?,?)",
      [randomUUID(), paymentId, invoiceId, amount, idempotencyKey, actor.userId],
    );
    const nextPaid = balances.paid + amountUnits;
    const nextOutstanding = invoiceTotal > nextPaid ? invoiceTotal - nextPaid : 0n;
    // The receipt snapshot commits atomically with payment allocation and balance audit.
    await captureDocumentSourceSnapshot(conn, "RECEIPT", paymentId, actor.userId, "RECEIPT_RECORDED");
    await conn.execute(
      `INSERT INTO audit_events
        (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json)
       VALUES (?,?,?,'invoice',?,'SUCCESS',?,?)`,
      [randomUUID(), actor.userId, "payment.recorded", invoiceId,
        JSON.stringify({ paidAmount: fromUnits(balances.paid), outstandingBalance: fromUnits(balances.outstanding) }),
        JSON.stringify({ paymentId, amount, currency: invoice.currency, paymentDate: input.paymentDate,
          paidAmount: fromUnits(nextPaid), outstandingBalance: fromUnits(nextOutstanding),
          paymentStatus: paymentStatus(invoiceTotal, nextPaid), changedFields: ["payments", "paidAmount", "outstandingBalance"] })],
    );
    await conn.commit();
    return jsonNoStore({ data: {
      id: paymentId, invoiceId, customerId: invoice.customer_id, receiptReference,
      amount, currency: invoice.currency, paymentDate: input.paymentDate,
      method: input.method, status: "RECORDED", paidAmount: fromUnits(nextPaid),
      outstandingBalance: fromUnits(nextOutstanding), paymentStatus: paymentStatus(invoiceTotal, nextPaid),
      idempotentReplay: false,
    }, meta: {} }, 201);
  } catch (error) {
    if (conn) await conn.rollback().catch(() => undefined);
    if (isDuplicateEntry(error)) {
      return jsonNoStore({ error: { code: "DUPLICATE_SUBMISSION", message: "This payment submission conflicted with an existing record. Refresh the invoice before retrying." } }, 409);
    }
    return apiError(error);
  } finally {
    conn?.release();
  }
}
