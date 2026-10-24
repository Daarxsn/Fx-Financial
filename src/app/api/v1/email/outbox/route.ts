import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError, getEmailSourcePreview, listEmailOutbox, processEmailOutboxBatch, queueDocumentEmail, type EmailSourceType } from "@/lib/email/service";
import { emailApiError } from "@/lib/email/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const sourceTypes = ["INVOICE","QUOTATION","RECEIPT"] as const;
const uuid = z.string().uuid();
const sendSchema = z.object({
  sourceType: z.enum(sourceTypes),
  sourceId: uuid,
  recipientEmail: z.string().email().max(320),
  recipientConfirmed: z.literal(true),
}).strict();

function sourceReadPermission(sourceType: EmailSourceType): string {
  return sourceType === "INVOICE" ? "invoices:read" : sourceType === "QUOTATION" ? "quotations:read" : "payments:read";
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission("email:read");
    const url = new URL(request.url);
    const rawType = url.searchParams.get("sourceType");
    const sourceId = url.searchParams.get("sourceId") ?? undefined;
    if ((rawType && !sourceId) || (!rawType && sourceId)) {
      throw new EmailWorkflowError("VALIDATION_ERROR",400,"sourceType and sourceId must be supplied together.");
    }
    let preview: Awaited<ReturnType<typeof getEmailSourcePreview>> | undefined;
    let sourceType: EmailSourceType | undefined;
    if (rawType && sourceId) {
      if (!sourceTypes.includes(rawType as EmailSourceType) || !uuid.safeParse(sourceId).success) {
        throw new EmailWorkflowError("VALIDATION_ERROR",400,"A valid sourceType and sourceId are required.");
      }
      sourceType = rawType as EmailSourceType;
      if (!actor.permissions.includes(sourceReadPermission(sourceType))) {
        throw new EmailWorkflowError("FORBIDDEN",403,"You do not have permission to read this financial document.");
      }
      preview = await getEmailSourcePreview(sourceType,sourceId);
      if (!actor.legalEntityIds.includes(preview.legalEntityId)) {
        throw new EmailWorkflowError("EMAIL_NOT_FOUND",404,"The requested email history is not available in your assigned scope.");
      }
    }
    const items = await listEmailOutbox({
      legalEntityIds: actor.legalEntityIds,
      ...(sourceType ? {sourceType} : {}),
      ...(sourceId ? {sourceId} : {}),
    });
    return jsonNoStore({data:{
      items,
      ...(preview ? {source:preview,defaultRecipientEmail:preview.defaultRecipientEmail,recipientName:preview.recipientName} : {}),
    }});
  } catch (error) {
    return emailApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertCsrf(request);
    const actor = await requirePermission("email:send");
    const input = sendSchema.parse(await request.json());
    if (!actor.permissions.includes(sourceReadPermission(input.sourceType))) {
      throw new EmailWorkflowError("FORBIDDEN",403,"You do not have permission to read and email this financial document.");
    }
    const preview = await getEmailSourcePreview(input.sourceType,input.sourceId);
    if (!actor.legalEntityIds.includes(preview.legalEntityId)) {
      throw new EmailWorkflowError("EMAIL_NOT_FOUND",404,"The requested financial document is not available in your assigned scope.");
    }
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!uuid.safeParse(idempotencyKey).success) {
      throw new EmailWorkflowError("VALIDATION_ERROR",422,"Send a UUID in the Idempotency-Key header.");
    }
    const queued = await queueDocumentEmail({
      sourceType:input.sourceType,
      sourceId:input.sourceId,
      actorId:actor.userId,
      recipientEmail:input.recipientEmail,
      recipientConfirmed:input.recipientConfirmed,
      idempotencyKey,
    });
    const queuedRecord = queued as Record<string, unknown>;
    const queuedId = typeof queuedRecord.id === "string" ? queuedRecord.id : "";
    const queuedStatus = typeof queuedRecord.status === "string" ? queuedRecord.status : "";
    const idempotentReplay = queuedRecord.idempotentReplay === true;
    if (!uuid.safeParse(queuedId).success || !queuedStatus) {
      throw new EmailWorkflowError("EMAIL_OUTBOX_UNAVAILABLE",500,"The durable email request could not be reloaded.");
    }
    // Persist first, then try the specific outbox item during this request. The scheduled
    // worker remains the retry/recovery path if the provider is slow or temporarily unavailable.
    let data: Record<string, unknown> = { ...queuedRecord, immediateDeliveryAttempted:false };
    if (queuedStatus === "QUEUED") {
      try {
        await processEmailOutboxBatch(1,queuedId);
        data = { ...data, immediateDeliveryAttempted:true };
      } catch (error) {
        console.warn("Immediate email delivery attempt deferred to the durable worker",{
          outboxId:queuedId,
          errorName:error instanceof Error?error.name:"UnknownError",
        });
        data = { ...data, immediateDeliveryDeferred:true };
      }
    }
    try {
      const latest = await listEmailOutbox({
        legalEntityIds:actor.legalEntityIds,
        sourceType:input.sourceType,
        sourceId:input.sourceId,
      });
      const current = latest.find(item=>item.id===queuedId);
      if (current) data = {
        ...current,
        idempotentReplay,
        immediateDeliveryAttempted:data.immediateDeliveryAttempted===true,
        ...(data.immediateDeliveryDeferred===true ? {immediateDeliveryDeferred:true}:{}),
      };
    } catch (error) {
      // The outbox write/attempt may already have succeeded. Do not turn that into a false
      // "not queued" response; the delivery panel can reconcile from durable history.
      console.warn("Email queue response could not refresh delivery status",{
        outboxId:queuedId,
        errorName:error instanceof Error?error.name:"UnknownError",
      });
    }
    return jsonNoStore({data},idempotentReplay ? 200 : 202);
  } catch (error) {
    return emailApiError(error);
  }
}
