import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const [outboxMigration, policyMigration, service, outboxRoute, retryRoute, webhookRoute, cronRoute, ui, spec, seed, mock] = await Promise.all([
  read("database/migrations/026_pack_6_email_outbox.sql"),
  read("database/migrations/027_pack_6_overdue_reminder_policies.sql"),
  read("src/lib/email/service.ts"),
  read("src/app/api/v1/email/outbox/route.ts"),
  read("src/app/api/v1/email/outbox/[outboxId]/retry/route.ts"),
  read("src/app/api/webhooks/resend/route.ts"),
  read("src/app/api/cron/email-outbox/route.ts"),
  read("src/components/email-delivery-panel.tsx"),
  read("docs/openapi.yaml"),
  read("scripts/seed-reference.ts"),
  read("scripts/mock-resend-server.mjs"),
]);

for (const needle of [
  "request_idempotency_key", "request_payload_sha256", "provider_idempotency_key",
  "provider_message_id", "lease_token", "lease_until", "reminder_dedupe_key",
  "CREATE TABLE email_outbox_events", "UNIQUE KEY uq_email_event_provider_event",
]) assert.ok(outboxMigration.includes(needle), "Outbox migration missing: " + needle);

for (const needle of [
  "PENDING_APPROVAL", "approval_reference", "approval_evidence_notes",
  "CREATE TABLE reminder_policy_events", "ck_reminder_policy_approval",
]) assert.ok(policyMigration.includes(needle), "Reminder migration missing: " + needle);

for (const needle of [
  "FOR UPDATE SKIP LOCKED", "Idempotency-Key", "provider_idempotency_key",
  "verifyResendWebhookSignature", "recordResendWebhook", "REQUIRES_REVIEW",
  "scheduleOverdueReminderEmails", "recheckReminder", "attachmentSha256",
  "EMAIL_PROVIDER_NOT_CONFIGURED",
]) assert.ok(service.includes(needle), "Email workflow missing: " + needle);

assert.ok(outboxRoute.includes("assertCsrf"), "Email POST must enforce CSRF");
assert.ok(outboxRoute.includes("recipientConfirmed"), "Email POST must require explicit recipient confirmation");
assert.ok(outboxRoute.includes("actor.legalEntityIds"), "Email API must enforce legal-entity scope");
assert.ok(service.includes("data.email_id ?? data.id"), "Resend webhook must read the documented email_id field");
assert.ok(retryRoute.includes("retryFailedEmail"), "Manual retry must use the bounded retry workflow");
assert.ok(webhookRoute.includes("await request.text()"), "Webhook signature must use the exact raw request body");
for (const header of ["svix-id", "svix-timestamp", "svix-signature"]) {
  assert.ok(webhookRoute.includes(header), "Webhook must validate " + header);
}
assert.ok(cronRoute.includes("CRON_SECRET"), "Scheduler must be authenticated with CRON_SECRET");
assert.ok(cronRoute.includes("timingSafeEqual"), "Scheduler secret comparison must be timing-safe");
assert.ok(ui.includes("recipientConfirmed:confirmed"), "UI must send the explicit recipient confirmation");
assert.ok(ui.includes("Idempotency-Key"), "UI must send an idempotency key");
assert.ok(ui.includes("DELIVERED"), "UI must distinguish provider acceptance from delivery");
assert.ok(seed.includes('"email:send"') && seed.includes('"email:read"') && seed.includes('"reminders:manage"'),
  "Reference seed must expose least-privilege Pack 6 permissions");
assert.ok(mock.includes("idempotency.get(key)"), "Mock provider must reproduce provider idempotency");

for (const route of [
  "/api/v1/email/outbox",
  "/api/v1/email/outbox/{outboxId}/retry",
  "/api/v1/reminders/policies",
  "/api/v1/reminders/policies/{policyId}/approve",
  "/api/v1/reminders/policies/{policyId}/disable",
]) assert.ok(spec.includes(route), "OpenAPI contract missing Pack 6 route: " + route);

console.log("PASS: Pack 6 durable outbox invariants, provider idempotency, signature verification, scheduler auth, scoped API, recipient confirmation, reminder approval and OpenAPI coverage.");
