import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { captureDocumentSourceSnapshot } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ invoiceId: string }> };
const SCALE = 10_000n;
const MONEY = /^(0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$/;
function units(value: string | number): bigint {
  const raw=String(value);
  if(!MONEY.test(raw))throw new Error("Stored monetary value is outside the supported decimal format.");
  const [whole,fraction=""]=raw.split(".");
  return BigInt(whole)*SCALE+BigInt((fraction+"0000").slice(0,4));
}
function money(value: bigint): string { return (value/SCALE).toString()+"."+(value%SCALE).toString().padStart(4,"0"); }
function uuid(value:string){return /^[0-9a-f-]{36}$/i.test(value);}
function duplicate(error:unknown){return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY";}
const schema=z.object({paymentId:z.string().uuid(),amount:z.string().regex(MONEY,"Enter a positive decimal with up to four fractional digits.")
  .refine(value=>units(value)>0n,"Allocation amount must be greater than zero.")}).strict();
type Invoice=RowDataPacket & {id:string;legal_entity_id:string;customer_id:string;lifecycle_status:string;document_type:string;currency:string;grand_total:string|number};
type Payment=RowDataPacket & {id:string;legal_entity_id:string|null;customer_id:string;amount:string|number;currency:string;status:string;receipt_reference:string|null};
async function paidOnInvoice(conn:Awaited<ReturnType<typeof pool.getConnection>>,invoiceId:string){
 const [rows]=await conn.execute<(RowDataPacket & {paid:string|number})[]>(
  "SELECT COALESCE(SUM(pa.amount),0) AS paid FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=? AND p.status='RECORDED'",[invoiceId]);
 return units(rows[0]?.paid??"0");
}
async function allocatedOnReceipt(conn:Awaited<ReturnType<typeof pool.getConnection>>,paymentId:string){
 const [rows]=await conn.execute<(RowDataPacket & {allocated:string|number})[]>(
  "SELECT COALESCE(SUM(amount),0) AS allocated FROM payment_allocations WHERE payment_id=?",[paymentId]);
 return units(rows[0]?.allocated??"0");
}
export async function POST(request:NextRequest,context:Context){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("payments:record");
  const {invoiceId}=await context.params;
  if(!uuid(invoiceId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"invoiceId must be a UUID."}},400);
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  if(!/^[\x21-\x7e]{16,128}$/.test(key))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Idempotency-Key must contain 16–128 visible ASCII characters."}},400);
  const input=schema.parse(await request.json());
  conn=await pool.getConnection();await conn.beginTransaction();
  const [invoiceRows]=await conn.execute<Invoice[]>(
   "SELECT id,legal_entity_id,customer_id,lifecycle_status,document_type,currency,grand_total FROM invoices WHERE id=? LIMIT 1 FOR UPDATE",[invoiceId]);
  if(!invoiceRows.length||!actor.legalEntityIds.includes(invoiceRows[0].legal_entity_id)){
   await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Invoice not found in your assigned scope."}},404);
  }
  const invoice=invoiceRows[0];
  if(invoice.document_type!=="INVOICE"||invoice.lifecycle_status!=="ISSUED"){
   await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_NOT_ALLOWED",message:"Allocations can only be made to issued invoices."}},409);
  }
  const [oldAllocations]=await conn.execute<(RowDataPacket & {id:string;payment_id:string;invoice_id:string;amount:string|number;created_at:Date|string})[]>(
   "SELECT id,payment_id,invoice_id,amount,created_at FROM payment_allocations WHERE idempotency_key=? LIMIT 1",[key]);
  if(oldAllocations.length){
   const old=oldAllocations[0];
   if(old.invoice_id!==invoiceId||old.payment_id!==input.paymentId||units(old.amount)!==units(input.amount)){
    await conn.rollback();return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This Idempotency-Key was already used for a different allocation."}},409);
   }
   const [pRows]=await conn.execute<Payment[]>(
    "SELECT id,legal_entity_id,customer_id,amount,currency,status,receipt_reference FROM payments WHERE id=? LIMIT 1 FOR UPDATE",[input.paymentId]);
   if(!pRows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Receipt not found in your assigned scope."}},404);}
   const p=pRows[0];
   const paid=await paidOnInvoice(conn,invoiceId);
   const outstanding=units(invoice.grand_total)>paid?units(invoice.grand_total)-paid:0n;
   const allocated=await allocatedOnReceipt(conn,p.id);
   await conn.commit();
   return jsonNoStore({data:{id:old.id,paymentId:p.id,receiptReference:p.receipt_reference??"RCPT-"+p.id.replaceAll("-","").toUpperCase(),
    invoiceId,amount:money(units(old.amount)),currency:p.currency,createdAt:old.created_at,allocatedAmount:money(allocated),
    unallocatedAmount:p.status==="RECORDED"?money(units(p.amount)-allocated):"0.0000",
    paidAmount:money(paid),outstandingBalance:money(outstanding),idempotentReplay:true},meta:{}},200);
  }
  const [paymentRows]=await conn.execute<Payment[]>(
   "SELECT id,legal_entity_id,customer_id,amount,currency,status,receipt_reference FROM payments WHERE id=? LIMIT 1 FOR UPDATE",[input.paymentId]);
  if(!paymentRows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Receipt not found in your assigned scope."}},404);}
  const payment=paymentRows[0];
  // A request with the same idempotency key may have committed while this transaction
  // waited for the receipt lock. Recheck after serialization, not with a gap-lock read.
  const [racedAllocations]=await conn.execute<(RowDataPacket & {
   id:string;payment_id:string;invoice_id:string;amount:string|number;created_at:Date|string
  })[]>("SELECT id,payment_id,invoice_id,amount,created_at FROM payment_allocations WHERE idempotency_key=? LIMIT 1",[key]);
  if(racedAllocations.length){
   const raced=racedAllocations[0];
   if(raced.invoice_id!==invoiceId||raced.payment_id!==input.paymentId||units(raced.amount)!==units(input.amount)){
    await conn.rollback();return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This Idempotency-Key was already used for a different allocation."}},409);
   }
   const racedPaid=await paidOnInvoice(conn,invoiceId);
   const racedOutstanding=units(invoice.grand_total)>racedPaid?units(invoice.grand_total)-racedPaid:0n;
   const racedAllocated=await allocatedOnReceipt(conn,payment.id);
   await conn.commit();
   return jsonNoStore({data:{id:raced.id,paymentId:payment.id,receiptReference:payment.receipt_reference??"RCPT-"+payment.id.replaceAll("-","").toUpperCase(),
    invoiceId,amount:money(units(raced.amount)),currency:payment.currency,createdAt:raced.created_at,
    allocatedAmount:money(racedAllocated),unallocatedAmount:payment.status==="RECORDED"?money(units(payment.amount)-racedAllocated):"0.0000",
    paidAmount:money(racedPaid),outstandingBalance:money(racedOutstanding),idempotentReplay:true},meta:{}},200);
  }
  if(!payment.legal_entity_id||payment.legal_entity_id!==invoice.legal_entity_id||
     payment.customer_id!==invoice.customer_id||payment.currency!==invoice.currency||
     !actor.legalEntityIds.includes(payment.legal_entity_id)){
   await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_SCOPE_MISMATCH",message:"Receipt and invoice must have the same legal entity, customer and currency."}},409);
  }
  if(payment.status!=="RECORDED"){
   await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_NOT_ALLOWED",message:"A reversed receipt cannot be allocated."}},409);
  }
  const [entityRows]=await conn.execute<(RowDataPacket & {id:string})[]>(
   "SELECT id FROM legal_entities WHERE id=? AND is_active=TRUE LIMIT 1",[invoice.legal_entity_id]);
  if(!entityRows.length){await conn.rollback();return jsonNoStore({error:{code:"CONFIGURATION_NOT_READY",message:"The invoice legal entity is not active."}},409);}
  const alreadyPaid=await paidOnInvoice(conn,invoiceId);
  const total=units(invoice.grand_total);
  const outstanding=total>alreadyPaid?total-alreadyPaid:0n;
  const allocated=await allocatedOnReceipt(conn,payment.id);
  const unallocated=units(payment.amount)-allocated;
  const requested=units(input.amount);
  if(requested>unallocated){
   await conn.rollback();return jsonNoStore({error:{code:"ALLOCATION_EXCEEDS_RECEIPT",message:"Allocation exceeds the receipt's unallocated balance.",details:{unallocatedAmount:money(unallocated),currency:payment.currency}}},409);
  }
  if(requested>outstanding){
   await conn.rollback();return jsonNoStore({error:{code:"ALLOCATION_EXCEEDS_BALANCE",message:"Allocation exceeds the invoice's outstanding balance.",details:{outstandingBalance:money(outstanding),currency:invoice.currency}}},409);
  }
  const allocationId=randomUUID();
  await conn.execute(
   "INSERT INTO payment_allocations (id,payment_id,invoice_id,amount,idempotency_key,created_by) VALUES (?,?,?,?,?,?)",
   [allocationId,payment.id,invoiceId,money(requested),key,actor.userId]);
  const [createdAllocationRows]=await conn.execute<(RowDataPacket & {created_at:Date|string})[]>(
   "SELECT created_at FROM payment_allocations WHERE id=? LIMIT 1",[allocationId]);
  await conn.execute(
   "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json) VALUES (?,?,'payment.allocated','invoice',?,'SUCCESS',?,?)",
   [randomUUID(),actor.userId,invoiceId,
    JSON.stringify({paidAmount:money(alreadyPaid),outstandingBalance:money(outstanding)}),
    JSON.stringify({allocationId,paymentId:payment.id,amount:money(requested),receiptReference:payment.receipt_reference,
     paidAmount:money(alreadyPaid+requested),outstandingBalance:money(total>alreadyPaid+requested?total-alreadyPaid-requested:0n)})]);
   await captureDocumentSourceSnapshot(conn,"INVOICE",invoiceId,actor.userId,"STATUS_CHANGE");
  await conn.commit();
  const nextAllocated=allocated+requested;
  return jsonNoStore({data:{id:allocationId,paymentId:payment.id,receiptReference:payment.receipt_reference??"RCPT-"+payment.id.replaceAll("-","").toUpperCase(),
   invoiceId,amount:money(requested),currency:payment.currency,createdAt:createdAllocationRows[0]?.created_at??new Date().toISOString(),
   allocatedAmount:money(nextAllocated),unallocatedAmount:money(units(payment.amount)-nextAllocated),paidAmount:money(alreadyPaid+requested),
   outstandingBalance:money(total>alreadyPaid+requested?total-alreadyPaid-requested:0n),idempotentReplay:false},meta:{}},201);
 }catch(error){
  if(conn)await conn.rollback().catch(()=>undefined);
  if(duplicate(error))return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This allocation conflicts with an existing record or idempotency key."}},409);
  return apiError(error);
 }finally{conn?.release();}
}
