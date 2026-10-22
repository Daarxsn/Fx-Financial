import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError } from "@/lib/email/service";
import { emailApiError } from "@/lib/email/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{policyId:string}>};
const schema=z.object({approvalReference:z.string().trim().min(3).max(255),evidenceNotes:z.string().trim().min(20).max(2000)}).strict();

export async function POST(request:NextRequest,context:Context) {
  try {
    await assertCsrf(request);
    const actor=await requirePermission("reminders:manage");
    if(!actor.permissions.includes("approvals:decide")) throw new EmailWorkflowError("FORBIDDEN",403,"Independent approval permission is required.");
    const {policyId}=await context.params;
    if(!z.string().uuid().safeParse(policyId).success) throw new EmailWorkflowError("VALIDATION_ERROR",400,"policyId must be a UUID.");
    const input=schema.parse(await request.json());
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Use the same entity-first lock order as policy creation to serialize activation safely.
      const [initialRows]=await conn.execute<(RowDataPacket & {legal_entity_id:string})[]>(
        "SELECT legal_entity_id FROM overdue_reminder_policies WHERE id=? LIMIT 1",[policyId]);
      const initial=initialRows[0];
      if(!initial || !actor.legalEntityIds.includes(initial.legal_entity_id)) throw new EmailWorkflowError("REMINDER_POLICY_NOT_FOUND",404,"The reminder policy is not available in your assigned scope.");
      const [entityRows]=await conn.execute<(RowDataPacket & {id:string})[]>(
        "SELECT id FROM legal_entities WHERE id=? LIMIT 1 FOR UPDATE",[initial.legal_entity_id]);
      if(!entityRows.length) throw new EmailWorkflowError("REMINDER_POLICY_NOT_FOUND",404,"The reminder policy is not available in your assigned scope.");
      const [rows]=await conn.execute<(RowDataPacket & {id:string;legal_entity_id:string;status:string;requested_by:string;version_number:number})[]>(
        "SELECT id,legal_entity_id,status,requested_by,version_number FROM overdue_reminder_policies WHERE id=? LIMIT 1 FOR UPDATE",[policyId]);
      const policy=rows[0];
      if(!policy || !actor.legalEntityIds.includes(policy.legal_entity_id)) throw new EmailWorkflowError("REMINDER_POLICY_NOT_FOUND",404,"The reminder policy is not available in your assigned scope.");
      if(policy.status!=="PENDING_APPROVAL") throw new EmailWorkflowError("REMINDER_POLICY_NOT_PENDING",409,"Only a pending reminder policy can be approved.");
      if(policy.requested_by===actor.userId) throw new EmailWorkflowError("SEPARATION_OF_DUTIES_REQUIRED",409,"The person who requested a reminder policy cannot approve it.");
      const [active]=await conn.execute<(RowDataPacket & {id:string})[]>(
        "SELECT id FROM overdue_reminder_policies WHERE legal_entity_id=? AND status='ACTIVE' LIMIT 1 FOR UPDATE",[policy.legal_entity_id]);
      if(active.length) throw new EmailWorkflowError("REMINDER_POLICY_EXISTS",409,"Disable the current active policy before approving its replacement.");
      await conn.execute(
        "UPDATE overdue_reminder_policies SET status='ACTIVE',approved_by=?,approval_reference=?,approval_evidence_notes=?,approved_at=NOW(3),updated_at=NOW(3) WHERE id=? AND status='PENDING_APPROVAL'",
        [actor.userId,input.approvalReference,input.evidenceNotes,policyId]);
      await conn.execute(
        "INSERT INTO reminder_policy_events (id,reminder_policy_id,event_type,previous_status,new_status,actor_id,reason,approval_reference,metadata_json) VALUES (?,?, 'POLICY_APPROVED','PENDING_APPROVAL','ACTIVE',?,?,?,?)",
        [randomUUID(),policyId,actor.userId,input.evidenceNotes,input.approvalReference,JSON.stringify({version:Number(policy.version_number)})]);
      await conn.commit();
      return jsonNoStore({data:{id:policyId,status:"ACTIVE",approvedBy:actor.userId,approvalReference:input.approvalReference}},200);
    } catch(error) { await conn.rollback().catch(()=>undefined); throw error; }
    finally { conn.release(); }
  } catch(error) { return emailApiError(error); }
}
