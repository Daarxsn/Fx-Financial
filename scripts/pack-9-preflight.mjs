#!/usr/bin/env node
import { accessSync, constants } from "node:fs";

const targetFlag = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetFlag ? targetFlag.slice("--target=".length) : "";
if (!["preview", "staging", "production"].includes(target)) {
  console.error("Usage: npm run pack9:preflight -- --target=preview|staging|production");
  process.exit(2);
}

const errors = [];
const checked = [];
const value = (key) => (process.env[key] ?? "").trim();
const looksPlaceholder = (entry) => /replace|placeholder|example|your-|changeme|ci-only|dummy|sample-secret/i.test(entry);

function requireValue(key, options = {}) {
  const entry = value(key);
  if (!entry) {
    errors.push(key + " is missing");
    return "";
  }
  if (options.secret && (entry.length < (options.minLength ?? 16) || looksPlaceholder(entry))) {
    errors.push(key + " is missing, too short, or still contains a placeholder");
    return "";
  }
  if (options.nonPlaceholder && looksPlaceholder(entry)) {
    errors.push(key + " still contains a placeholder");
    return "";
  }
  checked.push(key);
  return entry;
}

const databaseHost = requireValue("DATABASE_HOST", { nonPlaceholder: true });
if (databaseHost && ["localhost", "127.0.0.1", "::1"].includes(databaseHost.toLowerCase())) {
  errors.push("DATABASE_HOST must refer to the remote managed database, not loopback");
}
for (const key of ["DATABASE_NAME", "DATABASE_USER"]) {
  requireValue(key, { nonPlaceholder: true });
}
requireValue("DATABASE_PASSWORD", { secret: true, minLength: 8 });

const port = requireValue("DATABASE_PORT");
if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
  errors.push("DATABASE_PORT must be an integer between 1 and 65535");
}

if (value("DATABASE_SSL").toLowerCase() !== "true") {
  errors.push("DATABASE_SSL must be true for preview, staging, and production");
} else {
  checked.push("DATABASE_SSL");
}

const sessionSecret = requireValue("SESSION_SECRET", { secret: true, minLength: 32 });
if (sessionSecret && new Set(sessionSecret).size < 10) {
  errors.push("SESSION_SECRET does not have enough character diversity");
}

const origin = requireValue("APP_ORIGIN", { nonPlaceholder: true });
if (origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) {
      errors.push("APP_ORIGIN must be the exact HTTPS origin, without a path, credentials, query, or fragment");
    }
  } catch {
    errors.push("APP_ORIGIN is not a valid URL origin");
  }
}

const caPath = value("DATABASE_SSL_CA_PATH");
const caPem = value("DATABASE_SSL_CA");
if (caPath && caPem) {
  errors.push("Set only one of DATABASE_SSL_CA_PATH or DATABASE_SSL_CA");
} else if (caPath) {
  try {
    accessSync(caPath, constants.R_OK);
    checked.push("DATABASE_SSL_CA_PATH");
  } catch {
    errors.push("DATABASE_SSL_CA_PATH is not readable by this process");
  }
} else if (caPem && !caPem.includes("-----BEGIN CERTIFICATE-----")) {
  errors.push("DATABASE_SSL_CA must contain PEM certificate content");
}

const storageDriver = requireValue("DOCUMENTS_STORAGE_DRIVER");
if (storageDriver !== "s3") {
  errors.push("DOCUMENTS_STORAGE_DRIVER must be s3 for Vercel/production");
}
for (const key of ["DOCUMENTS_STORAGE_BUCKET", "DOCUMENTS_STORAGE_REGION"]) {
  requireValue(key, { nonPlaceholder: true });
}
requireValue("DOCUMENTS_STORAGE_ACCESS_KEY_ID", { nonPlaceholder: true });
requireValue("DOCUMENTS_STORAGE_SECRET_ACCESS_KEY", { secret: true, minLength: 16 });

const endpoint = value("DOCUMENTS_STORAGE_ENDPOINT");
if (endpoint) {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      errors.push("DOCUMENTS_STORAGE_ENDPOINT must use HTTPS and contain no embedded credentials, query, or fragment");
    }
  } catch {
    errors.push("DOCUMENTS_STORAGE_ENDPOINT is not a valid URL");
  }
}
const encryption = value("DOCUMENTS_STORAGE_SERVER_SIDE_ENCRYPTION") || "AES256";
if (!["AES256", "aws:kms"].includes(encryption)) {
  errors.push("DOCUMENTS_STORAGE_SERVER_SIDE_ENCRYPTION must be AES256 or aws:kms");
}
if (encryption === "aws:kms") {
  requireValue("DOCUMENTS_STORAGE_KMS_KEY_ID", { nonPlaceholder: true });
}

requireValue("RESEND_API_KEY", { secret: true, minLength: 16 });
const sender = requireValue("RESEND_FROM_EMAIL", { nonPlaceholder: true });
if (sender) {
  const match = sender.match(/<([^<>]+)>/);
  const address = match ? match[1] : sender;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    errors.push("RESEND_FROM_EMAIL must contain a valid sender email address");
  }
}
requireValue("RESEND_WEBHOOK_SECRET", { secret: true, minLength: 32 });
const cronSecret = requireValue("CRON_SECRET", { secret: true, minLength: 32 });
if (cronSecret && new Set(cronSecret).size < 10) {
  errors.push("CRON_SECRET does not have enough character diversity");
}

if (value("RESEND_API_URL")) {
  try {
    const parsed = new URL(value("RESEND_API_URL"));
    if (target === "production") {
      errors.push("RESEND_API_URL overrides are forbidden for production");
    } else if (parsed.protocol !== "https:" && target !== "preview") {
      errors.push("RESEND_API_URL must use HTTPS outside local development");
    }
  } catch {
    errors.push("RESEND_API_URL is not a valid URL");
  }
}

if (process.env.VERCEL === "1" && process.env.VERCEL_ENV) {
  if (target === "production" && process.env.VERCEL_ENV !== "production") {
    errors.push("The requested target does not match VERCEL_ENV");
  }
  if (target !== "production" && process.env.VERCEL_ENV === "production") {
    errors.push("Refusing to validate a production deployment as preview/staging");
  }
}

console.log("Pack 9 environment preflight target: " + target);
if (errors.length) {
  for (const error of errors) console.error("FAIL: " + error);
  console.error("No environment values were printed. Correct the listed keys in the selected deployment environment.");
  process.exit(1);
}
console.log("PASS: runtime, origin, TLS, private storage, email, webhook, and scheduler settings are present and structurally valid.");
console.log("NOTE: presence/shape checks are not connectivity, sender-verification, permission-grant, or backup-restore proof.");
