import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError, recordResendWebhook, verifyResendWebhookSignature } from "@/lib/email/service";
import { emailApiError } from "@/lib/email/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (!raw || Buffer.byteLength(raw,"utf8") > 1024 * 1024) {
      throw new EmailWorkflowError("WEBHOOK_PAYLOAD_INVALID",400,"The provider webhook payload is invalid.");
    }
    const verified = verifyResendWebhookSignature(raw,{
      id:request.headers.get("svix-id"),
      timestamp:request.headers.get("svix-timestamp"),
      signature:request.headers.get("svix-signature"),
    });
    if (!verified) {
      return jsonNoStore({error:{code:"WEBHOOK_SIGNATURE_INVALID",message:"The provider event signature could not be verified."}},400);
    }
    let event: Record<string,unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      event = parsed as Record<string,unknown>;
    } catch {
      throw new EmailWorkflowError("WEBHOOK_PAYLOAD_INVALID",400,"The provider webhook payload is invalid.");
    }
    const result = await recordResendWebhook(raw,event,request.headers.get("svix-id") ?? "");
    return jsonNoStore({data:{accepted:true,duplicate:result.duplicate,matched:result.matched}});
  } catch (error) {
    return emailApiError(error);
  }
}
