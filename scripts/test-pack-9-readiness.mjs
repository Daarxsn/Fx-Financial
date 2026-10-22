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
function expectRejected(label, target, overrides, message) {
  const result = run(target, overrides);
  assert.notEqual(result.status, 0, label + " must fail closed: " + outputOf(result));
  assert.match(outputOf(result), message, label + " should explain its rejection");
  assertNoSecrets(outputOf(result));
  console.log("PASS: " + label + " is rejected without secret leakage.");
}

const valid = run("staging");
assert.equal(valid.status, 0, "valid synthetic staging configuration should pass: " + outputOf(valid));
assert.match(valid.stdout, /PASS: runtime, origin, TLS, private storage, email, webhook, and scheduler settings/);
assertNoSecrets(outputOf(valid));
console.log("PASS: valid staging configuration passes without outputting secret values.");

expectRejected("plaintext database transport", "staging", { DATABASE_SSL: "false" }, /DATABASE_SSL must be true/);
expectRejected("non-HTTPS app origin", "staging", { APP_ORIGIN: "http://preview.falchionxeniaa.in" }, /APP_ORIGIN must be the exact HTTPS origin/);
for (const host of ["127.0.0.1", "127.44.2.3", "localhost.", "[::1]", "0.0.0.0", "169.254.169.254", "::ffff:127.0.0.1"]) {
  expectRejected("unsafe database host " + host, "staging", { DATABASE_HOST: host }, /DATABASE_HOST must refer to the remote managed database/);
}
expectRejected("malformed database host URL", "staging", { DATABASE_HOST: "https://db-staging.internal.fx" }, /DATABASE_HOST must be a hostname or IP address/);
expectRejected("invalid storage endpoint transport", "staging", { DOCUMENTS_STORAGE_ENDPOINT: "http://storage.internal.fx" }, /DOCUMENTS_STORAGE_ENDPOINT must use HTTPS/);
expectRejected("incomplete database CA PEM", "staging", { DATABASE_SSL_CA: "-----BEGIN CERTIFICATE----- invalid" }, /DATABASE_SSL_CA must contain a complete PEM certificate block/);
expectRejected("conflicting CA configuration", "staging", { DATABASE_SSL_CA_PATH: "/tmp/ca.pem", DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----" }, /Set only one of DATABASE_SSL_CA_PATH or DATABASE_SSL_CA/);
expectRejected("missing KMS key", "staging", { DOCUMENTS_STORAGE_SERVER_SIDE_ENCRYPTION: "aws:kms", DOCUMENTS_STORAGE_KMS_KEY_ID: "" }, /DOCUMENTS_STORAGE_KMS_KEY_ID is missing/);
expectRejected("invalid sender address", "staging", { RESEND_FROM_EMAIL: "not-an-email" }, /RESEND_FROM_EMAIL must contain a valid sender email address/);
expectRejected("production mail endpoint override", "production", { RESEND_API_URL: "http://127.0.0.1:3030" }, /RESEND_API_URL overrides are forbidden for production/);
expectRejected("missing Vercel deployment environment", "production", { VERCEL: "1", VERCEL_ENV: "" }, /VERCEL_ENV is required when preflight runs inside Vercel/);
expectRejected("production configuration checked as staging", "staging", { VERCEL: "1", VERCEL_ENV: "production" }, /Refusing to validate a production deployment as preview\/staging/);

const invalidTarget = spawnSync(process.execPath, ["scripts/pack-9-preflight.mjs", "--target=prod"], {
  cwd: process.cwd(), env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp" }, encoding: "utf8", timeout: 15000,
});
assert.equal(invalidTarget.status, 2, "unsupported target must produce a usage error");
assert.match(outputOf(invalidTarget), /Usage: npm run pack9:preflight/);
console.log("PASS: unsupported preflight target is rejected with a usage error.");

console.log("Pack 9 preflight tests passed: 25 scenarios.");
