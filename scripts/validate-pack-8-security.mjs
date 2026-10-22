import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const read = (path) => readFile(path, "utf8");
const [invoice, quotation, csrf, nextConfig, packageJson, workflow, apiErrors, docAccess, docService, storage, reportsHttp, invoiceValidation, csvImport, catalogImport] = await Promise.all([
  read("src/app/api/v1/invoices/route.ts"),
  read("src/app/api/v1/quotations/route.ts"),
  read("src/lib/auth/csrf.ts"),
  read("next.config.ts"),
  read("package.json").then(JSON.parse),
  read(".github/workflows/ci.yml"),
  read("src/lib/http/api-response.ts"),
  read("src/lib/documents/access.ts"),
  read("src/lib/documents/service.ts"),
  read("src/lib/documents/storage.ts"),
  read("src/lib/reports/http.ts"),
  read("src/lib/validation/invoice.ts"),
  read("src/app/api/v1/customers/import/route.ts"),
  read("src/app/api/v1/catalog/items/import/route.ts"),
]);
const envExample = await read(".env.example");
const integration = await read("scripts/verify-master-data-api.mjs");

const checks = [
  ["invoice entity scope is checked before idempotency replay lookup",
    invoice.indexOf("actor.legalEntityIds.includes(input.legalEntityId)") > invoice.indexOf("invoiceDraftCreateSchema.parse") &&
    invoice.indexOf("actor.legalEntityIds.includes(input.legalEntityId)") < invoice.indexOf("WHERE idempotency_key=?")],
  ["quotation entity scope is checked before idempotency replay lookup",
    quotation.indexOf("actor.legalEntityIds.includes(input.legalEntityId)") > quotation.indexOf("quotationCreateSchema.parse") &&
    quotation.indexOf("actor.legalEntityIds.includes(input.legalEntityId)") < quotation.indexOf("WHERE idempotency_key=?")],
  ["invoice cross-entity idempotency replay regression is covered",
    integration.includes("phase8OutOfScopeReplay") && integration.includes("does not disclose the invoice identifier")],
  ["quotation cross-entity idempotency replay regression is covered",
    integration.includes("outOfScopeQuotationReplay") && integration.includes("does not disclose the quotation identifier")],
  ["production write requests fail closed without an explicit public origin",
    csrf.includes('process.env.NODE_ENV === "production" && !configured')],
  ["production origin contract is documented in the environment template",
    envExample.includes("APP_ORIGIN=https://")],
  ["global browser security headers are defined",
    ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy"].every(name => nextConfig.includes(name))],
  ["HSTS is applied only in production",
    nextConfig.includes("Strict-Transport-Security") && nextConfig.includes('process.env.NODE_ENV === "production"')],
  ["the powered-by disclosure remains disabled",
    nextConfig.includes("poweredByHeader: false")],
  ["API errors use no-store, nosniff and request correlation",
    apiErrors.includes("Cache-Control") && apiErrors.includes("X-Content-Type-Options") && apiErrors.includes("X-Request-Id")],
  ["document access helpers include source-permission and legal-entity checks",
    docAccess.includes("permissionForDocumentSource") && docAccess.includes("assertDocumentScope")],
  ["stored PDF release verifies length and SHA-256",
    docService.includes("head.byteSize !== Number(row.byte_size)") && docService.includes("actual !== row.file_sha256") && storage.includes("MAX_DOCUMENT_BYTES")],
  ["report exports share CSRF protection in the delegated handler",
    reportsHttp.includes("assertCsrf") && reportsHttp.includes("requirePermission")],
  ["invoice inputs are bounded in line count and field length",
    invoiceValidation.includes(".max(500)") && invoiceValidation.includes(".max(1000)") && invoiceValidation.includes(".max(5000)")],
  ["CSV import handlers enforce byte/row caps and CSRF",
    csvImport.includes("MAX_CSV_BYTES") && csvImport.includes("MAX_CSV_ROWS") && csvImport.includes("assertCsrf") &&
    catalogImport.includes("MAX_CSV_BYTES") && catalogImport.includes("MAX_CSV_ROWS") && catalogImport.includes("assertCsrf")],
  ["explicit dependency advisory audit is required in CI",
    workflow.includes("npm run security:audit") && packageJson.scripts["security:audit"] === "node scripts/audit-dependencies.mjs" && packageJson.scripts["pack8:validate"] === "node scripts/validate-pack-8-security.mjs"],
  ["Pack 8 guardrail validator is wired into CI",
    workflow.includes("npm run pack8:validate")],
];

async function findRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await findRouteFiles(path));
    else if (entry.isFile() && entry.name === "route.ts") result.push(path.replaceAll("\\", "/"));
  }
  return result;
}

const routes = await findRouteFiles("src/app/api");
const publicReadExceptions = new Set([
  "src/app/api/health/route.ts",
  "src/app/api/v1/health/route.ts",
  "src/app/api/v1/auth/csrf/route.ts",
]);
for (const path of routes) {
  const source = await read(path);
  const unsafeMethods = [...source.matchAll(/export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\s*\(/g)];
  const readMethods = [...source.matchAll(/export\s+async\s+function\s+(GET|HEAD)\s*\(/g)];
  if (unsafeMethods.length) {
    const directCsrf = /assertCsrf\s*\(/.test(source);
    const reportCsrf = /handleReportExport/.test(source) && /assertCsrf\s*\(/.test(reportsHttp);
    const cronAuth = path.endsWith("/api/cron/email-outbox/route.ts") && source.includes("CRON_SECRET");
    const webhookAuth = path.endsWith("/api/webhooks/resend/route.ts") && /signature|timingSafeEqual|createHmac/i.test(source);
    checks.push(["mutating handler has CSRF or verified machine authentication: " + path,
      directCsrf || reportCsrf || cronAuth || webhookAuth]);
  }
  if (readMethods.length && !publicReadExceptions.has(path)) {
    const hasAuthGate = /requirePermission|requirePermissionForEntity|requireSession|requireActiveSession|getSession\(|handleReport|assertDocumentScope|CRON_SECRET|signature/i.test(source);
    checks.push(["sensitive read handler has an authorization or verified machine gate: " + path, hasAuthGate]);
  }
}

let failures = 0;
for (const [name, pass] of checks) {
  if (!pass) {
    console.error("FAIL: " + name);
    failures++;
  } else {
    console.log("PASS: " + name);
  }
}
console.log("Pack 8 static security checks: " + (checks.length - failures) + "/" + checks.length + " passed across " + routes.length + " API route files.");
if (failures) process.exitCode = 1;
