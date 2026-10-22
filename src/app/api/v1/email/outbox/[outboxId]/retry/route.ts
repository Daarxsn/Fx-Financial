import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError, retryFailedEmail, type EmailSourceType } from "@/lib/email/service";
import { emailApiError } from "@/lib/email/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{outboxId:string}>};
function readPermission(sourceType:EmailSourceType) {
  return sourceType==="INVOICE"?"invoices:read":sourceType==="QUOTATION"?"quotations:read":"payments:read";
}

export async function POST(request:NextRequest,context:Context) {
  try {
    await assertCsrf(request);
    const actor=await requirePermission("email:send");
    const {outboxId}=await context.params;
    if(!/^[0-9a-f-]{36}$/i.test(outboxId)) throw new EmailWorkflowError("VALIDATION_ERROR",400,"outboxId must be a UUID.");
    const [rows]=await pool.execute<(RowDataPacket & {id:string;legal_entity_id:string;source_document_type:EmailSourceType})[]>(
      "SELECT id,legal_entity_id,source_document_type FROM email_outbox WHERE id=? LIMIT 1",[outboxId]);
    const row=rows[0];
    if(!row || !actor.legalEntityIds.includes(row.legal_entity_id)) throw new EmailWorkflowError("EMAIL_NOT_FOUND",404,"The email record is not available in your assigned scope.");
    if(!actor.permissions.includes(readPermission(row.source_document_type))) throw new EmailWorkflowError("FORBIDDEN",403,"You do not have permission to read this financial document.");
    const result=await retryFailedEmail(outboxId,actor.userId);
    return jsonNoStore({data:result},202);
  } catch(error) { return emailApiError(error); }
}
