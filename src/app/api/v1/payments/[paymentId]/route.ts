import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ paymentId: string }> };
const SCALE = 10_000n;
function units(value: string | number): bigint {
  const [whole,fraction=""] = String(value).split(".");
  return BigInt(whole)*SCALE + BigInt((fraction+"0000").slice(0,4));
}
function money(value: bigint): string { return (value/SCALE).toString()+"."+(value%SCALE).toString().padStart(4,"0"); }
function dateText(value: Date|string|null): string|null {
  if(value===null)return null;
  return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
}
function uuid(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
function snapshotValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; }
    catch { /* malformed legacy snapshots remain unavailable */ }
  }
  return null;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const actor = await requirePermission("payments:read");
    const { paymentId } = await context.params;
    if (!uuid(paymentId)) return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"paymentId must be a UUID."}},400);
    const [rows] = await pool.execute<(RowDataPacket & {
      id:string; legal_entity_id:string|null; derived_entity_id:string|null; entity_count:number;
      customer_id:string; amount:string|number; currency:string; payment_date:Date|string; method:string;
      reference:string|null; status:string; notes:string|null; receipt_reference:string|null;
      customer_snapshot:unknown; legal_entity_snapshot:unknown;
      reversed_at:Date|string|null; reversal_reason:string|null; created_at:Date|string;
    })[]>(
      "SELECT p.id,p.legal_entity_id,MAX(i.legal_entity_id) AS derived_entity_id,COUNT(DISTINCT i.legal_entity_id) AS entity_count," +
      "p.customer_id,p.amount,p.currency,DATE_FORMAT(p.payment_date,'%Y-%m-%d') AS payment_date,p.method,p.reference,p.status,p.notes," +
      "p.receipt_reference,p.customer_snapshot,p.legal_entity_snapshot,p.reversed_at,p.reversal_reason,p.created_at " +
      "FROM payments p LEFT JOIN payment_allocations pa ON pa.payment_id=p.id LEFT JOIN invoices i ON i.id=pa.invoice_id " +
      "WHERE p.id=? GROUP BY p.id LIMIT 1", [paymentId],
    );
    if (!rows.length) return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);
    const row = rows[0];
    const entityId = row.legal_entity_id ?? row.derived_entity_id;
    if (!entityId || !actor.legalEntityIds.includes(entityId) || Number(row.entity_count)>1 ||
        (row.legal_entity_id && row.derived_entity_id && row.legal_entity_id!==row.derived_entity_id)) {
      return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);
    }
    const [allocationRows] = await pool.execute<(RowDataPacket & {
      id:string; invoice_id:string; amount:string|number; created_at:Date|string;
      invoice_number:string|null; invoice_status:string;
    })[]>(
      "SELECT pa.id,pa.invoice_id,pa.amount,pa.created_at,i.invoice_number,i.lifecycle_status AS invoice_status " +
      "FROM payment_allocations pa JOIN invoices i ON i.id=pa.invoice_id WHERE pa.payment_id=? ORDER BY pa.created_at,pa.id",
      [paymentId],
    );
    const [sumRows] = await pool.execute<(RowDataPacket & {allocated:string|number})[]>(
      "SELECT COALESCE(SUM(amount),0) AS allocated FROM payment_allocations WHERE payment_id=?", [paymentId],
    );
    const [reversalRows] = await pool.execute<(RowDataPacket & {
      id:string; amount:string|number; currency:string; reason:string; reversed_by:string; reversed_at:Date|string; idempotency_key:string;
    })[]>(
      "SELECT id,amount,currency,reason,reversed_by,reversed_at,idempotency_key FROM payment_reversal_events WHERE payment_id=? ORDER BY reversed_at,id",
      [paymentId],
    );
    const allocated = units(sumRows[0]?.allocated ?? "0");
    const amount = units(row.amount);
    return jsonNoStore({data:{
      id:row.id,receiptReference:row.receipt_reference??"RCPT-"+row.id.replaceAll("-","").toUpperCase(),
      legalEntityId:entityId,customerId:row.customer_id,amount:money(amount),allocatedAmount:money(allocated),
      unallocatedAmount:row.status==="RECORDED"?money(amount-allocated):"0.0000",currency:row.currency,
      paymentDate:dateText(row.payment_date),method:row.method,reference:row.reference,status:row.status,
      notes:row.notes,customerSnapshot:snapshotValue(row.customer_snapshot),legalEntitySnapshot:snapshotValue(row.legal_entity_snapshot),
      createdAt:row.created_at,reversedAt:row.reversed_at,reversalReason:row.reversal_reason,
      allocations:allocationRows.map(a=>({id:a.id,invoiceId:a.invoice_id,invoiceNumber:a.invoice_number,
        invoiceStatus:a.invoice_status,amount:money(units(a.amount)),createdAt:a.created_at})),
      reversalEvents:reversalRows.map(r=>({id:r.id,amount:money(units(r.amount)),currency:r.currency,reason:r.reason,
        reversedBy:r.reversed_by,reversedAt:r.reversed_at,idempotencyKey:r.idempotency_key})),
    },meta:{}});
  } catch(error) { return apiError(error); }
}
