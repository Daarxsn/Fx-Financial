import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { requireFinanceConfigurationApprover } from "@/lib/configuration/authorization";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const schema=z.object({decision:z.enum(["APPROVE","REJECT"]),reason:z.string().trim().min(10).max(1000)}).strict();
type RequestRow=RowDataPacket&{id:string;invoice_id:string;legal_entity_id:string;correction_type:string;reason:string;status:string;requested_by:string;invoice_number_snapshot:string|null};
type InvoiceRow=RowDataPacket&{id:string;lifecycle_status:string;document_type:string;invoice_number:string|null};
type PolicyRow=RowDataPacket&{decision_key:string;status:string;decision_code:string|null};
function hasPositiveMoney(value:string|number):boolean{
 const raw=String(value);if(!/^\d+(?:\.\d+)?$/.test(raw))return true;
 const [whole="0",fraction=""]=raw.split(".");return BigInt(whole)*10000n+BigInt((fraction+"0000").slice(0,4))>0n;
}
export async function POST(request:NextRequest,context:{params:Promise<{requestId:string}>}){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("invoices:cancel");
  requireFinanceConfigurationApprover(actor);
  await requirePermission("approvals:decide");
  const {requestId}=await context.params;
  if(!/^[0-9a-f-]{36}$/i.test(requestId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"requestId must be a UUID."}},400);
  const input=schema.parse(await request.json());
  conn=await pool.getConnection();await conn.beginTransaction();
  const [requests]=await conn.execute<RequestRow[]>("SELECT id,invoice_id,legal_entity_id,correction_type,reason,status,requested_by,invoice_number_snapshot FROM invoice_correction_requests WHERE id=? LIMIT 1 FOR UPDATE",[requestId]);
  if(!requests.length||!actor.legalEntityIds.includes(requests[0].legal_entity_id)){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Correction request was not found in your assigned scope."}},404);}
  const item=requests[0];
  if(item.status!=="PENDING_REVIEW"){await conn.rollback();return jsonNoStore({error:{code:"CORRECTION_ALREADY_REVIEWED",message:"This correction request has already been decided."}},409);}
  if(item.requested_by===actor.userId){await conn.rollback();return jsonNoStore({error:{code:"SEPARATION_OF_DUTIES",message:"The requester cannot review their own correction request."}},409);}
  if(input.decision==="REJECT"){
   await conn.execute<ResultSetHeader>("UPDATE invoice_correction_requests SET status='REJECTED',reviewed_by=?,review_decision='REJECT',review_reason=?,reviewed_at=NOW(3),updated_at=NOW(3) WHERE id=? AND status='PENDING_REVIEW'",[actor.userId,input.reason,requestId]);
   await conn.execute("INSERT INTO invoice_correction_request_events (id,request_id,event_type,previous_status,new_status,reason,actor_id) VALUES (?,?,'REJECTED','PENDING_REVIEW','REJECTED',?,?)",[randomUUID(),requestId,input.reason,actor.userId]);
   await conn.execute("INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,correlation_id,change_reason) VALUES (?,?,'invoice.correction.rejected','invoice',?,'SUCCESS',?,?,?,?)",[randomUUID(),actor.userId,item.invoice_id,JSON.stringify({requestId,status:"PENDING_REVIEW"}),JSON.stringify({requestId,status:"REJECTED",reviewReason:input.reason}),randomUUID(),input.reason]);
   await conn.commit();
   return jsonNoStore({data:{requestId,status:"REJECTED",reviewedBy:actor.userId}});
  }
  if(item.correction_type!=="CANCEL"){
   await conn.rollback();
   return jsonNoStore({error:{code:"CORRECTION_TREATMENT_BLOCKED",message:"Credit/debit-note execution remains blocked until the issuer's tax, numbering, template and statutory note-treatment policy is explicitly approved and implemented. The request remains pending for safe review."}},409);
  }
  const [policies]=await conn.execute<PolicyRow[]>("SELECT decision_key,status,decision_code FROM business_policy_decisions WHERE legal_entity_id IS NULL AND decision_key IN ('D-08','D-09','D-10') FOR SHARE");
  const byKey=new Map(policies.map(p=>[p.decision_key,p]));
  const d08=byKey.get("D-08"),d09=byKey.get("D-09"),d10=byKey.get("D-10");
  if(!d08||d08.status!=="APPROVED"||!d09||d09.status!=="APPROVED"||!d10||d10.status!=="APPROVED"){
   await conn.rollback();return jsonNoStore({error:{code:"POLICY_APPROVAL_REQUIRED",message:"Payment-state and separation-of-duties policy decisions must be approved before a cancellation can execute."}},409);
  }
  if(d09.decision_code==="NO_CANCELLATION"){
   await conn.rollback();return jsonNoStore({error:{code:"CANCELLATION_PROHIBITED",message:"The recorded correction policy prohibits cancellation."}},409);
  }
  if(d09.decision_code!=="CANCEL_UNPAID_ONLY"){
   await conn.rollback();return jsonNoStore({error:{code:"CORRECTION_PATH_REQUIRED",message:"The approved correction policy requires a credit/debit note or a case-specific path. Direct cancellation is not allowed by this decision."}},409);
  }
  const [invoiceRows]=await conn.execute<InvoiceRow[]>("SELECT id,lifecycle_status,document_type,invoice_number FROM invoices WHERE id=? LIMIT 1 FOR UPDATE",[item.invoice_id]);
  if(!invoiceRows.length||invoiceRows[0].lifecycle_status!=="ISSUED"||invoiceRows[0].document_type!=="INVOICE"){
   await conn.rollback();return jsonNoStore({error:{code:"CORRECTION_SOURCE_CHANGED",message:"The original invoice is no longer an issued invoice. No correction was executed."}},409);
  }
  const [allocationRows]=await conn.execute<(RowDataPacket&{active_allocations:string|number})[]>(
   "SELECT COALESCE(SUM(pa.amount),0) AS active_allocations FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=? AND p.status='RECORDED'",[item.invoice_id]);
  if(hasPositiveMoney(allocationRows[0]?.active_allocations??0)){
   await conn.rollback();return jsonNoStore({error:{code:"PAYMENT_STATE_GUARD",message:"This invoice has active recorded payment allocations. Reverse or resolve payment state under the approved finance policy before requesting cancellation."}},409);
  }
  const [cancelled]=await conn.execute<ResultSetHeader>(
   "UPDATE invoices SET lifecycle_status='CANCELLED',cancelled_at=NOW(3),cancelled_by=?,cancellation_reason=?,updated_at=NOW(3) WHERE id=? AND lifecycle_status='ISSUED'",
   [actor.userId,item.reason,item.invoice_id]);
  if(cancelled.affectedRows!==1){await conn.rollback();return jsonNoStore({error:{code:"CORRECTION_SOURCE_CHANGED",message:"The invoice state changed before cancellation. Refresh and re-review."}},409);}
  await conn.execute<ResultSetHeader>("UPDATE invoice_correction_requests SET status='EXECUTED',reviewed_by=?,review_decision='APPROVE',review_reason=?,reviewed_at=NOW(3),executed_at=NOW(3),updated_at=NOW(3) WHERE id=? AND status='PENDING_REVIEW'",[actor.userId,input.reason,requestId]);
  await conn.execute("INSERT INTO invoice_correction_request_events (id,request_id,event_type,previous_status,new_status,reason,actor_id) VALUES (?,?,'EXECUTED','PENDING_REVIEW','EXECUTED',?,?)",[randomUUID(),requestId,input.reason,actor.userId]);
  await conn.execute("INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,correlation_id,change_reason) VALUES (?,?,'invoice.cancelled','invoice',?,'SUCCESS',?,?,?,?)",[randomUUID(),actor.userId,item.invoice_id,JSON.stringify({status:"ISSUED",invoiceNumber:item.invoice_number_snapshot}),JSON.stringify({status:"CANCELLED",correctionRequestId:requestId,cancelledBy:actor.userId}),randomUUID(),item.reason]);
  await conn.execute("INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,correlation_id,change_reason) VALUES (?,?,'invoice.correction.executed','invoice_correction_request',?,'SUCCESS',?,?,?,?)",[randomUUID(),actor.userId,requestId,JSON.stringify({status:"PENDING_REVIEW"}),JSON.stringify({status:"EXECUTED",invoiceId:item.invoice_id,invoiceNumber:item.invoice_number_snapshot}),randomUUID(),input.reason]);
  await conn.commit();
  return jsonNoStore({data:{requestId,status:"EXECUTED",decision:"APPROVE",invoiceId:item.invoice_id,invoiceStatus:"CANCELLED",invoiceNumber:item.invoice_number_snapshot,reviewedBy:actor.userId}});
 }catch(error){if(conn)await conn.rollback().catch(()=>undefined);return apiError(error);}finally{conn?.release();}
}
