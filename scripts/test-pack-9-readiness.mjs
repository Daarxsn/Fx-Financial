#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function syntheticSecret(prefix, length = 40) {
  // Generate non-credential test values at runtime. No secret-shaped literal is stored in Git.
  return prefix + Array.from({ length }, (_, index) =>
    String.fromCharCode(65 + ((index * 7 + prefix.charCodeAt(0)) % 26))
  ).join("");
}

const synthetic = {
  DATABASE_HOST: "db-staging.internal.fx",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "falchion_staging",
  DATABASE_USER: "falchion_runtime",
  DATABASE_PASSWORD: syntheticSecret("DbPass", 28),
  DATABASE_SSL: "true",
  SESSION_SECRET: syntheticSecret("Session", 40),
  APP_ORIGIN: "https://preview.falchionxeniaa.in",
  DOCUMENTS_STORAGE_DRIVER: "s3",
  DOCUMENTS_STORAGE_BUCKET: "falchion-documents-staging-123",
  DOCUMENTS_STORAGE_REGION: "ap-south-1",
  DOCUMENTS_STORAGE_ACCESS_KEY_ID: syntheticSecret("AccessKey", 28),
  DOCUMENTS_STORAGE_SECRET_ACCESS_KEY: syntheticSecret("Storage", 36),
  RESEND_API_KEY: "re_" + syntheticSecret("Mail", 28),
  RESEND_FROM_EMAIL: "Billing <billing@falchionxeniaa.in>",
  RESEND_WEBHOOK_SECRET: syntheticSecret("Webhook", 44),
  CRON_SECRET: syntheticSecret("Scheduler", 44),
};

function run(target, overrides = {}) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "/tmp",
    ...synthetic,
    VERCEL: "",
    VERCEL_ENV: "",
    ...overrides,
  };
  return spawnSync(process.execPath, ["scripts/pack-9-preflight.mjs", "--target=" + target], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 15000,
  });
}
function outputOf(result) {
  return (result.stdout ?? "") + (result.stderr ?? "");
}
function assertNoSecrets(output) {
  for (const key of ["DATABASE_PASSWORD", "SESSION_SECRET", "DOCUMENTS_STORAGE_SECRET_ACCESS_KEY",
    "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "CRON_SECRET"]) {
    assert.ok(!output.includes(synthetic[key]), "Preflight output must not reveal " + key);
  }
}

const valid = run("staging");
assert.equal(valid.status, 0, "valid synthetic staging configuration should pass: " + outputOf(valid));
assert.match(valid.stdout, /PASS: runtime, origin, TLS, private storage, email, webhook, and scheduler settings/);
assertNoSecrets(outputOf(valid));
console.log("PASS: valid staging configuration passes without outputting secret values.");

const invalidTls = run("staging", { DATABASE_SSL: "false" });
assert.equal(invalidTls.status, 1, "plaintext database transport must fail closed");
assert.match(outputOf(invalidTls), /DATABASE_SSL must be true/);
assertNoSecrets(outputOf(invalidTls));
console.log("PASS: plaintext database configuration is rejected without secret leakage.");

const invalidOrigin = run("staging", { APP_ORIGIN: "http://preview.falchionxeniaa.in" });
assert.equal(invalidOrigin.status, 1, "non-HTTPS origin must fail closed");
assert.match(outputOf(invalidOrigin), /APP_ORIGIN must be the exact HTTPS origin/);
assertNoSecrets(outputOf(invalidOrigin));
console.log("PASS: non-HTTPS APP_ORIGIN is rejected without secret leakage.");

const loopbackDatabase = run("staging", { DATABASE_HOST: "127.0.0.1" });
assert.equal(loopbackDatabase.status, 1, "deployment target cannot use loopback database host");
assert.match(outputOf(loopbackDatabase), /DATABASE_HOST must refer to the remote managed database/);
assertNoSecrets(outputOf(loopbackDatabase));
console.log("PASS: loopback database host is rejected for deployment targets.");

const productionMockMailer = run("production", { RESEND_API_URL: "http://127.0.0.1:3030" });
assert.equal(productionMockMailer.status, 1, "production cannot override Resend with a local mock endpoint");
assert.match(outputOf(productionMockMailer), /RESEND_API_URL overrides are forbidden for production/);
assertNoSecrets(outputOf(productionMockMailer));
console.log("PASS: production mail endpoint override is rejected without secret leakage.");

console.log("Pack 9 preflight tests passed: 5 scenarios.");
