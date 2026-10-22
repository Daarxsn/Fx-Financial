import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { jsonNoStore } from "@/lib/http/api-response";
import { processEmailOutboxBatch, scheduleOverdueReminderEmails } from "@/lib/email/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization") ?? "";
  if (!secret || supplied.length !== ("Bearer " + secret).length) return false;
  return timingSafeEqual(Buffer.from(supplied),Buffer.from("Bearer " + secret));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return jsonNoStore({error:{code:"UNAUTHENTICATED",message:"A valid scheduler credential is required."}},401);
  }
  try {
    const reminders = await scheduleOverdueReminderEmails(100);
    const delivery = await processEmailOutboxBatch(3);
    return jsonNoStore({data:{reminders,delivery,completedAt:new Date().toISOString()}});
  } catch (error) {
    console.error("Email scheduler run failed",{
      errorName:error instanceof Error?error.name:"UnknownError",
    });
    return jsonNoStore({error:{code:"EMAIL_WORKER_UNAVAILABLE",message:"The durable email worker could not complete this run."}},503);
  }
}
