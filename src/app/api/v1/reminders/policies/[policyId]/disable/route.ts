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
const schema=z.object({reason:z.string().trim().min(10).max(1000)}).strict();

export async function POST(request:NextRequest,context:Context) {
  try {
    await assertCsrf(request);
    const actor=await requirePermission("reminders:manage");
    const {policyId}=await context.params;
    if(!z.string().uuid().safeParse(policyId).success) throw new EmailWorkflowError("VALIDATION_ERROR",400,"policyId must be a UUID.");
    const input=schema.parse(await request.json());
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]=await conn.execute<(RowDataPacket & {id:string;legal_entity_id:string;status:string})[]>(
        "SELECT id,legal_entity_id,status FROM overdue_reminder_policies WHERE id=? LIMIT 1 FOR UPDATE",[policyId]);
      const policy=rows[0];
      if(!policy || !actor.legalEntityIds.includes(policy.legal_entity_id)) throw new EmailWorkflowError("REMINDER_POLICY_NOT_FOUND",404,"The reminder policy is not available in your assigned scope.");
      if(policy.status==="DISABLED") { await conn.commit(); return jsonNoStore({data:{id:policyId,status:"DISABLED",idempotentReplay:true}}); }
      await conn.execute("UPDATE overdue_reminder_policies SET status='DISABLED',disabled_by=?,disabled_at=NOW(3),disable_reason=?,updated_at=NOW(3) WHERE id=?",
        [actor.userId,input.reason,policyId]);
      await conn.execute(
        "INSERT INTO reminder_policy_events (id,reminder_policy_id,event_type,previous_status,new_status,actor_id,reason) VALUES (?,?, 'POLICY_DISABLED',?,'DISABLED',?,?)",
        [randomUUID(),policyId,policy.status,actor.userId,input.reason]);
      await conn.commit();
      return jsonNoStore({data:{id:policyId,status:"DISABLED"}});
    } catch(error) { await conn.rollback().catch(()=>undefined); throw error; }
    finally { conn.release(); }
  } catch(error) { return emailApiError(error); }
}
