import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError } from "@/lib/email/service";
import { emailApiError } from "@/lib/email/http";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  legalEntityId:z.string().uuid(),
  firstReminderAfterDays:z.number().int().min(1).max(365),
  maxReminders:z.number().int().min(1).max(6),
  intervalDays:z.number().int().min(1).max(90),
}).strict();

export async function GET() {
  try {
    const actor = await requirePermission("reminders:manage");
    if (!actor.legalEntityIds.length) return jsonNoStore({data:[]});
    const marks = actor.legalEntityIds.map(()=>"?").join(",");
    const [rows] = await pool.execute<(RowDataPacket & {
      id:string;legal_entity_id:string;version_number:number;first_reminder_after_days:number;max_reminders:number;interval_days:number;
      status:string;requested_by:string;approved_by:string|null;approval_reference:string|null;approval_evidence_notes:string|null;
      requested_at:Date|string;approved_at:Date|string|null;disabled_at:Date|string|null;disable_reason:string|null;
    })[]>(
      "SELECT id,legal_entity_id,version_number,first_reminder_after_days,max_reminders,interval_days,status,requested_by,approved_by,approval_reference,approval_evidence_notes,requested_at,approved_at,disabled_at,disable_reason FROM overdue_reminder_policies WHERE legal_entity_id IN ("+marks+") ORDER BY legal_entity_id,version_number DESC",
      actor.legalEntityIds,
    );
    return jsonNoStore({data:rows.map(row=>({
      id:row.id,legalEntityId:row.legal_entity_id,version:Number(row.version_number),firstReminderAfterDays:Number(row.first_reminder_after_days),
      maxReminders:Number(row.max_reminders),intervalDays:Number(row.interval_days),status:row.status,requestedBy:row.requested_by,
      approvedBy:row.approved_by,approvalReference:row.approval_reference,approvalEvidenceNotes:row.approval_evidence_notes,
      requestedAt:row.requested_at,approvedAt:row.approved_at,disabledAt:row.disabled_at,disableReason:row.disable_reason,
    }))});
  } catch(error) { return emailApiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await assertCsrf(request);
    const actor=await requirePermission("reminders:manage");
    if(!actor.permissions.includes("settings:manage")) throw new EmailWorkflowError("FORBIDDEN",403,"Settings permission is required to create a reminder policy.");
    const input=createSchema.parse(await request.json());
    if(!actor.legalEntityIds.includes(input.legalEntityId)) throw new EmailWorkflowError("REMINDER_POLICY_NOT_FOUND",404,"The legal entity is not in your assigned scope.");
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [existing]=await conn.execute<(RowDataPacket & {id:string})[]>(
        "SELECT id FROM overdue_reminder_policies WHERE legal_entity_id=? AND status IN ('PENDING_APPROVAL','ACTIVE') LIMIT 1 FOR UPDATE",
        [input.legalEntityId],
      );
      if(existing.length) throw new EmailWorkflowError("REMINDER_POLICY_EXISTS",409,"Disable or resolve the current active/pending policy before creating a replacement.");
      const [versions]=await conn.execute<(RowDataPacket & {version_number:number})[]>(
        "SELECT COALESCE(MAX(version_number),0) AS version_number FROM overdue_reminder_policies WHERE legal_entity_id=?",
        [input.legalEntityId],
      );
      const id=randomUUID();
      const version=Number(versions[0]?.version_number??0)+1;
      await conn.execute(
        "INSERT INTO overdue_reminder_policies (id,legal_entity_id,version_number,first_reminder_after_days,max_reminders,interval_days,status,requested_by) VALUES (?,?,?,?,?,?,'PENDING_APPROVAL',?)",
        [id,input.legalEntityId,version,input.firstReminderAfterDays,input.maxReminders,input.intervalDays,actor.userId],
      );
      await conn.execute(
        "INSERT INTO reminder_policy_events (id,reminder_policy_id,event_type,previous_status,new_status,actor_id,reason,metadata_json) VALUES (?,?, 'POLICY_REQUESTED',NULL,'PENDING_APPROVAL',?,'AWAITING_INDEPENDENT_FINANCE_APPROVAL',?)",
        [randomUUID(),id,actor.userId,JSON.stringify({version,firstReminderAfterDays:input.firstReminderAfterDays,maxReminders:input.maxReminders,intervalDays:input.intervalDays})],
      );
      await conn.commit();
      return jsonNoStore({data:{id,legalEntityId:input.legalEntityId,version,firstReminderAfterDays:input.firstReminderAfterDays,maxReminders:input.maxReminders,intervalDays:input.intervalDays,status:"PENDING_APPROVAL",requestedBy:actor.userId}},201);
    } catch(error) {
      await conn.rollback().catch(()=>undefined);
      throw error;
    } finally { conn.release(); }
  } catch(error) { return emailApiError(error); }
}
