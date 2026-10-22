#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";

const failures = [];
const passed = [];
function check(label, condition) {
  if (condition) {
    passed.push(label);
    console.log("PASS: " + label);
  } else {
    failures.push(label);
    console.error("FAIL: " + label);
  }
}
const read = (path) => readFileSync(path, "utf8");
const pkg = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const envExample = read(".env.example");
const vercel = JSON.parse(read("vercel.json"));
const nextConfig = read("next.config.ts");
const pool = read("src/lib/db/pool.ts");
const tls = read("src/lib/db/tls-options.ts");
const dbVerify = read("scripts/verify-db.ts");
const storage = read("src/lib/documents/storage.ts");
const cron = read("src/app/api/cron/email-outbox/route.ts");
const csrf = read("src/lib/auth/csrf.ts");
const browser = read("scripts/verify-phase-7-browser.mjs");
const preflight = read("scripts/pack-9-preflight.mjs");
const preflightTest = read("scripts/test-pack-9-readiness.mjs");
const smoke = read("scripts/smoke-deployment.mjs");
const runbook = read("docs/pack-9-deployment-and-operations-runbook.md");
const ledger = read("docs/pack-9-readiness-ledger.md");
const migrations = readdirSync("database/migrations")
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
const migrationNumbers = migrations.map((name) => Number(name.slice(0, 3)));

check("required Pack 9 scripts are registered", [
  "db:migrate", "db:verify", "security:audit", "phase7:browser-test",
  "pack7:api-test", "pack8:validate", "pack9:validate", "pack9:test", "pack9:preflight", "pack9:smoke",
].every((key) => typeof pkg.scripts?.[key] === "string"));
check("forward-only migrations use a continuous numbered sequence",
  migrations.length > 0 && migrationNumbers.every((number, index) => number === index + 1));
check("CI migration ledger expectations match repository migration count",
  workflow.includes("!==" + migrations.length) &&
  workflow.includes('test "$restored_migrations" = "' + migrations.length + '"'));
check("CI has Node 24, npm ci, dependency audit, and history secret scan",
  workflow.includes("node-version: 24") && workflow.includes("npm ci --no-audit") &&
  workflow.includes("npm run security:audit") && workflow.includes("Secret scan (repository history)"));
check("CI checks migration/seed/query plans and logical restore",
  workflow.includes("MySQL 8 migration, seed, query-plan, failure-safety and restore integration") &&
  workflow.includes("mysqldump") && workflow.includes("falchion_ci_restore"));
check("CI calls API/auth, finance calculations, PDF, Pack 7, Pack 8 and Pack 9 checks", [
  "npm run api:validate", "npm run auth:security-test", "npm run pack7:api-test",
  "npm run config:phase6b-test", "npm run finance:calculation-test", "npm run documents:unit-test",
  "npm run pack7:validate", "npm run pack8:validate", "npm run pack9:validate",
].every((command) => workflow.includes(command)));
check("CI runs browser acceptance and reusable production-header smoke",
  workflow.includes("Run Phase 7 browser acceptance against disposable MySQL") &&
  workflow.includes("Install Playwright Chromium for Phase 7 browser acceptance") &&
  workflow.includes("SMOKE_MODE=headers npm run pack9:smoke"));
check("browser acceptance includes login, invoice/payment, correction, and reports",
  browser.includes("UI login opens the protected workspace") &&
  browser.toLowerCase().includes("invoice") && browser.toLowerCase().includes("payment") &&
  browser.includes("correction request") && browser.includes("Pack 7 reporting screen"));
check("production database connections require TLS and validated certificates",
  pool.includes('sslSetting !== "true"') &&
  pool.includes('process.env.NODE_ENV === "production" && sslSetting !== "true"') &&
  tls.includes("rejectUnauthorized: true"));
check("db verifier checks active TLS cipher and documents certificate verification/redaction",
  dbVerify.includes("Ssl_cipher") &&
  dbVerify.includes("Certificate verification was enabled (rejectUnauthorized=true).") &&
  dbVerify.includes("Raw diagnostics are intentionally suppressed"));
check("Vercel/production PDF storage rejects filesystem mode and checks integrity",
  storage.includes('process.env.NODE_ENV === "production" || process.env.VERCEL === "1"') &&
  storage.includes("DOCUMENT_INTEGRITY_FAILURE") && storage.includes("createHash"));
check("email worker authenticates CRON_SECRET with constant-time comparison",
  cron.includes("CRON_SECRET") && cron.includes("timingSafeEqual") && cron.includes("EMAIL_WORKER_UNAVAILABLE"));
check("production CSRF requires the configured HTTPS APP_ORIGIN",
  csrf.includes("APP_ORIGIN") && csrf.includes('url.protocol !== "https:"') && csrf.includes("ORIGIN_MISMATCH"));
check("Vercel retains the existing five-minute email worker cadence",
  Array.isArray(vercel.crons) && vercel.crons.some((job) =>
    job.path === "/api/cron/email-outbox" && job.schedule === "*/5 * * * *"));
check("safe environment template documents the deployment variable contract", [
  "DATABASE_HOST", "DATABASE_PASSWORD", "DATABASE_SSL", "DATABASE_SSL_CA", "SESSION_SECRET", "APP_ORIGIN",
  "DOCUMENTS_STORAGE_DRIVER", "DOCUMENTS_STORAGE_BUCKET", "DOCUMENTS_STORAGE_ACCESS_KEY_ID",
  "DOCUMENTS_STORAGE_SECRET_ACCESS_KEY", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET", "CRON_SECRET",
].every((key) => envExample.includes(key)) &&
  envExample.includes("replace-locally") && envExample.includes("your-production-domain.example"));
check("Next config contains CSP, HSTS, and safe security headers",
  nextConfig.includes("Content-Security-Policy") && nextConfig.includes("Strict-Transport-Security") &&
  nextConfig.includes("poweredByHeader: false"));
check("preflight rejects unsafe origin/TLS/storage and missing mail configuration",
  preflight.includes("DATABASE_SSL must be true") &&
  preflight.includes("APP_ORIGIN must be the exact HTTPS origin") &&
  preflight.includes("DOCUMENTS_STORAGE_DRIVER must be s3") &&
  preflight.includes("DATABASE_HOST must refer to the remote managed database") &&
  preflight.includes("No environment values were printed"));
check("synthetic preflight tests exercise success and fail-closed cases",
  preflightTest.includes("valid staging configuration") &&
  preflightTest.includes("DATABASE_SSL must be true") &&
  preflightTest.includes("APP_ORIGIN") &&
  preflightTest.includes("RESEND_API_URL") && workflow.includes("npm run pack9:test"));
check("smoke tests security headers without printing bodies or secrets",
  smoke.includes("SMOKE_BASE_URL") && smoke.includes("strict-transport-security") &&
  smoke.includes("protected customer API") && !smoke.includes("console.log(process.env"));
check("runbook contains the Vercel cron incompatibility and migration recovery steps",
  runbook.includes("The observed Hobby plan is incompatible") &&
  runbook.includes("Never reverse migrations blindly") &&
  runbook.includes("restore"));
check("readiness ledger records provider proof as a blocker",
  ledger.includes("Pack 9 is not a green release gate") &&
  ledger.includes("no Vercel project is linked"));

if (failures.length) {
  console.error("Pack 9 infrastructure validation failed: " + failures.length + " check(s).");
  process.exit(1);
}
console.log("Pack 9 infrastructure validation passed: " + passed.length + " checks.");
