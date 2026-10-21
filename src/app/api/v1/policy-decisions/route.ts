import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { requireFinanceConfigurationApprover } from "@/lib/configuration/authorization";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type DecisionRow=RowDataPacket&{id:string;decision_key:string;legal_entity_id:string|null;legal_entity_name:string|null;topic:string;recommended_starting_point:string;required_approver:string;requires_issue_gate:number;status:string;decision_code:string|null;decision_text:string|null;rationale:string|null;external_approver_name:string|null;external_approver_role:string|null;approval_reference:string|null;approval_date:Date|string|null;updated_at:Date|string};
type DecisionEventRow=RowDataPacket&{id:string;policy_decision_id:string;previous_status:string|null;new_status:string;decision_code:string|null;decision_text:string|null;rationale:string;external_approver_name:string|null;external_approver_role:string|null;approval_reference:string|null;approval_date:Date|string|null;recorded_by:string;created_at:Date|string};
export async function GET(){
 try{
  const actor=await requirePermission("settings:manage");
  requireFinanceConfigurationApprover(actor);
  const scopes=[...new Set(actor.legalEntityIds)];
  const where=scopes.length?"(d.legal_entity_id IS NULL OR d.legal_entity_id IN ("+scopes.map(()=>"?").join(",")+"))":"d.legal_entity_id IS NULL";
  const [rows]=await pool.execute<DecisionRow[]>(
   "SELECT d.id,d.decision_key,d.legal_entity_id,le.display_name AS legal_entity_name,d.topic,d.recommended_starting_point,d.required_approver,d.requires_issue_gate,d.status,d.decision_code,d.decision_text,d.rationale,d.external_approver_name,d.external_approver_role,d.approval_reference,d.approval_date,d.updated_at FROM business_policy_decisions d LEFT JOIN legal_entities le ON le.id=d.legal_entity_id WHERE "+where+" ORDER BY d.legal_entity_id,d.decision_key",
   scopes);
  const histories=new Map<string,unknown[]>();
  if(rows.length){
   const ids=rows.map(row=>row.id);
   const [events]=await pool.execute<DecisionEventRow[]>(
    "SELECT id,policy_decision_id,previous_status,new_status,decision_code,decision_text,rationale,external_approver_name,external_approver_role,approval_reference,approval_date,recorded_by,created_at " +
    "FROM business_policy_decision_events WHERE policy_decision_id IN ("+ids.map(()=>"?").join(",")+") ORDER BY created_at,id",
    ids,
   );
   for(const event of events){
    const key=event.policy_decision_id;
    histories.set(key,[...(histories.get(key)??[]),{
     id:event.id,previousStatus:event.previous_status,status:event.new_status,decisionCode:event.decision_code,
     decisionText:event.decision_text,rationale:event.rationale,externalApproverName:event.external_approver_name,
     externalApproverRole:event.external_approver_role,approvalReference:event.approval_reference,
     approvalDate:event.approval_date===null?null:String(event.approval_date).slice(0,10),recordedBy:event.recorded_by,createdAt:event.created_at,
    }]);
   }
  }
  return jsonNoStore({data:rows.map(row=>({decisionKey:row.decision_key,legalEntityId:row.legal_entity_id,legalEntityName:row.legal_entity_name,topic:row.topic,recommendedStartingPoint:row.recommended_starting_point,requiredApprover:row.required_approver,requiresIssueGate:Boolean(row.requires_issue_gate),status:row.status,decisionCode:row.decision_code,decisionText:row.decision_text,rationale:row.rationale,externalApproverName:row.external_approver_name,externalApproverRole:row.external_approver_role,approvalReference:row.approval_reference,approvalDate:row.approval_date===null?null:String(row.approval_date).slice(0,10),updatedAt:row.updated_at,history:histories.get(row.id)??[]})),meta:{total:rows.length}});
 }catch(error){return apiError(error);}
}
