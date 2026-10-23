import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { canonicalJson } from "@/lib/configuration/service";
import { outstandingBalance, subtractMoney } from "@/lib/finance/invoice-calculation";
import { customerNameFromSnapshot } from "@/lib/finance/document-snapshot";
import { invoiceCalendarDateSchema, invoiceDraftCreateSchema } from "@/lib/validation/invoice";
import { validateDraftContext, resolveDraftLines, persistDraftLines, auditDraftChange, InvoiceDraftValidationError } from "@/lib/finance/invoice-draft-service";

export const runtime="nodejs"; export const dynamic="force-dynamic";
function dateText(v:Date|string|null):string|null{return v===null?null:v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);}
function money(v:unknown):string{return String(v??"0.0000");}
function paymentState(total:string,paid:string):"UNPAID"|"PARTIALLY_PAID"|"PAID"{if(total!=="0.0000"&&outstandingBalance(total,paid)==="0.0000")return "PAID";if(paid!=="0.0000")return "PARTIALLY_PAID";return "UNPAID";}
function validationError(error:unknown){if(error instanceof InvoiceDraftValidationError)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:error.message}},422);return apiError(error);}
function duplicateEntry(error:unknown){return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY";}

export async function GET(request:NextRequest){
 try{
  const actor=await requirePermission("invoices:read");
  const scope=[...new Set(actor.legalEntityIds)];
  const status=request.nextUrl.searchParams.get("status")??"all";
  if(!["all","DRAFT","ISSUED","CANCELLED"].includes(status))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"status must be all, DRAFT, ISSUED or CANCELLED"}},400);
  const limit=Number(request.nextUrl.searchParams.get("limit")??"25"),offset=Number(request.nextUrl.searchParams.get("offset")??"0");
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"limit must be 1–100 and offset must be between 0 and 1000000"}},400);
  const entityId=request.nextUrl.searchParams.get("legalEntityId"),customerId=request.nextUrl.searchParams.get("customerId");
  const dateFrom=request.nextUrl.searchParams.get("invoiceDateFrom"),dateTo=request.nextUrl.searchParams.get("invoiceDateTo");
  if(entityId&&!scope.includes(entityId))return jsonNoStore({error:{code:"NOT_FOUND",message:"Legal entity not found in your assigned scope."}},404);
  if(customerId&&!/^[0-9a-f-]{36}$/i.test(customerId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"customerId must be a UUID"}},400);
  if(dateFrom&&!invoiceCalendarDateSchema.safeParse(dateFrom).success||dateTo&&!invoiceCalendarDateSchema.safeParse(dateTo).success)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Invoice date filters must be real YYYY-MM-DD dates"}},400);
  if(dateFrom&&dateTo&&dateFrom>dateTo)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"invoiceDateFrom cannot be later than invoiceDateTo"}},400);
  if(!scope.length)return jsonNoStore({data:[],pagination:{limit,offset,total:0,hasMore:false}});
  const clauses:string[]=[`i.legal_entity_id IN (${scope.map(()=>"?").join(",")})`],params:unknown[]=[...scope];
  if(entityId){clauses.push("i.legal_entity_id=?");params.push(entityId);}
  if(status!=="all"){clauses.push("i.lifecycle_status=?");params.push(status);}
  if(customerId){clauses.push("i.customer_id=?");params.push(customerId);}
  if(dateFrom){clauses.push("i.invoice_date>=?");params.push(dateFrom);}
  if(dateTo){clauses.push("i.invoice_date<=?");params.push(dateTo);}
  const query=(request.nextUrl.searchParams.get("query")??"").trim().slice(0,100);
  if(query){const escaped=query.replace(/[\\%_]/g,"\\$&");clauses.push("(i.invoice_number LIKE ? OR c.name LIKE ?)");params.push(`%${escaped}%`,`%${escaped}%`);}
  const where="WHERE "+clauses.join(" AND ");
  const [rows]=await pool.query<(RowDataPacket & {id:string;legal_entity_id:string;brand_id:string|null;customer_id:string;document_type:string;related_invoice_id:string|null;invoice_number:string|null;lifecycle_status:string;currency:string;subtotal:string;discount_total:string;tax_total:string;grand_total:string;invoice_date:Date|string|null;due_date:Date|string|null;payment_terms_days:number;record_version:number;customer_name:string;customer_snapshot:unknown;created_at:Date|string;updated_at:Date|string;paid_total:string})[]>(
   `SELECT i.id,i.legal_entity_id,i.brand_id,i.customer_id,i.document_type,i.related_invoice_id,i.invoice_number,i.lifecycle_status,i.currency,
      i.subtotal,i.discount_total,i.tax_total,i.grand_total,i.invoice_date,i.due_date,i.payment_terms_days,i.record_version,
      c.name AS customer_name,i.customer_snapshot,i.created_at,i.updated_at,
      COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'),0) AS paid_total
    FROM invoices i JOIN customers c ON c.id=i.customer_id ${where}
    ORDER BY COALESCE(i.invoice_date,DATE(i.created_at)) DESC,i.created_at DESC,i.id DESC LIMIT ? OFFSET ?`,
   [...params,limit,offset]);
  const [[count]] = await pool.query<(RowDataPacket & {total:number})[]>(`SELECT COUNT(*) AS total FROM invoices i JOIN customers c ON c.id=i.customer_id ${where}`,params);
  return jsonNoStore({data:rows.map(r=>{const total=money(r.grand_total),paid=money(r.paid_total);return {
   id:r.id,legalEntityId:r.legal_entity_id,brandId:r.brand_id,customerId:r.customer_id,
   customerName:customerNameFromSnapshot(r.customer_snapshot)??r.customer_name,
   documentType:r.document_type,relatedInvoiceId:r.related_invoice_id,invoiceNumber:r.invoice_number,lifecycleStatus:r.lifecycle_status,
   paymentStatus:paymentState(total,paid),currency:r.currency,subtotal:money(r.subtotal),discountTotal:money(r.discount_total),
   taxableValue:subtractMoney(money(r.subtotal),money(r.discount_total)),taxTotal:money(r.tax_total),grandTotal:total,paidAmount:paid,
   outstandingBalance:outstandingBalance(total,paid),invoiceDate:dateText(r.invoice_date),dueDate:dateText(r.due_date),
   paymentTermsDays:Number(r.payment_terms_days),recordVersion:Number(r.record_version),createdAt:r.created_at,updatedAt:r.updated_at,
  };}),pagination:{limit,offset,total:Number(count.total),hasMore:offset+rows.length<Number(count.total)}});
 }catch(error){return apiError(error);}
}

export async function POST(request:NextRequest){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 let requestIdempotencyKey:string|undefined;
 let requestFingerprint:string|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("invoices:draft:create");
  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  if(!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Idempotency-Key must contain 16–128 visible ASCII characters."}},400);
  requestIdempotencyKey=idempotencyKey;
  const input=invoiceDraftCreateSchema.parse(await request.json());
  // A replay must never disclose an invoice ID or status across legal-entity boundaries.
  if(!actor.legalEntityIds.includes(input.legalEntityId)) {
   return jsonNoStore({error:{code:"NOT_FOUND",message:"Legal entity not found in your assigned scope."}},404);
  }
  const fingerprint=createHash("sha256").update(canonicalJson(input)).digest("hex");
  requestFingerprint=fingerprint;
  conn=await pool.getConnection();await conn.beginTransaction();
  const [existing]=await conn.execute<(RowDataPacket & {id:string;idempotency_payload_sha256:string|null;lifecycle_status:string})[]>(
   "SELECT id,idempotency_payload_sha256,lifecycle_status FROM invoices WHERE idempotency_key=? LIMIT 1",[idempotencyKey]);
  if(existing.length){
   await conn.rollback();
   if(existing[0].idempotency_payload_sha256!==fingerprint)return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This Idempotency-Key was already used for a different invoice payload."}},409);
   return jsonNoStore({data:{id:existing[0].id,lifecycleStatus:existing[0].lifecycle_status,idempotentReplay:true}},200);
  }
  const ctx=await validateDraftContext(conn,actor,input);
  const prepared=await resolveDraftLines(conn,ctx.entity,ctx.invoiceDate,input.currency,input.lines);
  const id=randomUUID();
  await conn.execute(
   `INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,record_version,payment_terms_days,
      invoice_date,due_date,currency,subtotal,discount_total,tax_total,grand_total,notes,draft_recipient_email,idempotency_key,idempotency_payload_sha256)
    VALUES (?,?,?,?,'INVOICE','DRAFT',1,?,?,?,?,?,?,?,?,?,?,?,?)`,
   [id,input.legalEntityId,input.brandId??null,input.customerId,ctx.paymentTermsDays,ctx.invoiceDate,ctx.dueDate,input.currency,
    prepared.calculation.subtotal,prepared.calculation.discountTotal,prepared.calculation.taxTotal,prepared.calculation.grandTotal,
    input.notes??null,input.recipientEmail??"",idempotencyKey,fingerprint]);
  await persistDraftLines(conn,id,actor.userId,prepared.lines);
  await auditDraftChange(conn,actor.userId,id,"invoice.draft.created",null,{recordVersion:1,changedFields:["legalEntityId","brandId","customerId","currency","invoiceDate","dueDate","paymentTermsDays","notes","recipientEmail","lines","subtotal","discountTotal","taxTotal","grandTotal"]});
  await conn.commit();
  return jsonNoStore({data:{
   id,legalEntityId:input.legalEntityId,brandId:input.brandId??null,customerId:input.customerId,
   documentType:"INVOICE",lifecycleStatus:"DRAFT",invoiceNumber:null,currency:input.currency,
   invoiceDate:ctx.invoiceDate,dueDate:ctx.dueDate,paymentTermsDays:ctx.paymentTermsDays,draftRecipientEmail:input.recipientEmail??"",
   recordVersion:1,...prepared.calculation,paidAmount:"0.0000",outstandingBalance:prepared.calculation.grandTotal,
   paymentStatus:prepared.calculation.grandTotal==="0.0000"?"UNPAID":"UNPAID",idempotentReplay:false,
  }},201);
 }catch(error){
   if(conn)await conn.rollback().catch(()=>undefined);
   // Two identical submissions can both pass the initial lookup before either insert commits.
   // Reconcile the unique-key race with the winning row and preserve the same replay/conflict contract.
   if(duplicateEntry(error)&&requestIdempotencyKey&&requestFingerprint){
    try{
     const [winner]=await pool.execute<(RowDataPacket & {id:string;idempotency_payload_sha256:string|null;lifecycle_status:string})[]>(
      "SELECT id,idempotency_payload_sha256,lifecycle_status FROM invoices WHERE idempotency_key=? LIMIT 1",[requestIdempotencyKey]);
     if(winner.length){
      if(winner[0].idempotency_payload_sha256!==requestFingerprint)
       return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This Idempotency-Key was already used for a different invoice payload."}},409);
      return jsonNoStore({data:{id:winner[0].id,lifecycleStatus:winner[0].lifecycle_status,idempotentReplay:true}},200);
     }
    }catch{/* Preserve the original database error if reconciliation itself cannot be completed. */}
   }
   return validationError(error);
  }finally{conn?.release();}
}
