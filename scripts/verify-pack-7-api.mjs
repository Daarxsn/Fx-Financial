import assert from "node:assert/strict";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import mysql from "mysql2/promise";

const baseUrl = process.env.API_TEST_BASE_URL ?? "http://127.0.0.1:3002";
if (process.env.CI !== "true" || process.env.DATABASE_HOST !== "127.0.0.1" || process.env.DATABASE_NAME !== "falchion_ci") {
  throw new Error("Pack 7 API tests may run only against the disposable falchion_ci database in GitHub Actions.");
}
if (new URL(baseUrl).hostname !== "127.0.0.1") throw new Error("Pack 7 API test URL must be loopback.");
const db = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT ?? "3306"),
  database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "", ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  connectTimeout: 10000,
});
const suffix = randomBytes(5).toString("hex").toUpperCase();
const entityA = randomUUID(), entityB = randomUUID();
const customerA = randomUUID(), customerB = randomUUID();
const invoiceA = randomUUID(), invoiceB = randomUUID(), draftA = randomUUID(), quotationA = randomUUID(), paymentA = randomUUID(), reversedPayment = randomUUID();
const financeUserId = randomUUID(), creatorUserId = randomUUID();
const financeEmail = "pack7-finance-" + suffix.toLowerCase() + "@example.invalid";
const creatorEmail = "pack7-creator-" + suffix.toLowerCase() + "@example.invalid";
const financePassword = "Pack7-Finance-" + randomBytes(12).toString("hex") + "!";
const creatorPassword = "Pack7-Creator-" + randomBytes(12).toString("hex") + "!";
const customerFormulaName = "=PACK7FORMULA" + suffix;
const outsideCustomerName = "OUT-OF-SCOPE-" + suffix;
const payloadSecret = "PACK7-AUDIT-PAYLOAD-MUST-NEVER-LEAK-" + suffix;
const today = new Date();
const from = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
const to = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
const due = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
const future = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

function hashPassword(value) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) return reject(error);
      resolve("scrypt$32768$8$1$" + salt.toString("base64url") + "$" + key.toString("base64url"));
    });
  });
}
function setCookies(response, jar) {
  const rows = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  for (const line of rows) {
    const pair = line.split(";")[0], at = pair.indexOf("=");
    if (at < 1) continue;
    const key = pair.slice(0, at), value = pair.slice(at + 1);
    if (!value) jar.delete(key); else jar.set(key, value);
  }
}
function cookieHeader(jar) { return [...jar.entries()].map(([name, value]) => name + "=" + value).join("; "); }
async function request(path, { method = "GET", body, headers = {} } = {}, jar = new Map()) {
  const requestHeaders = new Headers(headers);
  if (jar.size) requestHeaders.set("Cookie", cookieHeader(jar));
  if (body !== undefined && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    requestHeaders.set("Origin", baseUrl);
    requestHeaders.set("Sec-Fetch-Site", "same-origin");
    if (jar.get("fx_csrf")) requestHeaders.set("X-CSRF-Token", jar.get("fx_csrf"));
  }
  const response = await fetch(new URL(path, baseUrl), { method, headers: requestHeaders, body, cache: "no-store" });
  const text = await response.text();
  let payload = null;
  if (text && (response.headers.get("content-type") ?? "").includes("json")) {
    try { payload = JSON.parse(text); } catch { /* handled in the assertion below */ }
  }
  setCookies(response, jar);
  return { response, payload, text, jar };
}
async function login(email, password) {
  const jar = new Map();
  const csrf = await fetch(new URL("/api/v1/auth/csrf", baseUrl), { cache: "no-store" });
  const csrfText = await csrf.text();
  const csrfBody = JSON.parse(csrfText);
  setCookies(csrf, jar);
  assert.equal(csrf.status, 200, "CSRF bootstrap succeeds");
  assert.equal(typeof csrfBody.data?.csrfToken, "string", "CSRF token is returned");
  assert.equal(jar.get("fx_csrf"), csrfBody.data.csrfToken, "CSRF cookie and returned value match");
  const result = await request("/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  }, jar);
  assert.equal(result.response.status, 200, "test user login succeeds: " + result.text.slice(0, 300));
  assert.ok(jar.get("fx_session"), "login session cookie is established");
  return jar;
}
async function seedUser(id, email, password, roleKey, scopedEntityId) {
  const [roles] = await db.execute("SELECT id FROM app_roles WHERE role_key=? LIMIT 1", [roleKey]);
  assert.equal(roles.length, 1, "reference role exists: " + roleKey);
  await db.execute(
    "INSERT INTO app_users (id,email,display_name,identity_provider,provider_subject,password_hash,account_status) VALUES (?,?,?,'local_password',?,?, 'ACTIVE')",
    [id, email, roleKey === "finance_admin" ? "Pack 7 Finance Test" : "Pack 7 Creator Test", email, await hashPassword(password)],
  );
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [id, roles[0].id]);
  await db.execute("INSERT INTO user_legal_entity_access (user_id,legal_entity_id,granted_by) VALUES (?,?,NULL)", [id, scopedEntityId]);
}
async function entity(id, suffixName) {
  await db.execute(
    "INSERT INTO legal_entities (id,legal_name,display_name,address_json,currency,time_zone,is_active) VALUES (?,?,?,JSON_OBJECT(),'INR','Asia/Kolkata',1)",
    [id, "Pack 7 Test Issuer " + suffixName, "Pack 7 Test Entity " + suffixName],
  );
}
async function customer(id, name, code) {
  await db.execute(
    "INSERT INTO customers (id,customer_code,name,email,is_active) VALUES (?,?,?,?,1)",
    [id, code, name, "p7-" + code.toLowerCase() + "@example.invalid"],
  );
}
async function invoice(id, legalEntityId, customerId, number, total, dueDate, customerName, issuedBy) {
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,customer_id,document_type,lifecycle_status,financial_year,invoice_number,invoice_date,due_date,currency,supplier_snapshot,customer_snapshot,subtotal,discount_total,tax_total,grand_total,issued_at,issued_by) " +
    "VALUES (?,?,?,'INVOICE','ISSUED',?,?,CAST(? AS DATE),CAST(? AS DATE),'INR',CAST(? AS JSON),CAST(? AS JSON),?,?,?, ?,NOW(3),?)",
    [id, legalEntityId, customerId, "FY26P7-" + suffix, number, today.toISOString().slice(0, 10), dueDate,
      JSON.stringify({ name: "Pack 7 Test Issuer" }), JSON.stringify({ name: customerName }),
      total, "0.0000", "0.0000", total, issuedBy],
  );
}
async function assertStatus(result, status, description) {
  assert.equal(result.response.status, status, description + "; body=" + result.text.slice(0, 500));
}
function pass(message) { console.log("PASS: " + message); }

try {
  await entity(entityA, "A-" + suffix);
  await entity(entityB, "B-" + suffix);
  await customer(customerA, customerFormulaName, "P7A-" + suffix);
  await customer(customerB, outsideCustomerName, "P7B-" + suffix);
  await seedUser(financeUserId, financeEmail, financePassword, "finance_admin", entityA);
  await seedUser(creatorUserId, creatorEmail, creatorPassword, "invoice_creator", entityA);

  await invoice(invoiceA, entityA, customerA, "P7A-" + suffix, "100.0000", due, customerFormulaName, financeUserId);
  await invoice(invoiceB, entityB, customerB, "P7B-" + suffix, "777.0000", due, outsideCustomerName, financeUserId);
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,customer_id,document_type,lifecycle_status,financial_year,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?,?,?,'INVOICE','DRAFT',?,'INR','20.0000','0.0000','0.0000','20.0000')",
    [draftA, entityA, customerA, "FY26P7-" + suffix],
  );
  await db.execute(
    "INSERT INTO quotations (id,legal_entity_id,customer_id,quotation_number,status,issue_date,valid_until,currency,customer_snapshot,supplier_snapshot,subtotal,discount_total,tax_total,grand_total,created_by,updated_by) VALUES (?,?,?,?,'ACCEPTED',CAST(? AS DATE),CAST(? AS DATE),'INR',CAST(? AS JSON),CAST(? AS JSON),'75.5000','0.0000','0.0000','75.5000',?,?)",
    [quotationA, entityA, customerA, "Q-P7-" + suffix, today.toISOString().slice(0, 10), future,
      JSON.stringify({ name: customerFormulaName }), JSON.stringify({ name: "Pack 7 Test Issuer" }), financeUserId, financeUserId],
  );
  await db.execute(
    "INSERT INTO payments (id,legal_entity_id,receipt_reference,customer_id,customer_snapshot,legal_entity_snapshot,amount,currency,payment_date,method,status,reference,notes,recorded_by) VALUES (?,?,?,?,CAST(? AS JSON),CAST(? AS JSON),'25.0000','INR',CAST(? AS DATE),'BANK_TRANSFER','RECORDED',NULL,NULL,?)",
    [paymentA, entityA, "RCPT-P7-" + suffix, customerA,
      JSON.stringify({ name: customerFormulaName }), JSON.stringify({ displayName: "Pack 7 Test Entity A" }),
      today.toISOString().slice(0, 10), financeUserId],
  );
  await db.execute(
    "INSERT INTO payments (id,legal_entity_id,receipt_reference,customer_id,customer_snapshot,legal_entity_snapshot,amount,currency,payment_date,method,status,reference,notes,recorded_by,reversed_at,reversed_by,reversal_reason) VALUES (?,?,?,?,CAST(? AS JSON),CAST(? AS JSON),'5.0000','INR',CAST(? AS DATE),'BANK_TRANSFER','REVERSED',NULL,NULL,?,NOW(3),?,?)",
    [reversedPayment, entityA, "RCPT-P7-R-" + suffix, customerA,
      JSON.stringify({ name: customerFormulaName }), JSON.stringify({ displayName: "Pack 7 Test Entity A" }),
      today.toISOString().slice(0, 10), financeUserId, financeUserId, "Pack 7 API test reversal"],
  );
  await db.execute(
    "INSERT INTO payment_reversal_events (id,payment_id,amount,currency,reason,reversed_by,reversed_at,idempotency_key) VALUES (?,?,'5.0000','INR',?,?,NOW(3),?)",
    [randomUUID(), reversedPayment, "Pack 7 API test reversal", financeUserId, "pack7-" + suffix + "-reversal"],
  );
  await db.execute("INSERT INTO payment_allocations (id,payment_id,invoice_id,amount,idempotency_key,created_by) VALUES (?,?,?,'25.0000',?,?)",
    [randomUUID(), paymentA, invoiceA, "pack7-" + suffix + "-allocation-key", financeUserId]);

  await db.execute(
    "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,change_reason) VALUES (?,?,?,'invoice',?,'SUCCESS',CAST(? AS JSON),CAST(? AS JSON),?)",
    [randomUUID(), financeUserId, "pack7.test.event", invoiceA,
      JSON.stringify({ privatePayload: payloadSecret }), JSON.stringify({ privatePayload: payloadSecret }), "Pack 7 integration test"],
  );
  await db.execute(
    "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,change_reason) VALUES (?,?,?,'invoice',?,'SUCCESS',CAST(? AS JSON),CAST(? AS JSON),?)",
    [randomUUID(), financeUserId, "pack7.test.event", invoiceB,
      JSON.stringify({ privatePayload: "OUTSIDE-" + payloadSecret }), JSON.stringify({ privatePayload: "OUTSIDE-" + payloadSecret }), "Out of scope fixture"],
  );
  pass("Disposable MySQL fixtures cover two entities, issued/draft invoices, a won quotation, a partial receipt allocation, and scoped audit events.");

  const jar = await login(financeEmail, financePassword);
  const period = "from=" + from + "&to=" + to;
  const invoices = await request("/api/v1/reports/invoices?" + period + "&status=ALL&limit=25&offset=0", {}, jar);
  await assertStatus(invoices, 200, "scoped invoice report");
  assert.ok(invoices.payload.data.some(row => row.id === invoiceA), "assigned invoice is returned");
  assert.ok(!invoices.payload.data.some(row => row.id === invoiceB), "unassigned entity invoice is not returned");
  const issued = invoices.payload.data.find(row => row.id === invoiceA);
  assert.equal(issued.outstandingBalance, "75.0000", "issued invoice outstanding reconciles to its 25.0000 recorded allocation");
  const draft = invoices.payload.data.find(row => row.id === draftA);
  assert.equal(draft?.outstandingBalance, null, "draft invoice is not reported as an accounts-receivable balance");
  const emptyPage = await request("/api/v1/reports/invoices?" + period + "&status=ALL&limit=25&offset=999", {}, jar);
  await assertStatus(emptyPage, 200, "empty report page");
  assert.equal(emptyPage.payload.data.length, 0, "out-of-range page has no rows");
  assert.equal(emptyPage.payload.meta.pagination.total, 2, "empty out-of-range page retains the filtered total");
  assert.equal(emptyPage.payload.meta.pagination.hasMore, false, "empty last page hasMore is false");
  pass("Invoice report filters to assigned entity, reconciles exact allocation, excludes draft balances, and preserves totals on an empty page.");

  const summaries = await request("/api/v1/reports/summary?" + period, {}, jar);
  await assertStatus(summaries, 200, "scoped report summary");
  const summary = summaries.payload.data.summaries.find(row => row.legalEntityId === entityA && row.currency === "INR");
  assert.ok(summary, "entity A INR summary is returned");
  assert.equal(summary.issuedInvoiceCount, 1, "only issued invoices count as issued");
  assert.equal(summary.issuedInvoiceValue, "100.0000", "issued invoice value sums DECIMAL accurately");
  assert.equal(summary.currentOutstandingBalance, "75.0000", "current outstanding reconciles to allocation total");
  assert.equal(summary.quotationsWonCount, 1, "accepted quotation is included in won count");
  assert.equal(summary.quotationsWonValue, "75.5000", "accepted quotation value stays exact");
  assert.ok(!summaries.payload.data.summaries.some(row => row.legalEntityId === entityB), "out-of-scope entity summary is not returned");
  assert.equal(summaries.payload.data.metricDefinitionsStatus, "PENDING_FINANCE_APPROVAL", "finance policy status is explicitly exposed");
  assert.equal(summary.reversedReceiptCount, 1, "reversal event is reported by its reversal date");
  assert.equal(summary.reversedReceiptValue, "5.0000", "reversal amount stays exact");
  pass("Summary metrics reconcile against inserted source records and do not aggregate across currencies or entity scope.");

  const quotations = await request("/api/v1/reports/quotations?" + period + "&status=ALL", {}, jar);
  await assertStatus(quotations, 200, "quotation report");
  assert.ok(quotations.payload.data.some(row => row.id === quotationA && row.total === "75.5000"), "quotation data returns exact amount");
  const payments = await request("/api/v1/reports/payments?" + period + "&status=ALL", {}, jar);
  await assertStatus(payments, 200, "payment report");
  assert.ok(payments.payload.data.some(row => row.id === paymentA && row.allocatedAmount === "25.0000" && row.unallocatedAmount === "0.0000"), "receipt allocations reconcile");
  assert.ok(payments.payload.data.some(row => row.id === reversedPayment && row.status === "REVERSED" && row.allocatedAmount === "0.0000"), "reversed receipt remains visible without active allocation");
  const customers = await request("/api/v1/reports/customers?" + period + "&status=ALL", {}, jar);
  await assertStatus(customers, 200, "customer activity report");
  assert.ok(customers.payload.data.some(row => row.legalEntityId === entityA && row.customerId === customerA), "customer activity links customer rows to entity A documents");
  assert.ok(!customers.payload.data.some(row => row.legalEntityId === entityB || row.name === outsideCustomerName), "customer report hides out-of-scope activity");
  pass("Quotation, receipt, and customer-activity reports expose scoped source records and exact decimal values.");

  const forbiddenScope = await request("/api/v1/reports/invoices?" + period + "&legalEntityId=" + entityB, {}, jar);
  await assertStatus(forbiddenScope, 404, "query parameter cannot expand assigned entity scope");
  const invalidRange = await request("/api/v1/reports/invoices?from=2025-01-01&to=2026-10-22", {}, jar);
  await assertStatus(invalidRange, 400, "report date window over 366 days is rejected");
  const creatorJar = await login(creatorEmail, creatorPassword);
  const noReportPermission = await request("/api/v1/reports/invoices?" + period, {}, creatorJar);
  await assertStatus(noReportPermission, 403, "role without reports:read cannot use report APIs");
  const anonymousAudit = await request("/api/v1/audit?" + period);
  await assertStatus(anonymousAudit, 401, "audit endpoint requires authentication");
  pass("Scope narrowing, date limits, least-privilege reporting, and anonymous audit denial are enforced.");

  const audit = await request("/api/v1/audit?" + period + "&query=pack7.test.event&resourceType=invoice&limit=25&offset=0", {}, jar);
  await assertStatus(audit, 200, "scoped audit search");
  assert.ok(audit.payload.data.some(row => row.resourceId === invoiceA), "assigned audit event is returned");
  assert.ok(!audit.payload.data.some(row => row.resourceId === invoiceB), "out-of-scope audit event is hidden");
  assert.equal(audit.text.includes(payloadSecret), false, "raw audit payload secret is omitted");
  assert.equal(audit.text.includes("before_json"), false, "raw before_json payload is omitted");
  assert.equal(audit.payload.meta.payloadsOmitted, true, "payload omission is documented");
  const reversalAudit = await request("/api/v1/audit?" + period + "&query=payment.reversed&resourceType=payment&limit=25&offset=0", {}, jar);
  await assertStatus(reversalAudit, 200, "payment reversal audit search");
  assert.ok(reversalAudit.payload.data.some(row => row.resourceId === reversedPayment && row.source === "payment_reversal_events"), "append-only reversal event appears in audit search");
  pass("Searchable audit API enforces scope, includes payment reversals, and never serializes before/after payloads.");

  const exportResult = await request("/api/v1/reports/invoices/export?" + period + "&status=ALL&limit=25&offset=0&rowLimit=10000",
    { method: "POST", body: "{}" }, jar);
  await assertStatus(exportResult, 200, "authorized CSV export");
  assert.match(exportResult.response.headers.get("content-type") ?? "", /text\/csv/i);
  assert.match(exportResult.response.headers.get("content-disposition") ?? "", /falchion-invoices-report/);
  assert.ok(exportResult.text.includes("'=PACK7FORMULA" + suffix), "formula-leading customer text is escaped for spreadsheet safety");
  assert.equal(exportResult.text.includes(outsideCustomerName), false, "CSV excludes out-of-scope customer data");
  assert.equal(exportResult.text.includes("p7a-" + suffix.toLowerCase() + "@example.invalid"), false, "CSV omits customer email under the approved field allowlist");
  for (const kind of ["quotations", "payments", "customers"]) {
    const otherExport = await request("/api/v1/reports/" + kind + "/export?" + period + "&status=ALL&limit=25&offset=0&rowLimit=10000",
      { method: "POST", body: "{}" }, jar);
    await assertStatus(otherExport, 200, kind + " CSV export");
    assert.match(otherExport.response.headers.get("content-type") ?? "", /text\/csv/i);
    assert.ok(otherExport.text.length > 0, kind + " CSV has a header row");
  }
  const oversizedExport = await request("/api/v1/reports/invoices/export?" + period + "&status=ALL&rowLimit=10001",
    { method: "POST", body: "{}" }, jar);
  await assertStatus(oversizedExport, 400, "export row limit above 10000 is rejected");
  const exportAudit = await request("/api/v1/audit?" + period + "&query=report.exported&resourceType=report_export&limit=25&offset=0", {}, jar);
  await assertStatus(exportAudit, 200, "export audit event search");
  assert.ok(exportAudit.payload.data.some(row => row.resourceId === entityA && row.action === "report.exported"), "exports have audit records before CSV responses");
  pass("All four CSRF-protected CSV exports enforce allowlists and limits, escape formulas, use no-store headers, and write audit events.");

  console.log("PASS: Pack 7 API acceptance passed with scoped finance fixtures.");
} finally {
  await db.end();
}
