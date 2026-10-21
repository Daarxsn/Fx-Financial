import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export const ENTITY_SCOPED_POLICY_DECISIONS = [
 {key:"D-02",topic:"Numbering",recommendation:"Use one approved server-side sequence per legal entity, financial year and document type; preserve every issued number.",approver:"Business owner and finance/accounting",rationale:"Awaiting issuer-specific numbering format, sequence scope and approval evidence."},
 {key:"D-03",topic:"Financial year",recommendation:"Configure the actual issuer financial-year boundary and timezone; do not assume an unapproved default.",approver:"Finance/accounting owner",rationale:"Awaiting issuer-specific financial-year and timezone decision."},
 {key:"D-04",topic:"Currency",recommendation:"Set currency from approved issuer records; no FX or multi-currency settlement is inferred.",approver:"Finance/accounting owner",rationale:"Awaiting explicit currency approval from authoritative issuer records."},
 {key:"D-06",topic:"Tax registrations and rule matrix",recommendation:"Use effective-dated approved tax rules and matching registrations for the applicable jurisdiction.",approver:"Finance/accounting and qualified tax reviewer",rationale:"Awaiting issuer-specific tax-registration and tax-rule matrix approval."},
 {key:"D-07",topic:"Payment terms and due dates",recommendation:"Use approved issuer/customer contract terms and snapshot the due date at issue.",approver:"Finance and business owner",rationale:"Awaiting issuer-specific payment-terms and due-date policy approval."},
 {key:"D-11",topic:"E-invoice and statutory applicability",recommendation:"Record a reasoned statutory applicability outcome; if required but unimplemented, block issuance.",approver:"Tax/accounting owner; tax/legal when required",rationale:"Awaiting issuer-specific statutory/e-invoice applicability evidence."},
] as const;
export async function seedEntityPolicyDecisions(conn:PoolConnection,legalEntityId:string):Promise<void>{
 for(const d of ENTITY_SCOPED_POLICY_DECISIONS) await conn.execute(
  "INSERT IGNORE INTO business_policy_decisions (id,decision_key,legal_entity_id,topic,recommended_starting_point,required_approver,requires_issue_gate,status,rationale) VALUES (?,?,?,?,?,?,TRUE,'PENDING',?)",
  [randomUUID(),d.key,legalEntityId,d.topic,d.recommendation,d.approver,d.rationale]);
}
type GateRow=RowDataPacket&{decision_key:string;legal_entity_id:string|null;topic:string;status:string};
const GLOBAL_ISSUE_DECISIONS=["D-01","D-05","D-08","D-09","D-10"] as const;
export async function unresolvedInvoicePolicyDecisions(conn:PoolConnection,legalEntityId:string):Promise<Array<{decisionKey:string;scope:"GLOBAL"|"LEGAL_ENTITY";status:string;topic:string}>>{
 const [rows]=await conn.execute<GateRow[]>("SELECT decision_key,legal_entity_id,topic,status FROM business_policy_decisions WHERE requires_issue_gate=TRUE AND (legal_entity_id IS NULL OR legal_entity_id=?) ORDER BY legal_entity_id,decision_key FOR SHARE",[legalEntityId]);
 const found=new Map(rows.map(r=>[(r.legal_entity_id??"GLOBAL")+":"+r.decision_key,r]));
 const expected=[...GLOBAL_ISSUE_DECISIONS.map(key=>({key,scope:"GLOBAL" as const})),...ENTITY_SCOPED_POLICY_DECISIONS.map(d=>({key:d.key,scope:"LEGAL_ENTITY" as const}))];
 const unresolved:Array<{decisionKey:string;scope:"GLOBAL"|"LEGAL_ENTITY";status:string;topic:string}>=[];
 for(const e of expected){const r=found.get((e.scope==="GLOBAL"?"GLOBAL":legalEntityId)+":"+e.key);if(!r)unresolved.push({decisionKey:e.key,scope:e.scope,status:"MISSING",topic:"Policy decision record is missing"});else if(r.status!=="APPROVED"&&r.status!=="NOT_APPLICABLE")unresolved.push({decisionKey:e.key,scope:e.scope,status:r.status,topic:r.topic});}
 return unresolved;
}
