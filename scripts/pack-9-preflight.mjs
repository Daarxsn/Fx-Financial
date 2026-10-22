#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { isIP } from "node:net";

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

function isLoopbackOrLinkLocalDatabaseHost(rawHost) {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "localhost.localdomain") return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 0 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254);
  }
  if (ipVersion === 6) {
    if (host === "::" || host === "::1") return true;
    // IPv4-mapped IPv6 can encode loopback/link-local addresses in dotted or hexadecimal form.
    if (host.startsWith("::ffff:")) return true;
    // IPv6 link-local is fe80::/10.
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  }
  // Some resolvers accept non-canonical IPv4 forms such as 127.1 or a packed integer.
  // Reject numeric-only forms rather than letting resolver-specific shorthand bypass the check.
  if (ipVersion === 0 && (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host))) return true;
  return false;
}

const databaseHost = requireValue("DATABASE_HOST", { nonPlaceholder: true });
if (databaseHost) {
  if (/[\s/@?#]/.test(databaseHost)) {
    errors.push("DATABASE_HOST must be a hostname or IP address, not a URL or path");
  }
  if (isLoopbackOrLinkLocalDatabaseHost(databaseHost)) {
    errors.push("DATABASE_HOST must refer to the remote managed database, not loopback or link-local networking");
  }
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
} else if (caPem && !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(caPem)) {
  errors.push("DATABASE_SSL_CA must contain a complete PEM certificate block");
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

if (process.env.VERCEL === "1") {
  const deploymentEnvironment = value("VERCEL_ENV");
  if (!deploymentEnvironment) {
    errors.push("VERCEL_ENV is required when preflight runs inside Vercel");
  } else {
    if (target === "production" && deploymentEnvironment !== "production") {
      errors.push("The requested target does not match VERCEL_ENV");
    }
    if (target !== "production" && deploymentEnvironment === "production") {
      errors.push("Refusing to validate a production deployment as preview/staging");
    }
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
