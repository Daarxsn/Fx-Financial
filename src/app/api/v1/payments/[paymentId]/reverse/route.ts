import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{paymentId:string}>};
const SCALE=10_000n;
function units(value:string|number){const [whole,fraction=""]=String(value).split(".");return BigInt(whole)*SCALE+BigInt((fraction+"0000").slice(0,4));}
function money(value:bigint){return (value/SCALE).toString()+"."+(value%SCALE).toString().padStart(4,"0");}
function uuid(value:string){return /^[0-9a-f-]{36}$/i.test(value);}
function duplicate(error:unknown){return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY";}
const schema=z.object({reason:z.string().trim().min(3).max(1000)}).strict();
type Payment=RowDataPacket & {id:string;legal_entity_id:string|null;customer_id:string;amount:string|number;currency:string;payment_date:Date|string;method:string;reference:string|null;status:string;receipt_reference:string|null;reversed_at:Date|string|null;reversal_reason:string|null};
type Allocation=RowDataPacket & {id:string;invoice_id:string;amount:string|number};

export async function POST(request:NextRequest,context:Context){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("payments:reverse");
  const {paymentId}=await context.params;
  if(!uuid(paymentId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"paymentId must be a UUID."}},400);
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  if(!/^[\x21-\x7e]{16,128}$/.test(key))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Idempotency-Key must contain 16–128 visible ASCII characters."}},400);
  const input=schema.parse(await request.json());
  conn=await pool.getConnection();await conn.beginTransaction();
  const [eventRows]=await conn.execute<(RowDataPacket & {id:string;payment_id:string;reason:string;amount:string|number;currency:string})[]>(
   "SELECT id,payment_id,reason,amount,currency FROM payment_reversal_events WHERE idempotency_key=? LIMIT 1 FOR UPDATE",[key]);
  if(eventRows.length){
   const event=eventRows[0];
   if(event.payment_id!==paymentId||event.reason!==input.reason){
    await conn.rollback();return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This Idempotency-Key was already used for a different reversal."}},409);
   }
   const [replayRows]=await conn.execute<Payment[]>(
    "SELECT id,legal_entity_id,customer_id,amount,currency,payment_date,method,reference,status,receipt_reference,reversed_at,reversal_reason FROM payments WHERE id=? LIMIT 1 FOR UPDATE",[paymentId]);
   if(!replayRows.length||!replayRows[0].legal_entity_id||!actor.legalEntityIds.includes(replayRows[0].legal_entity_id)){
    await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);
   }
   const row=replayRows[0];await conn.commit();
   return jsonNoStore({data:{id:row.id,receiptReference:row.receipt_reference??"RCPT-"+row.id.replaceAll("-","").toUpperCase(),
    legalEntityId:row.legal_entity_id,customerId:row.customer_id,amount:money(units(row.amount)),currency:row.currency,
    paymentDate:row.payment_date instanceof Date?row.payment_date.toISOString().slice(0,10):String(row.payment_date).slice(0,10),
    method:row.method,reference:row.reference,status:row.status,reversedAt:row.reversed_at,reversalReason:row.reversal_reason,
    reversalEventId:event.id,idempotentReplay:true},meta:{}},200);
  }

  const [beforeRows]=await conn.execute<Payment[]>(
   "SELECT id,legal_entity_id,customer_id,amount,currency,payment_date,method,reference,status,receipt_reference,reversed_at,reversal_reason FROM payments WHERE id=? LIMIT 1",[paymentId]);
  if(!beforeRows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);}
  const before=beforeRows[0];
  if(!before.legal_entity_id||!actor.legalEntityIds.includes(before.legal_entity_id)){
   await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);
  }
  const [allocationPreview]=await conn.execute<Allocation[]>(
   "SELECT id,invoice_id,amount FROM payment_allocations WHERE payment_id=? ORDER BY invoice_id,id",[paymentId]);
  const previewIds=[...new Set(allocationPreview.map(a=>a.invoice_id))].sort();
  const invoiceContext:Record<string,{legal_entity_id:string;customer_id:string;currency:string;grand_total:string|number}>={};
  for(const invoiceId of previewIds){
   const [rows]=await conn.execute<(RowDataPacket & {id:string;legal_entity_id:string;customer_id:string;currency:string;grand_total:string|number})[]>(
    "SELECT id,legal_entity_id,customer_id,currency,grand_total FROM invoices WHERE id=? LIMIT 1 FOR UPDATE",[invoiceId]);
   if(!rows.length){await conn.rollback();return jsonNoStore({error:{code:"CONFIGURATION_CONFLICT",message:"A payment allocation references a missing invoice; reversal is blocked for manual review."}},409);}
   invoiceContext[invoiceId]={legal_entity_id:rows[0].legal_entity_id,customer_id:rows[0].customer_id,currency:rows[0].currency,grand_total:rows[0].grand_total};
  }
  for(const invoiceId of previewIds){
   const item=invoiceContext[invoiceId];
   if(item.legal_entity_id!==before.legal_entity_id||item.customer_id!==before.customer_id||item.currency!==before.currency){
    await conn.rollback();return jsonNoStore({error:{code:"CONFIGURATION_CONFLICT",message:"Receipt allocations cross the receipt's entity, customer or currency boundary; reversal is blocked for manual review."}},409);
   }
  }
  const [paymentRows]=await conn.execute<Payment[]>(
   "SELECT id,legal_entity_id,customer_id,amount,currency,payment_date,method,reference,status,receipt_reference,reversed_at,reversal_reason FROM payments WHERE id=? LIMIT 1 FOR UPDATE",[paymentId]);
  if(!paymentRows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);}
  const payment=paymentRows[0];
  if(!payment.legal_entity_id||payment.legal_entity_id!==before.legal_entity_id||!actor.legalEntityIds.includes(payment.legal_entity_id)){
   await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Payment not found in your assigned scope."}},404);
  }
  if(payment.status!=="RECORDED"){
   await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_ALREADY_REVERSED",message:"This receipt has already been reversed."}},409);
  }
  const [currentAllocations]=await conn.execute<Allocation[]>(
   "SELECT id,invoice_id,amount FROM payment_allocations WHERE payment_id=? ORDER BY invoice_id,id",[paymentId]);
  const currentIds=[...new Set(currentAllocations.map(a=>a.invoice_id))].sort();
  if(currentIds.join(",")!==previewIds.join(",")){
   await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_CHANGED_RETRY",message:"Receipt allocations changed concurrently. Reload the receipt and retry reversal."}},409);
  }
  const beforeBalances:Record<string,{paid:bigint;total:bigint}>={};
  for(const invoiceId of currentIds){
   const [paidRows]=await conn.execute<(RowDataPacket & {paid:string|number})[]>(
    "SELECT COALESCE(SUM(pa.amount),0) AS paid FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=? AND p.status='RECORDED'",[invoiceId]);
   beforeBalances[invoiceId]={paid:units(paidRows[0]?.paid??"0"),total:units(invoiceContext[invoiceId].grand_total)};
  }
  const eventId=randomUUID();
  await conn.execute(
   "INSERT INTO payment_reversal_events (id,payment_id,amount,currency,reason,reversed_by,idempotency_key) VALUES (?,?,?,?,?,?,?)",
   [eventId,paymentId,money(units(payment.amount)),payment.currency,input.reason,actor.userId,key]);
  const [updated]=await conn.execute<ResultSetHeader>(
   "UPDATE payments SET status='REVERSED',reversed_at=NOW(3),reversed_by=?,reversal_reason=? WHERE id=? AND status='RECORDED'",
   [actor.userId,input.reason,paymentId]);
  if(updated.affectedRows!==1){await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_ALREADY_REVERSED",message:"This receipt has already been reversed."}},409);}
  await conn.execute(
   "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json) VALUES (?,?,'payment.reversed','payment',?,'SUCCESS',?,?)",
   [randomUUID(),actor.userId,paymentId,JSON.stringify({status:"RECORDED",amount:money(units(payment.amount)),currency:payment.currency}),
    JSON.stringify({status:"REVERSED",amount:money(units(payment.amount)),currency:payment.currency,reason:input.reason,reversalEventId:eventId,allocationCount:currentAllocations.length})]);
  for(const invoiceId of currentIds){
   const beforeBalance=beforeBalances[invoiceId];
   const removed=currentAllocations.filter(a=>a.invoice_id===invoiceId).reduce((total,a)=>total+units(a.amount),0n);
   const nextPaid=beforeBalance.paid>removed?beforeBalance.paid-removed:0n;
   const beforeOutstanding=beforeBalance.total>beforeBalance.paid?beforeBalance.total-beforeBalance.paid:0n;
   const nextOutstanding=beforeBalance.total>nextPaid?beforeBalance.total-nextPaid:0n;
   await conn.execute(
    "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json) VALUES (?,?,'payment.reversal.balance-restored','invoice',?,'SUCCESS',?,?)",
    [randomUUID(),actor.userId,invoiceId,JSON.stringify({paidAmount:money(beforeBalance.paid),outstandingBalance:money(beforeOutstanding)}),
     JSON.stringify({paymentId,reversalEventId:eventId,paidAmount:money(nextPaid),outstandingBalance:money(nextOutstanding),reason:input.reason})]);
  }
  await conn.commit();
  return jsonNoStore({data:{id:payment.id,receiptReference:payment.receipt_reference??"RCPT-"+payment.id.replaceAll("-","").toUpperCase(),
   legalEntityId:payment.legal_entity_id,customerId:payment.customer_id,amount:money(units(payment.amount)),currency:payment.currency,
   paymentDate:payment.payment_date instanceof Date?payment.payment_date.toISOString().slice(0,10):String(payment.payment_date).slice(0,10),
   method:payment.method,reference:payment.reference,status:"REVERSED",reversedAt:new Date().toISOString(),reversalReason:input.reason,
   reversalEventId:eventId,idempotentReplay:false},meta:{}},200);
 }catch(error){
  if(conn)await conn.rollback().catch(()=>undefined);
  if(duplicate(error))return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This payment reversal conflicted with an existing reversal."}},409);
  return apiError(error);
 }finally{conn?.release();}
}
