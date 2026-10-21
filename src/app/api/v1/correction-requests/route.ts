import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requireSession, type SessionPrincipal } from "@/lib/auth/session";
import { AuthorizationError, requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const uuidPattern=/^[0-9a-f-]{36}$/i;
const createSchema=z.object({
  invoiceId:z.string().uuid(),
  correctionType:z.enum(["CANCEL","CREDIT_NOTE","DEBIT_NOTE"]),
  reason:z.string().trim().min(10).max(1000),
}).strict();
type InvoiceRow=RowDataPacket&{id:string;legal_entity_id:string;invoice_number:string|null;document_type:string;lifecycle_status:string};
type RequestRow=RowDataPacket&{
 id:string;invoice_id:string;legal_entity_id:string;invoice_number_snapshot:string|null;correction_type:string;reason:string;
 idempotency_key:string;status:string;requested_by:string;reviewed_by:string|null;review_decision:string|null;
 review_reason:string|null;reviewed_at:Date|string|null;executed_at:Date|string|null;created_at:Date|string;updated_at:Date|string;
};

function safeRequest(row:RequestRow){
 return {id:row.id,invoiceId:row.invoice_id,legalEntityId:row.legal_entity_id,invoiceNumber:row.invoice_number_snapshot,
  correctionType:row.correction_type,status:row.status,reason:row.reason,requestedBy:row.requested_by,reviewedBy:row.reviewed_by,
  reviewDecision:row.review_decision,reviewReason:row.review_reason,reviewedAt:row.reviewed_at,executedAt:row.executed_at,
  createdAt:row.created_at,updatedAt:row.updated_at};
}
function canReadQueue(actor:SessionPrincipal){return actor.permissions.includes("approvals:read");}
function duplicateEntry(error:unknown):boolean{
 return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY";
}

export async function GET(request:NextRequest){
 try{
  const actor=await requireSession();
  const queue=canReadQueue(actor);
  if(!queue&&!actor.permissions.includes("invoices:draft:update"))throw new AuthorizationError("FORBIDDEN");
  const scopes=[...new Set(actor.legalEntityIds)];
  if(!scopes.length)return jsonNoStore({data:[],meta:{total:0}});
  const search=request.nextUrl.searchParams;
  const status=search.get("status")??"all";
  if(!["all","PENDING_REVIEW","REJECTED","EXECUTED"].includes(status))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"status must be all, PENDING_REVIEW, REJECTED or EXECUTED."}},400);
  const invoiceId=search.get("invoiceId");
  if(invoiceId!==null&&!uuidPattern.test(invoiceId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"invoiceId must be a UUID."}},400);
  const limit=Number(search.get("limit")??"50"),offset=Number(search.get("offset")??"0");
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"limit must be 1–100 and offset must be between 0 and 1000000."}},400);
  const clauses=["r.legal_entity_id IN ("+scopes.map(()=>"?").join(",")+")"],params:unknown[]=[...scopes];
  if(!queue){clauses.push("r.requested_by=?");params.push(actor.userId);}
  if(status!=="all"){clauses.push("r.status=?");params.push(status);}
  if(invoiceId){clauses.push("r.invoice_id=?");params.push(invoiceId);}
  const where=clauses.join(" AND ");
  const [rows]=await pool.query<RequestRow[]>(
   "SELECT r.id,r.invoice_id,r.legal_entity_id,r.invoice_number_snapshot,r.correction_type,r.reason,r.idempotency_key,r.status,r.requested_by,r.reviewed_by,r.review_decision,r.review_reason,r.reviewed_at,r.executed_at,r.created_at,r.updated_at "+
   "FROM invoice_correction_requests r WHERE "+where+" ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?",
   [...params,limit,offset]);
  const [[count]]=await pool.query<(RowDataPacket&{total:number})[]>("SELECT COUNT(*) AS total FROM invoice_correction_requests r WHERE "+where,params);
  let events:RowDataPacket[]=[];
  if(rows.length){
   const ids=rows.map(r=>r.id);
   const [eventRows]=await pool.execute<RowDataPacket[]>(
    "SELECT id,request_id,event_type,previous_status,new_status,reason,actor_id,created_at FROM invoice_correction_request_events WHERE request_id IN ("+ids.map(()=>"?").join(",")+") ORDER BY created_at,CASE event_type WHEN 'REQUESTED' THEN 0 ELSE 1 END,id",ids);
   events=eventRows;
  }
  const byRequest=new Map<string,unknown[]>();
  for(const row of events){
   const id=String(row.request_id);
   byRequest.set(id,[...(byRequest.get(id)??[]),{id:row.id,eventType:row.event_type,previousStatus:row.previous_status,status:row.new_status,reason:row.reason,actorId:row.actor_id,createdAt:row.created_at}]);
  }
  return jsonNoStore({data:rows.map(r=>({...safeRequest(r),history:byRequest.get(r.id)??[]})),meta:{pagination:{limit,offset,total:Number(count.total),hasMore:offset+rows.length<Number(count.total)}}});
 }catch(error){return apiError(error);}
}

export async function POST(request:NextRequest){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("invoices:draft:update");
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  if(!/^[\x21-\x7e]{16,128}$/.test(key))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Idempotency-Key must contain 16–128 visible ASCII characters."}},400);
  const input=createSchema.parse(await request.json());
  conn=await pool.getConnection();await conn.beginTransaction();
  const [existingRows]=await conn.execute<RequestRow[]>(
   "SELECT id,invoice_id,legal_entity_id,invoice_number_snapshot,correction_type,reason,idempotency_key,status,requested_by,reviewed_by,review_decision,review_reason,reviewed_at,executed_at,created_at,updated_at FROM invoice_correction_requests WHERE idempotency_key=? LIMIT 1 FOR UPDATE",[key]);
  if(existingRows.length){
   const existing=existingRows[0];
   const same=existing.requested_by===actor.userId&&existing.invoice_id===input.invoiceId&&existing.correction_type===input.correctionType&&existing.reason===input.reason;
   await conn.rollback();
   if(!actor.legalEntityIds.includes(existing.legal_entity_id))return jsonNoStore({error:{code:"NOT_FOUND",message:"Correction request was not found in your scope."}},404);
   if(!same)return jsonNoStore({error:{code:"DUPLICATE_SUBMISSION",message:"This Idempotency-Key was already used for a different correction request."}},409);
   return jsonNoStore({data:{...safeRequest(existing),idempotentReplay:true}},200);
  }
  const [invoiceRows]=await conn.execute<InvoiceRow[]>(
   "SELECT id,legal_entity_id,invoice_number,document_type,lifecycle_status FROM invoices WHERE id=? LIMIT 1 FOR UPDATE",[input.invoiceId]);
  if(!invoiceRows.length||!actor.legalEntityIds.includes(invoiceRows[0].legal_entity_id)){
   await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Invoice was not found in your assigned scope."}},404);
  }
  const invoice=invoiceRows[0];
  const [pendingRequests]=await conn.execute<(RowDataPacket&{id:string})[]>(
   "SELECT id FROM invoice_correction_requests WHERE invoice_id=? AND status='PENDING_REVIEW' LIMIT 1",
   [invoice.id],
  );
  if(pendingRequests.length){
   await conn.rollback();
   return jsonNoStore({error:{code:"CORRECTION_ALREADY_PENDING",message:"This issued invoice already has a pending correction request. Review it before opening another request."}},409);
  }
  if(invoice.document_type!=="INVOICE"){
   await conn.rollback();return jsonNoStore({error:{code:"CORRECTION_SOURCE_UNSUPPORTED",message:"Correction requests must reference an issued source invoice."}},409);
  }
  if(invoice.lifecycle_status!=="ISSUED"){
   await conn.rollback();return jsonNoStore({error:{code:"CORRECTION_SOURCE_NOT_ISSUED",message:"Only an issued invoice can enter the correction review workflow."}},409);
  }
  const requestId=randomUUID();
  await conn.execute<ResultSetHeader>(
   "INSERT INTO invoice_correction_requests (id,invoice_id,legal_entity_id,invoice_number_snapshot,correction_type,reason,idempotency_key,status,requested_by) VALUES (?,?,?,?,?,?,?,'PENDING_REVIEW',?)",
   [requestId,invoice.id,invoice.legal_entity_id,invoice.invoice_number,input.correctionType,input.reason,key,actor.userId]);
  await conn.execute(
   "INSERT INTO invoice_correction_request_events (id,request_id,event_type,previous_status,new_status,reason,actor_id) VALUES (?,?,'REQUESTED',NULL,'PENDING_REVIEW',?,?)",
   [randomUUID(),requestId,input.reason,actor.userId]);
  await conn.execute(
   "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,correlation_id,change_reason) VALUES (?,?,'invoice.correction.requested','invoice',?,'SUCCESS',NULL,?,?,?)",
   [randomUUID(),actor.userId,invoice.id,JSON.stringify({requestId,invoiceNumber:invoice.invoice_number,correctionType:input.correctionType,status:"PENDING_REVIEW"}),randomUUID(),input.reason]);
  await conn.commit();
  return jsonNoStore({data:{id:requestId,invoiceId:invoice.id,invoiceNumber:invoice.invoice_number,legalEntityId:invoice.legal_entity_id,
   correctionType:input.correctionType,status:"PENDING_REVIEW",reason:input.reason,requestedBy:actor.userId,idempotentReplay:false}},201);
 }catch(error){
  if(conn)await conn.rollback().catch(()=>undefined);
  if(duplicateEntry(error))return jsonNoStore({error:{code:"CORRECTION_ALREADY_PENDING",message:"A correction request with this idempotency key or a pending request for this invoice already exists."}},409);
  return apiError(error);
 }finally{conn?.release();}
}
