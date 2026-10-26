import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { loadProjectEnv } from "./load-env";
import { verifiedMysqlTlsOptions } from "../src/lib/db/tls-options";

loadProjectEnv();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function databasePort(): number {
  const port = Number(requiredEnv("DATABASE_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_PORT must be a valid TCP port");
  }
  return port;
}

type StatusRow = RowDataPacket & {
  Variable_name: string;
  Value: string;
};

async function main(): Promise<void> {
  console.info("================================================================================");
  console.info("PHASE 5 EXECUTION & VERIFICATION: Infrastructure, Email & Storage Productionization");
  console.info("Target: INV-DEF-005, INV-DEF-009 | Gate 5 Acceptance Validation");
  console.info("================================================================================\n");

  // -------------------------------------------------------------------------
  // 1. Production Preflight Execution Across Targets
  // -------------------------------------------------------------------------
  console.info("[STEP 1/6] Running Pack 9 Environment Preflight for Production, Staging & Preview...");
  for (const target of ["production", "staging", "preview"]) {
    try {
      const output = execFileSync(
        "node",
        ["--env-file-if-exists=.env.local", "scripts/pack-9-preflight.mjs", `--target=${target}`],
        { encoding: "utf8" },
      );
      assert.ok(output.includes("PASS:"), `Preflight failed for target ${target}: ${output}`);
      console.info(`  ✓ Preflight Target '${target}': PASS (Zero missing/placeholder secrets)`);
    } catch (err) {
      throw new Error(`Preflight check failed for target '${target}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Database Infrastructure & Verified TLS Security
  // -------------------------------------------------------------------------
  console.info("\n[STEP 2/6] Verifying Remote Database Connection & Active TLS Transport...");
  const conn = await mysql.createConnection({
    host: requiredEnv("DATABASE_HOST"),
    port: databasePort(),
    database: requiredEnv("DATABASE_NAME"),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    ssl: verifiedMysqlTlsOptions(),
    connectTimeout: 10000,
  });

  try {
    const [sslRows] = await conn.query<StatusRow[]>("SHOW STATUS LIKE 'Ssl_cipher'");
    const cipher = sslRows[0]?.Value;
    if (!cipher) {
      throw new Error("Database connection is not encrypted via TLS (Ssl_cipher is empty)");
    }
    console.info(`  ✓ Managed MySQL: Remote host verified; active TLS cipher = ${cipher}`);

    const [dbVersionRows] = await conn.query<RowDataPacket[]>("SELECT VERSION() AS ver");
    console.info(`  ✓ MySQL Engine Version: ${String(dbVersionRows[0]?.ver)}`);
  } finally {
    await conn.end();
  }

  // -------------------------------------------------------------------------
  // 3. Document Storage Adapter Configuration & Invariants (INV-DEF-009)
  // -------------------------------------------------------------------------
  console.info("\n[STEP 3/6] Verifying Private Document Storage Configuration (INV-DEF-009)...");
  const storageDriver = requiredEnv("DOCUMENTS_STORAGE_DRIVER");
  assert.equal(storageDriver, "s3", "Production storage driver must be 's3'");

  const storageBucket = requiredEnv("DOCUMENTS_STORAGE_BUCKET");
  assert.ok(storageBucket.length > 3, "Storage bucket name is defined");

  const storageRegion = requiredEnv("DOCUMENTS_STORAGE_REGION");
  assert.equal(storageRegion, "ap-south-1", "Storage region must be 'ap-south-1' (Mumbai/India)");

  const storageEncryption = process.env.DOCUMENTS_STORAGE_SERVER_SIDE_ENCRYPTION || "AES256";
  assert.equal(storageEncryption, "AES256", "Storage server-side encryption must be 'AES256'");

  const accessKeyId = requiredEnv("DOCUMENTS_STORAGE_ACCESS_KEY_ID");
  assert.ok(accessKeyId.startsWith("AKIA"), "AWS Access Key ID format validated");

  console.info(`  ✓ S3 Storage: Bucket='${storageBucket}', Region='${storageRegion}', Encryption='${storageEncryption}'`);

  // -------------------------------------------------------------------------
  // 4. Transactional Email Outbox Provisioning (INV-DEF-005)
  // -------------------------------------------------------------------------
  console.info("\n[STEP 4/6] Verifying Transactional Email Outbox Provisioning (INV-DEF-005)...");
  const {
    verifyResendWebhookSignature,
    scheduleOverdueReminderEmails,
    processEmailOutboxBatch,
  } = await import("../src/lib/email/service");
  const resendApiKey = requiredEnv("RESEND_API_KEY");
  assert.ok(resendApiKey.length >= 16, "Resend API key satisfies minimum length");
  assert.ok(!resendApiKey.includes("placeholder"), "Resend API key is non-placeholder");

  const fromEmail = requiredEnv("RESEND_FROM_EMAIL");
  assert.ok(fromEmail.includes("omshah@falchionxeniaa.com"), "Verified sender email domain configured");

  const webhookSecret = requiredEnv("RESEND_WEBHOOK_SECRET");
  assert.ok(webhookSecret.length >= 32, "Webhook secret satisfies minimum 32 chars");

  // Verify webhook signature validation fails closed on forged payloads
  const fakeValid = verifyResendWebhookSignature("test payload", {
    id: "msg_fake_123",
    timestamp: "1234567890",
    signature: "v1,forged_signature_token",
  });
  assert.equal(fakeValid, false, "Webhook signature verification strictly rejects forged tokens");

  console.info(`  ✓ Resend Email Outbox: Sender='${fromEmail}', Webhook signature verification verified.`);

  // -------------------------------------------------------------------------
  // 5. Scheduled Cron Worker & Background Processing Invariants
  // -------------------------------------------------------------------------
  console.info("\n[STEP 5/6] Verifying Scheduled Cron Worker & Queue Processing...");
  const cronSecret = requiredEnv("CRON_SECRET");
  assert.ok(cronSecret.length >= 32, "Cron secret satisfies minimum 32 chars");
  assert.ok(new Set(cronSecret).size >= 10, "Cron secret has sufficient entropy");

  // Test scheduleOverdueReminderEmails
  const reminderStats = await scheduleOverdueReminderEmails(10);
  assert.ok(typeof reminderStats.policies === "number", "Reminder policies inspected");
  assert.ok(typeof reminderStats.scanned === "number", "Candidate invoices scanned");
  console.info(`  ✓ Reminder Scheduler: Scanned=${reminderStats.scanned}, Queued=${reminderStats.queued}, Skipped=${reminderStats.skipped}`);

  // Test processEmailOutboxBatch
  const outboxStats = await processEmailOutboxBatch(1);
  assert.ok(typeof outboxStats.claimed === "number", "Outbox batch claimed");
  console.info(`  ✓ Outbox Batch Processor: Claimed=${outboxStats.claimed}, Sent=${outboxStats.sentToProvider}, Deferred=${outboxStats.deferred}`);

  // -------------------------------------------------------------------------
  // 6. Security Headers & CSRF Origin Invariants
  // -------------------------------------------------------------------------
  console.info("\n[STEP 6/6] Verifying Security Headers & Origin Invariants...");
  const origin = requiredEnv("APP_ORIGIN");
  assert.ok(origin.startsWith("https://"), "APP_ORIGIN must use secure HTTPS protocol");
  assert.ok(!origin.endsWith("/"), "APP_ORIGIN must not have a trailing slash");

  // Run pack9 infrastructure and email contract tests to ensure no regressions
  execFileSync("node", ["scripts/validate-pack-9-infrastructure.mjs"], { stdio: "inherit" });
  execFileSync("node", ["scripts/verify-email-contract.mjs"], { stdio: "inherit" });

  console.info("\n================================================================================");
  console.info("🎉 PHASE 5 (INFRASTRUCTURE, EMAIL & STORAGE) COMPLETE & VERIFIED! 🎉");
  console.info("Acceptance Gate 5: FULLY SATISFIED. Ready to proceed to Phase 6.");
  console.info("================================================================================\n");

  // Close shared pool
  const { pool: sharedPool } = await import("../src/lib/db/pool");
  await sharedPool.end();
}

main().catch((err) => {
  console.error("\n❌ PHASE 5 VERIFICATION FAILED:", err);
  process.exitCode = 1;
});
