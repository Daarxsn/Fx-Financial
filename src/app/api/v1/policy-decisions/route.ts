import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { requireFinanceConfigurationApprover } from "@/lib/configuration/authorization";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type DecisionRow=RowDataPacket&{id:string;decision_key:string;legal_entity_id:string|null;legal_entity_name:string|null;topic:string;recommended_starting_point:string;required_approver:string;requires_issue_gate:number;status:string;decision_code:string|null;decision_text:string|null;rationale:string|null;external_approver_name:string|null;external_approver_role:string|null;approval_reference:string|null;approval_date:Date|string|null;updated_at:Date|string};
export async function GET(){
 try{
  const actor=await requirePermission("settings:manage");
  requireFinanceConfigurationApprover(actor);
  const scopes=[...new Set(actor.legalEntityIds)];
  const where=scopes.length?"(d.legal_entity_id IS NULL OR d.legal_entity_id IN ("+scopes.map(()=>"?").join(",")+"))":"d.legal_entity_id IS NULL";
  const [rows]=await pool.execute<DecisionRow[]>(
   "SELECT d.id,d.decision_key,d.legal_entity_id,le.display_name AS legal_entity_name,d.topic,d.recommended_starting_point,d.required_approver,d.requires_issue_gate,d.status,d.decision_code,d.decision_text,d.rationale,d.external_approver_name,d.external_approver_role,d.approval_reference,d.approval_date,d.updated_at FROM business_policy_decisions d LEFT JOIN legal_entities le ON le.id=d.legal_entity_id WHERE "+where+" ORDER BY d.legal_entity_id,d.decision_key",
   scopes);
  return jsonNoStore({data:rows.map(row=>({decisionKey:row.decision_key,legalEntityId:row.legal_entity_id,legalEntityName:row.legal_entity_name,topic:row.topic,recommendedStartingPoint:row.recommended_starting_point,requiredApprover:row.required_approver,requiresIssueGate:Boolean(row.requires_issue_gate),status:row.status,decisionCode:row.decision_code,decisionText:row.decision_text,rationale:row.rationale,externalApproverName:row.external_approver_name,externalApproverRole:row.external_approver_role,approvalReference:row.approval_reference,approvalDate:row.approval_date===null?null:String(row.approval_date).slice(0,10),updatedAt:row.updated_at})),meta:{total:rows.length}});
 }catch(error){return apiError(error);}
}
