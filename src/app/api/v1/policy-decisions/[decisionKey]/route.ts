import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { requireFinanceConfigurationApprover } from "@/lib/configuration/authorization";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const globalKeys=new Set(["D-01","D-05","D-08","D-09","D-10","D-12"]);
const entityKeys=new Set(["D-02","D-03","D-04","D-06","D-07","D-11"]);
const inputSchema=z.object({
 legalEntityId:z.string().uuid().optional().nullable(),status:z.enum(["PENDING","APPROVED","NOT_APPLICABLE","BLOCKED"]),
 decisionCode:z.string().trim().min(2).max(80).optional().nullable(),decisionText:z.string().trim().min(10).max(4000).optional().nullable(),
 rationale:z.string().trim().min(10).max(2000),externalApproverName:z.string().trim().min(2).max(160).optional().nullable(),
 externalApproverRole:z.string().trim().min(2).max(160).optional().nullable(),approvalReference:z.string().trim().min(3).max(255).optional().nullable(),
 approvalDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
}).strict();
type DecisionRow=RowDataPacket&{id:string;legal_entity_id:string|null;status:string;decision_code:string|null};
export async function PATCH(request:NextRequest,context:{params:Promise<{decisionKey:string}>}){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("settings:manage");
  requireFinanceConfigurationApprover(actor);
  const {decisionKey}=await context.params;
  if(!/^D-(0[1-9]|1[0-2])$/.test(decisionKey))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"decisionKey must be one of D-01 through D-12."}},400);
  const input=inputSchema.parse(await request.json());
  if(globalKeys.has(decisionKey)&&input.legalEntityId)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"This decision is global and must not include legalEntityId."}},422);
  if(entityKeys.has(decisionKey)&&!input.legalEntityId)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"This decision requires a legalEntityId for issuer-specific approval."}},422);
  if(input.legalEntityId&&!actor.legalEntityIds.includes(input.legalEntityId))return jsonNoStore({error:{code:"NOT_FOUND",message:"Legal entity is outside your assigned scope."}},404);
  if(input.status==="NOT_APPLICABLE"&&!((decisionKey==="D-11"&&entityKeys.has(decisionKey))||(decisionKey==="D-12"&&globalKeys.has(decisionKey))) )return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Only statutory applicability (D-11) or global communications/templates (D-12) may be marked not applicable."}},422);
  if(decisionKey==="D-09"&&input.status==="NOT_APPLICABLE")return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"The correction policy cannot be not applicable; explicitly select and evidence a correction path."}},422);
  const resolved=input.status==="APPROVED"||input.status==="NOT_APPLICABLE";
  if(resolved&&(!input.decisionText||!input.externalApproverName||!input.externalApproverRole||!input.approvalReference||!input.approvalDate))return jsonNoStore({error:{code:"APPROVAL_EVIDENCE_REQUIRED",message:"Resolved decisions require decision text, external approver name/role, approval date and evidence reference."}},422);
  if(decisionKey==="D-09"&&input.status==="APPROVED"&&!["CANCEL_UNPAID_ONLY","CREDIT_DEBIT_NOTE_REQUIRED","CANCEL_OR_NOTE","NO_CANCELLATION"].includes(input.decisionCode??""))return jsonNoStore({error:{code:"CORRECTION_MODE_REQUIRED",message:"D-09 requires an explicit correction mode."}},422);
  if(input.approvalDate){const parsed=new Date(input.approvalDate+"T00:00:00.000Z");if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==input.approvalDate)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"approvalDate must be a real calendar date."}},422);}
  conn=await pool.getConnection();await conn.beginTransaction();
  const [rows]=await conn.execute<DecisionRow[]>("SELECT id,legal_entity_id,status,decision_code FROM business_policy_decisions WHERE decision_key=? AND ((legal_entity_id IS NULL AND ? IS NULL) OR legal_entity_id=?) LIMIT 1 FOR UPDATE",[decisionKey,input.legalEntityId??null,input.legalEntityId??null]);
  if(!rows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Policy decision was not found for the requested scope."}},404);}
  const current=rows[0],code=resolved?input.decisionCode??null:null,text=input.decisionText??null;
  const name=resolved?input.externalApproverName??null:null,role=resolved?input.externalApproverRole??null:null,reference=resolved?input.approvalReference??null:null,date=resolved?input.approvalDate??null:null;
  await conn.execute("UPDATE business_policy_decisions SET status=?,decision_code=?,decision_text=?,rationale=?,external_approver_name=?,external_approver_role=?,approval_reference=?,approval_date=?,recorded_by=?,recorded_at=NOW(3),updated_by=?,updated_at=NOW(3) WHERE id=?",[input.status,code,text,input.rationale,name,role,reference,date,resolved?actor.userId:null,actor.userId,current.id]);
  await conn.execute("INSERT INTO business_policy_decision_events (id,policy_decision_id,previous_status,new_status,decision_code,decision_text,rationale,external_approver_name,external_approver_role,approval_reference,approval_date,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",[randomUUID(),current.id,current.status,input.status,code,text,input.rationale,name,role,reference,date,actor.userId]);
  await conn.execute("INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,correlation_id,change_reason) VALUES (?,?,'business_policy.decision.recorded','business_policy_decision',?,'SUCCESS',?,?,?,?)",[randomUUID(),actor.userId,current.id,JSON.stringify({status:current.status,decisionCode:current.decision_code}),JSON.stringify({decisionKey,legalEntityId:input.legalEntityId??null,status:input.status,decisionCode:code,approvalReference:reference}),randomUUID(),input.rationale]);
  await conn.commit();
  return jsonNoStore({data:{decisionKey,legalEntityId:input.legalEntityId??null,status:input.status,decisionCode:code,updatedBy:actor.userId}});
 }catch(error){if(conn)await conn.rollback().catch(()=>undefined);return apiError(error);}finally{conn?.release();}
}
