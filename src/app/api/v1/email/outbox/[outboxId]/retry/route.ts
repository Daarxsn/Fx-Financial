import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError, listEmailOutbox, processEmailOutboxBatch, retryFailedEmail, type EmailSourceType } from "@/lib/email/service";
import { emailApiError } from "@/lib/email/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
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
      "SELECT id,legal_entity_id,source_document_type,source_document_id FROM email_outbox WHERE id=? LIMIT 1",[outboxId]);
    const row=rows[0];
    if(!row || !actor.legalEntityIds.includes(row.legal_entity_id)) throw new EmailWorkflowError("EMAIL_NOT_FOUND",404,"The email record is not available in your assigned scope.");
    if(!actor.permissions.includes(readPermission(row.source_document_type))) throw new EmailWorkflowError("FORBIDDEN",403,"You do not have permission to read this financial document.");
    const result=await retryFailedEmail(outboxId,actor.userId);
    let data:Record<string,unknown>={...result,immediateDeliveryAttempted:false};
    try {
      await processEmailOutboxBatch(1,outboxId);
      data={...data,immediateDeliveryAttempted:true};
    } catch(error) {
      console.warn("Immediate email retry deferred to the durable worker",{
        outboxId,
        errorName:error instanceof Error?error.name:"UnknownError",
      });
      data={...data,immediateDeliveryDeferred:true};
    }
    try {
      const latest=await listEmailOutbox({
        legalEntityIds:actor.legalEntityIds,
        sourceType:row.source_document_type,
        sourceId:row.source_document_id,
      });
      const current=latest.find(item=>item.id===outboxId);
      if(current) data={
        ...current,
        immediateDeliveryAttempted:data.immediateDeliveryAttempted===true,
        ...(data.immediateDeliveryDeferred===true?{immediateDeliveryDeferred:true}:{}),
      };
    } catch(error) {
      console.warn("Email retry response could not refresh delivery status",{
        outboxId,
        errorName:error instanceof Error?error.name:"UnknownError",
      });
    }
    return jsonNoStore({data},202);
  } catch(error) { return emailApiError(error); }
}
