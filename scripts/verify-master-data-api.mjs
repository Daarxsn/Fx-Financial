import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import mysql from "mysql2/promise";

const baseUrl = process.env.API_TEST_BASE_URL ?? "http://127.0.0.1:3002";
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) throw new Error("A CI-only SESSION_SECRET of at least 32 characters is required");

const db = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? "3306"),
  database: process.env.DATABASE_NAME ?? "falchion_ci",
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  connectTimeout: 10000,
});

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) return reject(error);
      resolve("scrypt$32768$8$1$" + salt.toString("base64url") + "$" + key.toString("base64url"));
    });
  });
}

const EXPECTED_PERMISSION_KEYS = [
  "customers:read",
  "customers:create",
  "customers:update",
  "customers:archive",
  "catalog:read",
  "catalog:create",
  "catalog:update",
  "catalog:archive",
  "invoices:read",
  "invoices:draft:create",
  "invoices:draft:update",
  "invoices:issue",
  "invoices:cancel",
  "payments:read",
  "payments:record",
  "payments:reverse",
  "quotations:read",
  "quotations:write",
  "approvals:read",
  "approvals:decide",
  "reports:read",
  "audit:read",
  "users:manage",
  "settings:manage"
];

// Exact CI baseline. Catch accidental permission additions/removals without changing the production
// rule that an already-customized role mapping is not overwritten by a repeat seed.
const EXPECTED_ROLE_GRANTS = {
  "system_admin": [...EXPECTED_PERMISSION_KEYS],
  "finance_admin": [
    "customers:read",
    "customers:create",
    "customers:update",
    "customers:archive",
    "catalog:read",
    "catalog:create",
    "catalog:update",
    "catalog:archive",
    "invoices:read",
    "invoices:draft:create",
    "invoices:draft:update",
    "invoices:issue",
    "invoices:cancel",
    "payments:read",
    "payments:record",
    "payments:reverse",
    "quotations:read",
    "quotations:write",
    "approvals:read",
    "approvals:decide",
    "reports:read",
    "audit:read",
    "settings:manage"
  ],
  "invoice_creator": [
    "customers:read",
    "customers:create",
    "customers:update",
    "catalog:read",
    "invoices:read",
    "invoices:draft:create",
    "invoices:draft:update",
    "quotations:read",
    "quotations:write"
  ],
  "invoice_issuer": [
    "customers:read",
    "catalog:read",
    "invoices:read",
    "invoices:issue",
    "quotations:read"
  ],
  "payment_recorder": [
    "customers:read",
    "invoices:read",
    "payments:read",
    "payments:record"
  ],
  "approver": [
    "invoices:read",
    "quotations:read",
    "approvals:read",
    "approvals:decide"
  ],
  "auditor": [
    "customers:read",
    "catalog:read",
    "invoices:read",
    "payments:read",
    "quotations:read",
    "approvals:read",
    "reports:read",
    "audit:read"
  ]
};

async function seedUser(roleKey, email, status = "ACTIVE", password = "Phase Five Strong Password!", legalEntityIds = []) {
  const userId = randomUUID();
  const hash = status === "ACTIVE" ? await hashPassword(password) : null;
  await db.execute(
    "INSERT INTO app_users (id,email,display_name,identity_provider,provider_subject,password_hash,account_status) VALUES (?,?,?,'local_password',?,?,?)",
    [userId, email, "Phase 05 CI User", email, hash, status],
  );
  const [roles] = await db.execute("SELECT id FROM app_roles WHERE role_key=? LIMIT 1", [roleKey]);
  assert.equal(roles.length, 1, `role template ${roleKey} exists`);
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId, roles[0].id]);
  for (const legalEntityId of new Set(legalEntityIds)) {
    await db.execute(
      "INSERT INTO user_legal_entity_access (user_id, legal_entity_id, granted_by) VALUES (?, ?, NULL)",
      [userId, legalEntityId],
    );
  }
  return { userId, email, password };
}

function cookiePairs(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const rows = getSetCookie ? getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  return rows.map((row) => row.split(";")[0]).filter(Boolean);
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => key + "=" + value).join("; ");
}
function applyCookies(jar, response) {
  for (const pair of cookiePairs(response)) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (!value) jar.delete(key);
    else jar.set(key, value);
  }
}
function assertRequestId(response, body) {
  const requestId = response.headers.get("x-request-id");
  assert.ok(requestId, "X-Request-Id must be returned");
  if (body?.meta?.requestId) assert.equal(body.meta.requestId, requestId);
  if (body?.error?.requestId) assert.equal(body.error.requestId, requestId);
}
async function call(path, options = {}, jar = new Map(), { csrf = true } = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = { ...(options.headers ?? {}) };
  if (jar.size) headers.Cookie = cookieHeader(jar);
  if (options.body) headers["Content-Type"] ??= "application/json";
  if (method !== "GET" && method !== "HEAD") {
    headers.Origin ??= baseUrl;
    headers["Sec-Fetch-Site"] ??= "same-origin";
    if (csrf && jar.get("fx_csrf")) headers["X-CSRF-Token"] ??= jar.get("fx_csrf");
  }
  const response = await fetch(new URL(path, baseUrl), { ...options, headers, cache: "no-store" });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  assertRequestId(response, body);
  applyCookies(jar, response);
  return { response, body, jar };
}
async function getCsrf() {
  const jar = new Map();
  const response = await fetch(new URL("/api/v1/auth/csrf", baseUrl), { cache: "no-store" });
  const body = await response.json();
  assertRequestId(response, body);
  applyCookies(jar, response);
  assert.equal(typeof jar.get("fx_csrf"), "string");
  assert.equal(body.data.csrfToken, jar.get("fx_csrf"));
  const setCookies = cookiePairs(response);
  const csrfSetCookie = setCookies.find((item) => item.startsWith("fx_csrf="));
  assert.ok(csrfSetCookie);
  const rawHeaders = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const csrfHeader = rawHeaders.find((item) => item.startsWith("fx_csrf=")) ?? "";
  assert.match(csrfHeader, /SameSite=Strict/i);
  assert.doesNotMatch(csrfHeader, /HttpOnly/i);
  return jar;
}
async function login(user) {
  const jar = await getCsrf();
  const result = await call("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: user.email, password: user.password }),
  }, jar);
  assert.equal(result.response.status, 200, "login should succeed for active account with correct credentials; received " + result.response.status + " " + JSON.stringify(result.body?.error ?? null));
  assert.equal(result.body.data.user.email, user.email);
  assert.ok(Array.isArray(result.body.data.user.roles));
  assert.ok(Array.isArray(result.body.data.user.permissions));
  assert.ok(jar.get("fx_session"));
  assert.equal(JSON.stringify(result.body).includes(jar.get("fx_session")), false, "raw session token must never appear in response JSON");
  const rawHeaders = result.response.headers.getSetCookie?.() ?? [result.response.headers.get("set-cookie") ?? ""];
  const sessionHeader = rawHeaders.find((item) => item.startsWith("fx_session=")) ?? "";
  const csrfHeader = rawHeaders.find((item) => item.startsWith("fx_csrf=")) ?? "";
  assert.match(sessionHeader, /HttpOnly/i, "session cookie must be HttpOnly");
  assert.match(sessionHeader, /SameSite=Lax/i);
  assert.match(sessionHeader, /Path=\//i);
  assert.doesNotMatch(sessionHeader, /Secure/i, "development cookie is non-Secure; production config enables Secure");
  assert.doesNotMatch(csrfHeader, /HttpOnly/i, "CSRF cookie needs to be readable by same-origin client code");
  return { jar, body: result.body };
}
async function sessionIdFor(session) {
  const [rows] = await db.execute("SELECT id FROM auth_sessions WHERE token_hash=? LIMIT 1",
    [createHash("sha256").update(session.jar.get("fx_session")).digest("hex")]);
  assert.equal(rows.length, 1, "test session row exists");
  return rows[0].id;
}
// Mirrors src/lib/master-data/import-token.ts so the suite can forge expired or mis-bound tokens with the CI-only secret.
function mintImportToken({ resource, userId, sessionId, csv, expiresAt }) {
  const key = createHmac("sha256", sessionSecret).update("fx-csv-import-validation:v1").digest();
  const csvSha256 = createHash("sha256").update(Buffer.from(csv, "utf8")).digest("hex");
  const mac = createHmac("sha256", key).update(["v1", resource, userId, sessionId, csvSha256, String(expiresAt)].join("\n")).digest("base64url");
  return "v1." + expiresAt + "." + mac;
}
const importHeaders = (token) => ({ "Content-Type": "text/csv", ...(token ? { "X-Import-Validation-Token": token } : {}) });
async function expectStatus(promise, status, label) {
  const result = await promise;
  assert.equal(result.response.status, status, label);
  return result;
}
function assertPage(body, limit) {
  assert.ok(Array.isArray(body.data), "list response data must be an array");
  assert.equal(body.meta.pagination.limit, limit);
  assert.equal(typeof body.meta.pagination.offset, "number");
  assert.equal(typeof body.meta.pagination.hasMore, "boolean");
  assert.equal("page" in body, false, "legacy top-level page field must not be returned");
}

async function assertRoleGrantMatrix() {
  const [permissionRows] = await db.execute("SELECT permission_key FROM app_permissions ORDER BY permission_key");
  assert.deepEqual(permissionRows.map((row) => row.permission_key).sort(), [...EXPECTED_PERMISSION_KEYS].sort(),
    "permission catalog must match the reviewed baseline exactly");

  const [mappingRows] = await db.execute(
    `SELECT r.role_key, p.permission_key
       FROM app_roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN app_permissions p ON p.id = rp.permission_id
      ORDER BY r.role_key, p.permission_key`,
  );
  const actualGrants = Object.fromEntries(Object.keys(EXPECTED_ROLE_GRANTS).map((roleKey) => [roleKey, []]));
  for (const row of mappingRows) {
    assert.ok(Object.hasOwn(actualGrants, row.role_key),
      "unexpected role template must not silently enter the reference baseline: " + row.role_key);
    if (row.permission_key) actualGrants[row.role_key].push(row.permission_key);
  }
  assert.deepEqual(Object.keys(actualGrants).sort(), Object.keys(EXPECTED_ROLE_GRANTS).sort(),
    "all seven reviewed role templates must exist, with no unknown role template");
  for (const [roleKey, permissions] of Object.entries(EXPECTED_ROLE_GRANTS)) {
    assert.deepEqual(actualGrants[roleKey].sort(), [...permissions].sort(),
      "least-privilege grants for " + roleKey + " must match the reviewed matrix exactly");
  }
  console.log("PASS: all 24 permission definitions and all seven exact role-grant templates match the least-privilege baseline.");
}

async function assertRoleSurface(roleKey, session) {
  const expected = EXPECTED_ROLE_GRANTS[roleKey];
  assert.ok(expected, "role must have a reviewed grant template: " + roleKey);
  const profile = await call("/api/v1/auth/me", {}, session.jar);
  assert.equal(profile.response.status, 200, roleKey + " can read its own session profile");
  assert.deepEqual(profile.body.data.user.roles, [roleKey], roleKey + " session role must be database-derived");
  assert.deepEqual([...profile.body.data.user.permissions].sort(), [...expected].sort(),
    roleKey + " effective session permissions must equal the database grant matrix");
  if (roleKey === "system_admin") {
    const [entityRows] = await db.query("SELECT id FROM legal_entities ORDER BY id");
    assert.deepEqual([...profile.body.data.user.legalEntityIds].sort(), entityRows.map((row) => row.id).sort(),
      "Super Administrator must receive global scope over every existing legal entity");
  }

  for (const surface of [
    { path: "/api/v1/customers?limit=1&offset=0", permission: "customers:read" },
    { path: "/api/v1/catalog/items?limit=1&offset=0", permission: "catalog:read" },
  ]) {
    const result = await call(surface.path, {}, session.jar);
    const allowed = expected.includes(surface.permission);
    assert.equal(result.response.status, allowed ? 200 : 403,
      roleKey + (allowed ? " must be allowed to read " : " must be denied reading ") + surface.permission);
    if (!allowed) assert.equal(result.body.error.code, "FORBIDDEN");
  }

  for (const surface of [
    { path: "/api/v1/customers", permission: "customers:create", body: { name: "RBAC regression fixture" } },
    { path: "/api/v1/catalog/items", permission: "catalog:create", body: {} },
    { path: "/api/v1/customers/import?mode=validate", permission: "customers:create", body: { csv: "name" } },
    { path: "/api/v1/catalog/items/import?mode=validate", permission: "catalog:create", body: { csv: "name" } },
    { method: "PATCH", path: "/api/v1/customers/" + randomUUID(), permission: "customers:update", body: { expectedVersion: 1, name: "RBAC regression fixture" } },
    { method: "PATCH", path: "/api/v1/catalog/items/" + randomUUID(), permission: "catalog:update", body: { expectedVersion: 1, name: "RBAC regression fixture" } },
  ]) {
    if (expected.includes(surface.permission)) continue;
    const result = await call(surface.path, { method: surface.method ?? "POST", body: JSON.stringify(surface.body) }, session.jar);
    assert.equal(result.response.status, 403, roleKey + " must be denied " + surface.permission);
    assert.equal(result.body.error.code, "FORBIDDEN");
  }

  const users = await call("/api/v1/users?limit=1&offset=0", {}, session.jar);
  const canManageUsers = expected.includes("users:manage");
  assert.equal(users.response.status, canManageUsers ? 200 : 403,
    roleKey + (canManageUsers ? " must be allowed to manage users" : " must not access the user directory"));
  if (!canManageUsers) assert.equal(users.body.error.code, "FORBIDDEN");
}

try {
  await assertRoleGrantMatrix();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const testLegalEntityId = randomUUID();
  await db.execute(
    "INSERT INTO legal_entities (id, legal_name, display_name, address_json, currency, is_active) " +
    "VALUES (?, ?, ?, JSON_OBJECT('line1', 'CI-only fixture'), 'INR', TRUE)",
    [testLegalEntityId, "CI Test Legal Entity " + suffix, "CI Test Entity " + suffix],
  );
  // This legacy fixture is inserted directly for RBAC testing, so seed the same pending
  // issuer-policy records that the production legal-entity API creates transactionally.
  const p4SeedEntityPolicies = [
    ["D-02","Numbering","Use an approved server-side sequence per issuer and document type.","Business owner and finance/accounting","Awaiting issuer-specific numbering format and evidence."],
    ["D-03","Financial year","Configure the actual issuer financial-year boundary and timezone.","Finance/accounting owner","Awaiting issuer-specific financial-year/timezone decision."],
    ["D-04","Currency","Use the legal entity currency from approved issuer records.","Finance/accounting owner","Awaiting explicit currency approval from authoritative records."],
    ["D-06","Tax registrations and rule matrix","Use approved effective-dated tax rules and matching registrations.","Finance/accounting and qualified tax reviewer","Awaiting issuer-specific tax matrix approval."],
    ["D-07","Payment terms and due dates","Use approved issuer/customer contract terms and snapshot due dates.","Finance and business owner","Awaiting issuer-specific payment-terms decision."],
    ["D-11","E-invoice and statutory applicability","Record an evidenced statutory applicability decision; do not infer electronic submission.","Tax/accounting owner; tax/legal where required","Awaiting issuer-specific statutory applicability evidence."],
  ];
  for (const [decisionKey,topic,recommendation,approver,rationale] of p4SeedEntityPolicies) {
    await db.execute(
      "INSERT IGNORE INTO business_policy_decisions (id,decision_key,legal_entity_id,topic,recommended_starting_point,required_approver,requires_issue_gate,status,rationale) VALUES (?,?,?,?,?,?,TRUE,'PENDING',?)",
      [randomUUID(),decisionKey,testLegalEntityId,topic,recommendation,approver,rationale],
    );
  }
  const staff = await seedUser("invoice_creator", "staff-" + suffix + "@example.invalid");
  const viewer = await seedUser("auditor", "viewer-" + suffix + "@example.invalid", "ACTIVE", "Viewer Strong Password #5!", [testLegalEntityId]);
  const admin = await seedUser("system_admin", "admin-" + suffix + "@example.invalid", "ACTIVE", "Admin Strong Password #5!");
  const suspended = await seedUser("auditor", "suspended-" + suffix + "@example.invalid", "SUSPENDED", "Suspended Password #5!");
  const issuer = await seedUser("invoice_issuer", "issuer-" + suffix + "@example.invalid", "ACTIVE", "Issuer Strong Password #5!");
  const paymentRecorder = await seedUser("payment_recorder", "payments-" + suffix + "@example.invalid", "ACTIVE", "Payment Strong Password #5!");
  const approver = await seedUser("approver", "approver-" + suffix + "@example.invalid", "ACTIVE", "Approver Strong Password #5!");

  for (const path of ["/api/v1/customers", "/api/v1/catalog/items", "/api/v1/users"]) {
    const anonymous = await expectStatus(call(path), 401, "unauthenticated reads must be denied: " + path);
    assert.equal(anonymous.body.error.code, "UNAUTHENTICATED");
  }

  for (const path of ["/", "/customers"]) {
    const pageResponse = await fetch(new URL(path, baseUrl), { redirect: "manual", cache: "no-store" });
    assert.ok([307, 308].includes(pageResponse.status), `anonymous workspace page ${path} must redirect to sign-in`);
    const redirectTarget = pageResponse.headers.get("location");
    assert.ok(redirectTarget && new URL(redirectTarget, baseUrl).pathname === "/login", `anonymous workspace page ${path} redirects to /login`);
  }
  const forgedPayload = Buffer.from(JSON.stringify({
    userId: staff.userId, email: staff.email, permissions: ["users:manage", "customers:create", "customers:update"],
    legalEntityIds: ["all"], expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const forgedSignature = createHmac("sha256", sessionSecret).update(forgedPayload).digest("base64url");
  const forged = await call("/api/v1/users", { headers: { Cookie: "fx_session=" + forgedPayload + "." + forgedSignature } });
  assert.equal(forged.response.status, 401, "client-claimed signed permission payload without a database session must not authenticate");

  const staffSession = await login(staff);
  const noCsrf = await expectStatus(
    call("/api/v1/customers", { method: "POST", body: JSON.stringify({ name: "CSRF bypass attempt" }) }, staffSession.jar, { csrf: false }),
    403,
    "unsafe session-authenticated request without CSRF token must be denied",
  );
  assert.equal(noCsrf.body.error.code, "CSRF_INVALID");
  const wrongOrigin = await expectStatus(
    call("/api/v1/customers", {
      method: "POST",
      headers: { Origin: "https://untrusted.example", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ name: "Cross-origin CSRF attempt" }),
    }, staffSession.jar),
    403,
    "cross-origin unsafe request must be denied",
  );
  assert.equal(wrongOrigin.body.error.code, "CSRF_INVALID");
  const wrongCsrf = await expectStatus(
    call("/api/v1/customers", {
      method: "POST",
      headers: { "X-CSRF-Token": "wrong-token-value" },
      body: JSON.stringify({ name: "Invalid CSRF token attempt" }),
    }, staffSession.jar),
    403,
    "wrong CSRF token must be denied",
  );
  assert.equal(wrongCsrf.body.error.code, "CSRF_INVALID");

  const customerName = "Phase 05 Auth Test Customer " + suffix;
  const created = await call("/api/v1/customers", {
    method: "POST", body: JSON.stringify({ name: customerName, email: "customer-" + suffix + "@example.invalid" }),
  }, staffSession.jar);
  assert.equal(created.response.status, 201, "authorized staff role can create a customer");
  assert.equal(created.body.data.name, customerName);
  const list = await call("/api/v1/customers?query=" + encodeURIComponent(customerName) + "&status=all&limit=25&offset=0", {}, staffSession.jar);
  assert.equal(list.response.status, 200);
  assertPage(list.body, 25);
  assert.ok(list.body.data.some((row) => row.id === created.body.data.id));
  assert.equal("billing_address_json" in list.body.data[0], false);

  // Phase 6A: identity, sensitive billing details, mappings and historical integrity.
  const phase6aFinance = await seedUser("finance_admin", "phase6a-finance-" + suffix + "@example.invalid", "ACTIVE",
    "Phase 6A Finance Password #5!", [testLegalEntityId]);
  const phase6aSession = await login(phase6aFinance);
  const accountNumber = "1234567890123456";
  async function createPhase6aEntity(label, bankDetails = undefined) {
    const body = {
      legalName: "Phase 6A Legal Entity " + label + " " + suffix,
      displayName: "Phase 6A Entity " + label + " " + suffix,
      registrationNumber: "CI-REG-" + label + "-" + suffix,
      taxIdentifier: "",
      address: { line1: "10 Example Road", city: "Pune", state: "Maharashtra", postalCode: "411001", countryCode: "IN" },
      billingAddress: { line1: "Finance Office", city: "Pune", state: "Maharashtra", postalCode: "411002", countryCode: "IN" },
      countryCode: "IN", currency: "INR", invoiceEmail: "billing-" + label.toLowerCase() + "-" + suffix + "@example.invalid",
      invoicePhone: "+91-2000000000", website: "https://example.invalid", locale: "en-IN", timeZone: "Asia/Kolkata",
      logoReference: "asset://phase6a/" + label.toLowerCase(), invoiceTerms: "CI only — payment terms are a test fixture.",
      invoiceFooter: "CI fixture footer", defaultTaxCode: "", taxSetupStatus: "UNCONFIGURED",
      changeReason: "Phase 6A automated acceptance fixture", ...(bankDetails ? { bankDetails } : {}),
    };
    const result = await call("/api/v1/legal-entities", { method: "POST", body: JSON.stringify(body) }, phase6aSession.jar);
    assert.equal(result.response.status, 201, "finance administrator creates Phase 6A legal entity: " + JSON.stringify(result.body?.error ?? null));
    assert.ok(result.body.data.id);
    assert.deepEqual(result.body.data.billingAddress, body.billingAddress, "billing address is persisted separately from registered address");
    return result;
  }
  const entityAResult = await createPhase6aEntity("A", {
    accountName: "CI Only Account", bankName: "Example Test Bank", accountNumber,
    ifsc: "TEST0000123", swift: "TESTINBB",
  });
  const entityBResult = await createPhase6aEntity("B");
  const entityA = entityAResult.body.data;
  const entityB = entityBResult.body.data;

  // Pack 4 Part A: prove that no issuance occurs while any required company/issuer decision is pending.
  const p4PendingDecisions = await call("/api/v1/policy-decisions", {}, phase6aSession.jar);
  assert.equal(p4PendingDecisions.response.status, 200, "finance approvers can inspect the scoped policy-decision register");
  assert.ok(p4PendingDecisions.body.data.some(row => row.decisionKey === "D-09" && row.status === "PENDING" && row.legalEntityId === null),
    "global correction policy must begin pending");
  assert.ok(p4PendingDecisions.body.data.some(row => row.decisionKey === "D-11" && row.status === "PENDING" && row.legalEntityId === entityA.id),
    "new legal entity must receive a pending issuer-specific statutory decision");
  const p4BlockedInvoiceId = randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'INR',0,0,0,0)",
    [p4BlockedInvoiceId, entityA.id, created.body.data.id],
  );
  const p4BlockedIssue = await call("/api/v1/invoices/" + p4BlockedInvoiceId + "/issue", {
    method: "POST", headers: { "Idempotency-Key": "p4-policy-pending-" + suffix.toLowerCase() },
    body: JSON.stringify({ documentDate: new Date().toISOString().slice(0,10) }),
  }, phase6aSession.jar);
  assert.equal(p4BlockedIssue.response.status, 409, "issuance must be blocked while required policy decisions are pending");
  assert.equal(p4BlockedIssue.body.error.code, "POLICY_APPROVAL_REQUIRED");
  assert.ok(p4BlockedIssue.body.error.details.unresolvedDecisions.length >= 11);
  const [p4BlockedInvoiceRows] = await db.execute("SELECT lifecycle_status,invoice_number FROM invoices WHERE id=?", [p4BlockedInvoiceId]);
  assert.equal(p4BlockedInvoiceRows[0].lifecycle_status, "DRAFT");
  assert.equal(p4BlockedInvoiceRows[0].invoice_number, null);
  const [p4BlockedSnapshots] = await db.execute("SELECT id FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?", [p4BlockedInvoiceId]);
  assert.equal(p4BlockedSnapshots.length, 0, "pending policy must block issuance before number reservation and snapshot capture");
  const p4MissingEvidence = await call("/api/v1/policy-decisions/D-09", {
    method: "PATCH", body: JSON.stringify({ status:"APPROVED", decisionCode:"CANCEL_UNPAID_ONLY", rationale:"CI test with missing approver evidence." }),
  }, phase6aSession.jar);
  assert.equal(p4MissingEvidence.response.status, 422, "policy approval requires external approver and evidence");
  assert.equal(p4MissingEvidence.body.error.code, "APPROVAL_EVIDENCE_REQUIRED");
  const p4MissingEntityScope = await call("/api/v1/policy-decisions/D-02", {
    method:"PATCH", body: JSON.stringify({ status:"APPROVED", decisionText:"Disposable CI decision only.", rationale:"Disposable CI test, not company approval.", externalApproverName:"CI fixture NOT REAL", externalApproverRole:"CI fixture only", approvalReference:"CI-NOT-REAL-"+suffix, approvalDate:new Date().toISOString().slice(0,10) }),
  }, phase6aSession.jar);
  assert.equal(p4MissingEntityScope.response.status, 422, "entity-specific decisions must not be resolved globally");
  const p4StatutoryApprovalAttempt = await call("/api/v1/policy-decisions/D-11", {
    method:"PATCH",
    body:JSON.stringify({legalEntityId:entityA.id,status:"APPROVED",decisionCode:"CI_TEST_FIXTURE",decisionText:"Disposable CI fixture only; not a real company approval.",rationale:"Disposable CI database fixture only; this is not company approval.",externalApproverName:"CI fixture approver (NOT REAL)",externalApproverRole:"Disposable automated-test fixture",approvalReference:"CI-NOT-REAL-D11-"+suffix,approvalDate:new Date().toISOString().slice(0,10)}),
  }, phase6aSession.jar);
  assert.equal(p4StatutoryApprovalAttempt.response.status,409,"statutory applicability cannot be approved as implemented while submission integration is absent");
  assert.equal(p4StatutoryApprovalAttempt.body.error.code,"STATUTORY_INTEGRATION_NOT_IMPLEMENTED");
  const p4CorrectionModeRequired = await call("/api/v1/policy-decisions/D-09", {
    method:"PATCH", body: JSON.stringify({ status:"APPROVED", decisionText:"Disposable CI decision only.", rationale:"Disposable CI test, not company approval.", externalApproverName:"CI fixture NOT REAL", externalApproverRole:"CI fixture only", approvalReference:"CI-NOT-REAL-MODE-"+suffix, approvalDate:new Date().toISOString().slice(0,10) }),
  }, phase6aSession.jar);
  assert.equal(p4CorrectionModeRequired.response.status, 422, "correction decision requires an explicit treatment mode");
  assert.equal(p4CorrectionModeRequired.body.error.code, "CORRECTION_MODE_REQUIRED");

  // The following records are synthetic approvals only in disposable falchion_ci; never company sign-off.
  const p4FixtureDate = new Date().toISOString().slice(0,10);
  async function approveP4Decision(decisionKey, legalEntityId = null, status = "APPROVED") {
    const payload = {
      ...(legalEntityId ? { legalEntityId } : {}),
      status,
      decisionCode: decisionKey === "D-09" ? "CANCEL_UNPAID_ONLY" : status === "NOT_APPLICABLE" ? "CI_TEST_NOT_APPLICABLE" : "CI_TEST_FIXTURE",
      decisionText: "Disposable CI fixture outcome only; not a real company approval.",
      rationale: "Disposable CI database fixture only; this is not company approval.",
      externalApproverName: "CI fixture approver (NOT REAL)",
      externalApproverRole: "Disposable automated-test fixture",
      approvalReference: "CI-NOT-REAL-APPROVAL-" + suffix + "-" + decisionKey + (legalEntityId ? "-ENTITY" : "-GLOBAL"),
      approvalDate: p4FixtureDate,
    };
    const result = await call("/api/v1/policy-decisions/" + decisionKey, { method:"PATCH", body:JSON.stringify(payload) }, phase6aSession.jar);
    assert.equal(result.response.status, 200, "disposable CI resolves " + decisionKey + ": " + JSON.stringify(result.body?.error ?? null));
    assert.equal(result.body.data.status, status);
  }
  for (const key of ["D-01","D-05","D-08","D-10"]) await approveP4Decision(key);
  await approveP4Decision("D-09");
  const p4EntityDecisionKeys = ["D-02","D-03","D-04","D-06","D-07"];
  for (const entityId of [testLegalEntityId,entityA.id,entityB.id]) {
    for (const key of p4EntityDecisionKeys) await approveP4Decision(key,entityId);
    await approveP4Decision("D-11",entityId,"NOT_APPLICABLE");
  }
  const p4ResolvedDecisions = await call("/api/v1/policy-decisions", {}, phase6aSession.jar);
  assert.equal(p4ResolvedDecisions.response.status, 200);
  const p4GlobalCorrectionDecision = p4ResolvedDecisions.body.data.find(row=>row.decisionKey==="D-09"&&row.legalEntityId===null);
  assert.ok(p4GlobalCorrectionDecision && p4GlobalCorrectionDecision.history.length>=1,"policy GET returns the append-only decision event history");
  assert.equal(p4GlobalCorrectionDecision.history.at(-1).approvalReference?.startsWith("CI-NOT-REAL-APPROVAL-")??false,true,"decision history preserves the evidence reference supplied by the approver workflow");
  for (const key of ["D-01","D-02","D-03","D-04","D-05","D-06","D-07","D-08","D-09","D-10","D-11"]) {
    assert.ok(p4ResolvedDecisions.body.data.some(row => row.decisionKey===key && (row.status==="APPROVED"||row.status==="NOT_APPLICABLE") && (row.legalEntityId===null||row.legalEntityId===entityA.id)),
      "synthetic fixture should resolve required decision " + key + " for entity A");
  }
  const [p4DecisionHistory] = await db.execute(
    "SELECT COUNT(*) AS n FROM business_policy_decision_events",
  );
  assert.ok(Number(p4DecisionHistory[0].n) >= 17, "each synthetic approval outcome must retain a decision history event");
  console.log("PASS: Pack 4 policy register begins pending, blocks issuance before numbering/snapshots, requires evidence and issuer scope, and permits explicitly recorded disposable test decisions.");

  assert.equal(entityA.bankAccountLast4, "3456");
  assert.equal(entityA.bankDetailsConfigured, true);
  assert.equal("bankDetails" in entityA, false, "ordinary API responses must never return full bank details");
  assert.equal(JSON.stringify(entityAResult.body).includes(accountNumber), false, "legal-entity create response must mask the complete bank account number");

  const entityAudit = await db.execute(
    "SELECT change_reason,before_json,after_json FROM audit_events WHERE entity_type='legal_entity' AND entity_id=? ORDER BY created_at DESC LIMIT 1",
    [entityA.id],
  );
  assert.equal(entityAudit[0].length, 1);
  assert.equal(entityAudit[0][0].change_reason, "Phase 6A automated acceptance fixture");
  const auditAfter = typeof entityAudit[0][0].after_json === "string" ? JSON.parse(entityAudit[0][0].after_json) : entityAudit[0][0].after_json;
  assert.equal(auditAfter.bankAccountLast4, "3456");
  assert.equal(JSON.stringify(auditAfter).includes(accountNumber), false, "audit before/after JSON must not expose full bank account numbers");

  const entityUpdate = await call("/api/v1/legal-entities/" + entityA.id, {
    method: "PATCH",
    body: JSON.stringify({ invoiceFooter: "Updated CI-only footer", changeReason: "Phase 6A version history acceptance update" }),
  }, phase6aSession.jar);
  assert.equal(entityUpdate.response.status, 200, "legal entity update must create a new version");
  assert.equal(entityUpdate.body.data.invoiceFooter, "Updated CI-only footer");
  const entityDetail = await call("/api/v1/legal-entities/" + entityA.id, {}, phase6aSession.jar);
  assert.equal(entityDetail.response.status, 200);
  assert.ok(entityDetail.body.data.versions.length >= 2, "each legal entity edit must preserve version metadata");
  assert.equal(JSON.stringify(entityDetail.body).includes(accountNumber), false, "legal entity detail and version metadata must not expose bank account numbers");

  const nonFinanceEntityOperator = await seedUser("system_admin", "phase6a-operator-" + suffix + "@example.invalid", "ACTIVE",
    "Phase 6A Operator Password #5!", [entityA.id]);
  const operatorSession = await login(nonFinanceEntityOperator);
  const forbiddenBankUpdate = await call("/api/v1/legal-entities/" + entityA.id, {
    method: "PATCH",
    body: JSON.stringify({ bankDetails: { accountName: "CI Only Account", bankName: "Example Test Bank", accountNumber: "1111222233334444" },
      changeReason: "Attempted bank change by non-finance administrator" }),
  }, operatorSession.jar);
  assert.equal(forbiddenBankUpdate.response.status, 200, "Super Administrator can approve sensitive finance configuration across its entity scope");
  assert.equal(JSON.stringify(forbiddenBankUpdate.body).includes("1111222233334444"), false, "bank account number must never be returned in API responses");

  const brandCode = "P6A-" + suffix.toUpperCase();
  const brandCreated = await call("/api/v1/brands", {
    method: "POST",
    body: JSON.stringify({ name: "Phase 6A Test Brand " + suffix, code: brandCode,
      description: "CI-only commercial brand", logoReference: "asset://phase6a/brand",
      theme: { accentColor: "#DCAF51", presentationStyle: "STANDARD" }, defaultTemplateKey: "STANDARD",
      legalEntityIds: [entityA.id], changeReason: "Phase 6A brand creation fixture" }),
  }, phase6aSession.jar);
  assert.equal(brandCreated.response.status, 201, "brand creation with explicit entity mapping should succeed: " + JSON.stringify(brandCreated.body?.error ?? null));
  const invalidBrandAccent = await call("/api/v1/brands", {
    method: "POST",
    body: JSON.stringify({ name: "Invalid Accent Brand " + suffix, code: "BADACC-" + suffix.toUpperCase(),
      theme: { accentColor: "#123456" }, legalEntityIds: [entityA.id], changeReason: "Reject an accent outside the approved palette" }),
  }, phase6aSession.jar);
  assert.equal(invalidBrandAccent.response.status, 422, "brand creation must reject unapproved brand-guide accent colours");
  const brandId = brandCreated.body.data.id;
  const brandMoved = await call("/api/v1/brands/" + brandId, {
    method: "PATCH",
    body: JSON.stringify({ legalEntityIds: [entityB.id], changeReason: "Phase 6A brand mapping history acceptance update" }),
  }, phase6aSession.jar);
  assert.equal(brandMoved.response.status, 200, "brand mapping can be explicitly changed");
  assert.deepEqual(brandMoved.body.data.legalEntityIds, [entityB.id]);
  const [brandLinks] = await db.execute(
    "SELECT legal_entity_id,effective_from,effective_until,is_default FROM brand_legal_entities WHERE brand_id=? ORDER BY effective_from",
    [brandId],
  );
  assert.equal(brandLinks.length, 2, "old brand mapping row is retained rather than deleted");
  assert.ok(brandLinks.find((row) => row.legal_entity_id === entityA.id)?.effective_until, "removed brand mapping has an effective end");
  assert.equal(brandLinks.find((row) => row.legal_entity_id === entityB.id)?.effective_until ?? null, null, "new mapping is active");
  const [brandVersions] = await db.execute("SELECT COUNT(*) AS n FROM brand_config_versions WHERE brand_id=?", [brandId]);
  assert.equal(Number(brandVersions[0].n), 2, "brand updates append a configuration version");

  // Phase 6B: incomplete entity configuration must block issuance without allocating a number.
  const [issueCustomerRows] = await db.execute(
    "SELECT id FROM customers WHERE id=? AND is_active=TRUE LIMIT 1",
    [created.body.data.id],
  );
  assert.equal(issueCustomerRows.length,1,"issuance test uses an active CI customer");
  const incompleteInvoiceId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'INR',100.0000,0,0,100.0000)",
    [incompleteInvoiceId,testLegalEntityId,created.body.data.id],
  );
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,1,'CI issue gate line',1.0000,100.0000,0,0,NULL,NULL,NULL,0,100.0000)",
    [randomUUID(),incompleteInvoiceId],
  );
  const blockedIncompleteIssue=await call("/api/v1/invoices/"+incompleteInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":"ci-incomplete-"+suffix.toLowerCase()+"-001"},
    body:JSON.stringify({documentDate:new Date().toISOString().slice(0,10)}),
  },phase6aSession.jar);
  assert.equal(blockedIncompleteIssue.response.status,409,"unconfigured tax setup blocks issuance");
  assert.equal(blockedIncompleteIssue.body.error.code,"CONFIGURATION_NOT_READY");

  // Complete positive Phase 6B path: approved setup -> issue -> immutable snapshot -> safe idempotent replay.
  const phase6bSuffix=suffix.toUpperCase();
  const phase6bTaxCode="P6B_STD_"+phase6bSuffix;
  const approvalUpdate=await call("/api/v1/legal-entities/"+entityA.id,{
    method:"PATCH",
    body:JSON.stringify({taxSetupStatus:"APPROVED_CONFIGURED",
      taxSetupApprovalReference:"CI-ENTITY-APPROVAL-"+phase6bSuffix,defaultTaxCode:phase6bTaxCode,
      changeReason:"Phase 6B API issuance fixture: approve synthetic tax configuration"}),
  },phase6aSession.jar);
  assert.equal(approvalUpdate.response.status,200,"finance administrator can set a test-only approved tax decision: "+JSON.stringify(approvalUpdate.body?.error??null));
  assert.equal(approvalUpdate.body.data.taxSetupStatus,"APPROVED_CONFIGURED");

  const regResult=await call("/api/v1/legal-entities/"+entityA.id+"/tax-registrations",{
    method:"POST",
    body:JSON.stringify({registrationKey:"P6B_REG_"+phase6bSuffix,registrationType:"OTHER",
      jurisdiction:"CI-JURISDICTION",registrationNumber:"CI-REG-NUM-"+phase6bSuffix,
      displayLabel:"Synthetic CI registration",isPrimary:true,effectiveFrom:"2020-01-01",effectiveUntil:"",
      approvalReference:"CI-REG-APPROVAL-"+phase6bSuffix,changeReason:"Phase 6B synthetic registration fixture"}),
  },phase6aSession.jar);
  assert.equal(regResult.response.status,201,"approved test registration can be created: "+JSON.stringify(regResult.body?.error??null));
  const phase6bRegistrationId=regResult.body.data.id;
  const phase6bRegistrationKey="P6B_REG_"+phase6bSuffix;

  // Regression test: mysql2 may decode DATE columns into JavaScript Date objects.
  // A second version must close an open-ended prior version at the day before the new start.
  const [registrationRevisionDates]=await db.execute(
    "SELECT DATE_FORMAT(CURRENT_DATE(),'%Y-%m-%d') AS today, DATE_FORMAT(DATE_ADD(CURRENT_DATE(),INTERVAL 1 DAY),'%Y-%m-%d') AS nextDay",
  );
  const registrationRevision=await call("/api/v1/legal-entities/"+entityA.id+"/tax-registrations",{
    method:"POST",
    body:JSON.stringify({registrationKey:phase6bRegistrationKey,registrationType:"OTHER",
      jurisdiction:"CI-JURISDICTION",registrationNumber:"CI-REG-REVISION-"+phase6bSuffix,
      displayLabel:"Synthetic next-day registration revision",isPrimary:true,effectiveFrom:registrationRevisionDates[0].nextDay,effectiveUntil:"",
      approvalReference:"CI-REG-REVISION-APPROVAL-"+phase6bSuffix,changeReason:"Phase 6B regression: open-ended registration revision"}),
  },phase6aSession.jar);
  assert.equal(registrationRevision.response.status,201,"registration revision must compare MySQL DATE values correctly: "+JSON.stringify(registrationRevision.body?.error??null));
  assert.equal(registrationRevision.body.data.versionNumber,2,"registration version number increments");
  const [registrationHistory]=await db.execute(
    "SELECT version_number,DATE_FORMAT(effective_from,'%Y-%m-%d') AS effective_from_date,DATE_FORMAT(effective_until,'%Y-%m-%d') AS effective_until_date FROM legal_entity_tax_registrations WHERE legal_entity_id=? AND registration_key=? ORDER BY version_number",
    [entityA.id,phase6bRegistrationKey],
  );
  assert.equal(registrationHistory.length,2,"both tax registration versions must be preserved");
  assert.equal(registrationHistory[0].effective_from_date,"2020-01-01");
  assert.equal(registrationHistory[0].effective_until_date,registrationRevisionDates[0].today,
    "previous version ends on the calendar day before the new version starts");
  assert.equal(registrationHistory[1].effective_from_date,registrationRevisionDates[0].nextDay);
  assert.equal(registrationHistory[1].effective_until_date,null,"new version remains open-ended");
  console.log("PASS: tax registration version dates preserve the old effective period and create the next version.");

  // One primary registration per type and jurisdiction is allowed; two primaries for the
  // same type and jurisdiction may not have overlapping effective periods.
  const otherJurisdictionPrimary=await call("/api/v1/legal-entities/"+entityA.id+"/tax-registrations",{
    method:"POST",
    body:JSON.stringify({registrationKey:"P6B_OTHER_PRIMARY_"+phase6bSuffix,registrationType:"OTHER",
      jurisdiction:"CI-OTHER-JURISDICTION",registrationNumber:"CI-OTHER-PRIMARY-"+phase6bSuffix,
      displayLabel:"Synthetic primary registration in a second jurisdiction",isPrimary:true,effectiveFrom:"2020-01-01",effectiveUntil:"",
      approvalReference:"CI-OTHER-PRIMARY-APPROVAL-"+phase6bSuffix,changeReason:"Phase 6B primary registration jurisdiction isolation"}),
  },phase6aSession.jar);
  assert.equal(otherJurisdictionPrimary.response.status,201,
    "a primary registration for the same type in another jurisdiction must be allowed: "+JSON.stringify(otherJurisdictionPrimary.body?.error??null));
  const duplicatePrimary=await call("/api/v1/legal-entities/"+entityA.id+"/tax-registrations",{
    method:"POST",
    body:JSON.stringify({registrationKey:"P6B_DUP_PRIMARY_"+phase6bSuffix,registrationType:"OTHER",
      jurisdiction:"CI-JURISDICTION",registrationNumber:"CI-DUP-PRIMARY-"+phase6bSuffix,
      displayLabel:"Synthetic overlapping primary registration",isPrimary:true,effectiveFrom:"2020-01-01",effectiveUntil:"",
      approvalReference:"CI-DUP-PRIMARY-APPROVAL-"+phase6bSuffix,changeReason:"Phase 6B reject duplicate primary registration"}),
  },phase6aSession.jar);
  assert.equal(duplicatePrimary.response.status,409,"overlapping primary registrations in the same jurisdiction must be rejected");
  assert.equal(duplicatePrimary.body.error.code,"CONFIGURATION_CONFLICT");
  console.log("PASS: primary tax registration uniqueness is scoped by registration type and jurisdiction.");

  const taxRuleResult=await call("/api/v1/tax-rules",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,taxCode:phase6bTaxCode,displayName:"Synthetic CI tax rule",
      jurisdiction:"CI-JURISDICTION",ratePercent:"18",calculationMode:"EXCLUSIVE",effectiveFrom:"2020-01-01",
      effectiveUntil:"",approvalReference:"CI-TAX-APPROVAL-"+phase6bSuffix,
      changeReason:"Phase 6B synthetic approved tax-rule fixture"}),
  },phase6aSession.jar);
  assert.equal(taxRuleResult.response.status,201,"approved test tax rule can be created: "+JSON.stringify(taxRuleResult.body?.error??null));
  const phase6bTaxRuleId=taxRuleResult.body.data.id;

  // Phase 8: server-calculated invoice totals, tax modes, extra charges, due dates and idempotency.
  const overLimitTaxRule=await call("/api/v1/tax-rules",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,taxCode:"P8_BAD_RATE_"+phase6bSuffix,displayName:"Invalid out-of-range rate",
      jurisdiction:"CI-JURISDICTION",ratePercent:"100.000001",calculationMode:"EXCLUSIVE",effectiveFrom:"2020-01-01",
      effectiveUntil:"",approvalReference:"CI-P8-BAD-RATE-"+phase6bSuffix,
      changeReason:"Phase 8 validation: reject tax rates above the approved maximum"}),
  },phase6aSession.jar);
  assert.equal(overLimitTaxRule.response.status,422,"tax-rule rates above 100 percentage points must be rejected");
  const [[phase8Dates]] = await db.execute(
    "SELECT DATE_FORMAT(CURRENT_DATE(),'%Y-%m-%d') AS today",
  );
  const phase8InvoiceDate=phase8Dates.today;
  const phase8DueDateObj=new Date(phase8InvoiceDate+"T00:00:00.000Z");
  phase8DueDateObj.setUTCDate(phase8DueDateObj.getUTCDate()+30);
  const phase8ExpectedDueDate=phase8DueDateObj.toISOString().slice(0,10);
  const phase8Line={description:"Phase 8 precision-tested consulting",unitCode:"hour",quantity:"2.0000",unitPrice:"100.0000",
    discountType:"PERCENT",discountValue:"10.0000",taxCode:phase6bTaxCode};
  const phase8Charge={lineKind:"CHARGE",description:"Phase 8 delivery charge",unitCode:"service",quantity:"1.0000",
    unitPrice:"20.0000",discountType:"AMOUNT",discountValue:"0.0000",taxCode:phase6bTaxCode};
  const phase8DraftBody={legalEntityId:entityA.id,customerId:created.body.data.id,currency:"INR",
    invoiceDate:phase8InvoiceDate,dueDate:null,paymentTermsDays:30,notes:"Phase 8 automated calculation fixture",
    lines:[phase8Line,phase8Charge]};
  const phase8IdempotencyKey="p8-create-"+phase6bSuffix.toLowerCase()+"-001";
  const phase8Draft=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":phase8IdempotencyKey},body:JSON.stringify(phase8DraftBody),
  },phase6aSession.jar);
  assert.equal(phase8Draft.response.status,201,"an authorized request creates a draft and calculates totals server-side: "+JSON.stringify(phase8Draft.body?.error??null));
  assert.equal(phase8Draft.body.data.lifecycleStatus,"DRAFT");
  assert.equal(phase8Draft.body.data.recordVersion,1);
  assert.equal(phase8Draft.body.data.subtotal,"220.0000","subtotal aggregates net-of-tax bases before discount");
  assert.equal(phase8Draft.body.data.discountTotal,"20.0000","percentage discount is calculated exactly");
  assert.equal(phase8Draft.body.data.taxableValue,"200.0000","taxable value equals subtotal minus discount");
  assert.equal(phase8Draft.body.data.taxTotal,"36.0000","tax total uses the approved 18 percent rule on the post-discount base");
  assert.equal(phase8Draft.body.data.grandTotal,"236.0000","server total includes the separately identified charge line");
  assert.equal(phase8Draft.body.data.dueDate,phase8ExpectedDueDate,"blank due date defaults from invoice date and payment terms");
  assert.equal(phase8Draft.body.data.lines[1].lineKind,"CHARGE");
  assert.equal(phase8Draft.body.data.lines[0].taxCalculationMode,"EXCLUSIVE");

  const phase8InclusiveTaxCode="P8_INCL_"+phase6bSuffix;
  const phase8InclusiveRule=await call("/api/v1/tax-rules",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,taxCode:phase8InclusiveTaxCode,displayName:"Phase 8 inclusive-price fixture",
      jurisdiction:"CI-JURISDICTION",ratePercent:"18",calculationMode:"INCLUSIVE",effectiveFrom:"2020-01-01",
      effectiveUntil:"",approvalReference:"CI-P8-INCLUSIVE-"+phase6bSuffix,
      changeReason:"Phase 8 automated inclusive-tax calculation fixture"}),
  },phase6aSession.jar);
  assert.equal(phase8InclusiveRule.response.status,201,"approved tax-inclusive rule can be configured for the integration fixture");
  const phase8InclusiveKey="p8-inclusive-"+phase6bSuffix.toLowerCase()+"-01";
  const phase8InclusiveDraft=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":phase8InclusiveKey},
    body:JSON.stringify({...phase8DraftBody,notes:"Inclusive tax calculation fixture",lines:[{description:"Tax-inclusive item",unitCode:"unit",quantity:"1.0000",unitPrice:"118.0000",discountType:"AMOUNT",discountValue:"0.0000",taxCode:phase8InclusiveTaxCode}]}),
  },phase6aSession.jar);
  assert.equal(phase8InclusiveDraft.response.status,201,"invoice engine applies tax-inclusive treatment from the approved rule");
  assert.equal(phase8InclusiveDraft.body.data.lines[0].taxCalculationMode,"INCLUSIVE");
  assert.equal(phase8InclusiveDraft.body.data.subtotal,"100.0000");
  assert.equal(phase8InclusiveDraft.body.data.taxableValue,"100.0000");
  assert.equal(phase8InclusiveDraft.body.data.taxTotal,"18.0000");
  assert.equal(phase8InclusiveDraft.body.data.grandTotal,"118.0000");

  const phase8Replay=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":phase8IdempotencyKey},body:JSON.stringify(phase8DraftBody),
  },phase6aSession.jar);
  assert.equal(phase8Replay.response.status,200,"identical duplicate submissions return an idempotent replay");
  assert.equal(phase8Replay.body.data.id,phase8Draft.body.data.id);
  assert.equal(phase8Replay.body.data.idempotentReplay,true);
  const phase8KeyConflict=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":phase8IdempotencyKey},
    body:JSON.stringify({...phase8DraftBody,lines:[{...phase8Line,quantity:"3.0000"},phase8Charge]}),
  },phase6aSession.jar);
  assert.equal(phase8KeyConflict.response.status,409,"reusing a submission key with a different payload is rejected");
  assert.equal(phase8KeyConflict.body.error.code,"DUPLICATE_SUBMISSION");

  const phase8ConcurrentKey="p8-race-"+phase6bSuffix.toLowerCase()+"-001";
  const phase8ConcurrentBody={...phase8DraftBody,notes:"Concurrent duplicate create fixture",lines:[phase8Line,phase8Charge]};
  const concurrentSubmissions=await Promise.all([
    call("/api/v1/invoices",{method:"POST",headers:{"Idempotency-Key":phase8ConcurrentKey},body:JSON.stringify(phase8ConcurrentBody)},phase6aSession.jar),
    call("/api/v1/invoices",{method:"POST",headers:{"Idempotency-Key":phase8ConcurrentKey},body:JSON.stringify(phase8ConcurrentBody)},phase6aSession.jar),
  ]);
  assert.deepEqual(concurrentSubmissions.map(result=>result.response.status).sort((a,b)=>a-b),[200,201],
    "concurrent identical submissions produce one create and one replay, not a server error");
  assert.equal(concurrentSubmissions[0].body.data.id,concurrentSubmissions[1].body.data.id);
  const [[concurrentKeyCount]]=await db.execute(
    "SELECT COUNT(*) AS total FROM invoices WHERE idempotency_key=?",[phase8ConcurrentKey],
  );
  assert.equal(Number(concurrentKeyCount.total),1,"one invoice is persisted when identical create requests race");

  const phase8Detail=await call("/api/v1/invoices/"+phase8Draft.body.data.id,{},phase6aSession.jar);
  assert.equal(phase8Detail.response.status,200);
  assert.equal(phase8Detail.body.data.grandTotal,"236.0000");
  assert.equal(phase8Detail.body.data.lines.length,2);
  const phase8Updated=await call("/api/v1/invoices/"+phase8Draft.body.data.id,{
    method:"PATCH",body:JSON.stringify({...phase8DraftBody,expectedVersion:1,lines:[{...phase8Line,unitPrice:"150.0000"},phase8Charge]}),
  },phase6aSession.jar);
  assert.equal(phase8Updated.response.status,200,"draft edits recalculate all line and document totals");
  assert.equal(phase8Updated.body.data.recordVersion,2);
  assert.equal(phase8Updated.body.data.subtotal,"320.0000");
  assert.equal(phase8Updated.body.data.discountTotal,"30.0000");
  assert.equal(phase8Updated.body.data.taxableValue,"290.0000");
  assert.equal(phase8Updated.body.data.taxTotal,"52.2000");
  assert.equal(phase8Updated.body.data.grandTotal,"342.2000");
  const phase8List=await call("/api/v1/invoices?status=DRAFT&legalEntityId="+entityA.id+"&customerId="+created.body.data.id+"&limit=100&offset=0",{},phase6aSession.jar);
  assert.equal(phase8List.response.status,200);
  const phase8ListRow=phase8List.body.data.find(row=>row.id===phase8Draft.body.data.id);
  assert.ok(phase8ListRow,"updated draft appears in the list for the caller's entity/customer filters");
  assert.equal(phase8ListRow.grandTotal,"342.2000","list totals match the server calculation returned by PATCH");
  assert.equal(phase8ListRow.outstandingBalance,"342.2000");
  const phase8Reloaded=await call("/api/v1/invoices/"+phase8Draft.body.data.id,{},phase6aSession.jar);
  assert.equal(phase8Reloaded.response.status,200);
  assert.equal(phase8Reloaded.body.data.grandTotal,phase8Updated.body.data.grandTotal,"GET detail and PATCH response remain calculation-consistent");

  const phase8Stale=await call("/api/v1/invoices/"+phase8Draft.body.data.id,{
    method:"PATCH",body:JSON.stringify({...phase8DraftBody,expectedVersion:1}),
  },phase6aSession.jar);
  assert.equal(phase8Stale.response.status,409,"optimistic concurrency prevents stale invoice draft updates");
  const phase8BadQuantity=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":"p8-negative-"+phase6bSuffix.toLowerCase()+"-01"},
    body:JSON.stringify({...phase8DraftBody,lines:[{...phase8Line,quantity:"-1.0000"}]}),
  },phase6aSession.jar);
  assert.equal(phase8BadQuantity.response.status,422,"negative invoice quantities are rejected");
  const phase8BadDueDateObj=new Date(phase8InvoiceDate+"T00:00:00.000Z");
  phase8BadDueDateObj.setUTCDate(phase8BadDueDateObj.getUTCDate()-1);
  const phase8BadDueDate=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":"p8-date-"+phase6bSuffix.toLowerCase()+"-01"},
    body:JSON.stringify({...phase8DraftBody,dueDate:phase8BadDueDateObj.toISOString().slice(0,10)}),
  },phase6aSession.jar);
  assert.equal(phase8BadDueDate.response.status,422,"due dates before invoice dates are rejected");
  const phase8ClientRateOverride=await call("/api/v1/invoices",{
    method:"POST",headers:{"Idempotency-Key":"p8-rate-"+phase6bSuffix.toLowerCase()+"-01"},
    body:JSON.stringify({...phase8DraftBody,lines:[{...phase8Line,taxRatePercent:"999.000000"}]}),
  },phase6aSession.jar);
  assert.equal(phase8ClientRateOverride.response.status,422,"clients cannot submit or override server-authoritative tax rates");
  const phase8Options=await call("/api/v1/invoices/draft-options",{},phase6aSession.jar);
  assert.equal(phase8Options.response.status,200,"invoice workspace options respect current finance and entity scope");
  assert.ok(phase8Options.body.data.legalEntities.some(e=>e.id===entityA.id));
  assert.ok(phase8Options.body.data.taxRules.some(r=>r.id===phase6bTaxRuleId));
  console.log("PASS: Phase 8 invoice API tests verify approved-rate server calculation, extra charges, due-date defaults/validation, four-place totals, idempotent replay/conflict, stale-version protection, strict rejection of client rates, and scoped UI options.");

  // Second jurisdiction fixture proves each invoice line's registration must match its rule.
  const otherRegResult=await call("/api/v1/legal-entities/"+entityA.id+"/tax-registrations",{
    method:"POST",
    body:JSON.stringify({registrationKey:"P6B_OTHER_REG_"+phase6bSuffix,registrationType:"OTHER",
      jurisdiction:"CI-OTHER-JURISDICTION",registrationNumber:"CI-OTHER-REG-NUM-"+phase6bSuffix,
      displayLabel:"Synthetic second-jurisdiction registration",isPrimary:false,effectiveFrom:"2020-01-01",effectiveUntil:"",
      approvalReference:"CI-OTHER-REG-APPROVAL-"+phase6bSuffix,changeReason:"Phase 6B mismatched-line registration fixture"}),
  },phase6aSession.jar);
  assert.equal(otherRegResult.response.status,201,"second-jurisdiction synthetic registration can be created: "+JSON.stringify(otherRegResult.body?.error??null));
  const phase6bOtherRegistrationId=otherRegResult.body.data.id;

  const otherTaxRuleResult=await call("/api/v1/tax-rules",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,taxCode:"P6B_ALT_"+phase6bSuffix,displayName:"Synthetic second-jurisdiction tax rule",
      jurisdiction:"CI-OTHER-JURISDICTION",ratePercent:"18",calculationMode:"EXCLUSIVE",effectiveFrom:"2020-01-01",
      effectiveUntil:"",approvalReference:"CI-OTHER-TAX-APPROVAL-"+phase6bSuffix,
      changeReason:"Phase 6B mismatched-line tax-rule fixture"}),
  },phase6aSession.jar);
  assert.equal(otherTaxRuleResult.response.status,201,"second-jurisdiction synthetic tax rule can be created: "+JSON.stringify(otherTaxRuleResult.body?.error??null));
  const phase6bOtherTaxRuleId=otherTaxRuleResult.body.data.id;
  const phase6bOtherTaxCode=otherTaxRuleResult.body.data.taxCode;

  const numberingResult=await call("/api/v1/numbering-configs",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,documentType:"INVOICE",seriesCode:"P6B_"+phase6bSuffix,
      prefix:"P6B-"+phase6bSuffix+"-",suffix:"",sequenceWidth:5,includeFinancialYear:true,
      financialYearStartMonth:4,financialYearStartDay:1,timeZone:"Asia/Kolkata",
      effectiveFrom:"2020-01-01",effectiveUntil:"",approvalReference:"CI-NUMBER-APPROVAL-"+phase6bSuffix,
      activate:true,changeReason:"Phase 6B synthetic approved invoice series"}),
  },phase6aSession.jar);
  assert.equal(numberingResult.response.status,201,"finance-approved test numbering series can be activated: "+JSON.stringify(numberingResult.body?.error??null));
  const phase6bNumberingId=numberingResult.body.data.id;

  const templateConfig={pageSize:"A4",orientation:"PORTRAIT",layout:"STANDARD",accentColor:"#931314",
    showLogo:true,showTaxBreakdown:true,showBankDetails:false,showPaymentTerms:true,
    showCustomerTaxIdentifier:false,showFooter:true,footerText:"Synthetic Phase 6B CI template"};
  const templateResult=await call("/api/v1/document-templates",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,documentType:"INVOICE",templateKey:"P6B_DEFAULT",
      displayName:"Synthetic CI invoice template",templateConfig,effectiveFrom:"2020-01-01",
      effectiveUntil:"",activate:true,changeReason:"Phase 6B synthetic invoice template"}),
  },phase6aSession.jar);
  assert.equal(templateResult.response.status,201,"test invoice template can be activated: "+JSON.stringify(templateResult.body?.error??null));
  const phase6bTemplateId=templateResult.body.data.templateId;

  const quotationNumberingResult=await call("/api/v1/numbering-configs",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,documentType:"QUOTATION",seriesCode:"P6B_Q_"+phase6bSuffix,
      prefix:"P6B-Q-"+phase6bSuffix+"-",suffix:"",sequenceWidth:5,includeFinancialYear:true,
      financialYearStartMonth:4,financialYearStartDay:1,timeZone:"Asia/Kolkata",
      effectiveFrom:"2020-01-01",effectiveUntil:"",approvalReference:"CI-Q-NUM-APPROVAL-"+phase6bSuffix,
      activate:true,changeReason:"Phase 6B synthetic approved quotation series"}),
  },phase6aSession.jar);
  assert.equal(quotationNumberingResult.response.status,201,
    "approved synthetic quotation number series can be activated: "+JSON.stringify(quotationNumberingResult.body?.error??null));
  const quotationTemplateResult=await call("/api/v1/document-templates",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,documentType:"QUOTATION",templateKey:"P6B_QUOTATION",
      displayName:"Synthetic CI quotation template",templateConfig,effectiveFrom:"2020-01-01",
      effectiveUntil:"",activate:true,changeReason:"Phase 6B synthetic quotation template"}),
  },phase6aSession.jar);
  assert.equal(quotationTemplateResult.response.status,201,
    "approved synthetic quotation template can be activated: "+JSON.stringify(quotationTemplateResult.body?.error??null));
  const phase6bQuotationTemplateId=quotationTemplateResult.body.data.templateId;

  const issueDate=new Date().toISOString().slice(0,10);
  const currencyMismatchInvoiceId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'USD',100.0000,0,18.0000,118.0000)",
    [currencyMismatchInvoiceId,entityA.id,created.body.data.id],
  );
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,1,'CI unsupported currency line',1.0000,100.0000,0,18.000000,?,?,?,18.0000,118.0000)",
    [randomUUID(),currencyMismatchInvoiceId,phase6bTaxCode,phase6bTaxRuleId,phase6bRegistrationId],
  );
  const blockedCurrencyIssue=await call("/api/v1/invoices/"+currencyMismatchInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":"p6b-currency-"+phase6bSuffix.toLowerCase()+"-001"},
    body:JSON.stringify({documentDate:issueDate}),
  },phase6aSession.jar);
  assert.equal(blockedCurrencyIssue.response.status,409,"unapproved multi-currency issuance must be blocked");
  assert.equal(blockedCurrencyIssue.body.error.code,"CONFIGURATION_NOT_READY");
  const [currencyMismatchRows]=await db.execute("SELECT lifecycle_status FROM invoices WHERE id=?",[currencyMismatchInvoiceId]);
  assert.equal(currencyMismatchRows[0].lifecycle_status,"DRAFT","currency mismatch must not issue the invoice");
  const [currencyMismatchSnapshots]=await db.execute("SELECT id FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",[currencyMismatchInvoiceId]);
  assert.equal(currencyMismatchSnapshots.length,0,"blocked currency mismatch must not capture an issue snapshot or allocate a document configuration");
  console.log("PASS: issuance blocks unsupported currency and leaves the draft unissued.");

  const issuedInvoiceId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'INR',999.0000,0,0.0000,999.0000)",
    [issuedInvoiceId,entityA.id,created.body.data.id],
  );
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,1,'CI taxable line',1.0000,100.0000,0,0.000000,?,?,?,0.0000,1.0000)",
    [randomUUID(),issuedInvoiceId,phase6bTaxCode,phase6bTaxRuleId,phase6bRegistrationId],
  );
  const issueKey="p6b-happy-"+phase6bSuffix.toLowerCase()+"-001";
  const concurrentIssueResults=await Promise.all([
    call("/api/v1/invoices/"+issuedInvoiceId+"/issue",{
      method:"POST",headers:{"Idempotency-Key":issueKey},body:JSON.stringify({documentDate:issueDate}),
    },phase6aSession.jar),
    call("/api/v1/invoices/"+issuedInvoiceId+"/issue",{
      method:"POST",headers:{"Idempotency-Key":issueKey},body:JSON.stringify({documentDate:issueDate}),
    },phase6aSession.jar),
  ]);
  assert.deepEqual(concurrentIssueResults.map(result=>result.response.status).sort((a,b)=>a-b),[200,200],
    "concurrent same-key issue requests both receive the committed result");
  assert.deepEqual(concurrentIssueResults.map(result=>result.body.data.idempotentReplay).sort(),[false,true],
    "exactly one concurrent issue request performs issuance and the other is a replay");
  const issueResult=concurrentIssueResults.find(result=>result.body?.data?.idempotentReplay===false);
  const concurrentIssueReplay=concurrentIssueResults.find(result=>result.body?.data?.idempotentReplay===true);
  assert.ok(issueResult&&concurrentIssueReplay,"concurrent issuance yields one original result and one replay");
  assert.equal(issueResult.response.status,200,"approved in-scope draft invoice issues successfully");
  assert.equal(issueResult.body.data.status,"ISSUED");
  assert.equal(issueResult.body.data.idempotentReplay,false);
  assert.equal(concurrentIssueReplay.body.data.invoiceNumber,issueResult.body.data.invoiceNumber,
    "concurrent issue requests observe the same allocated invoice number");
  assert.equal(concurrentIssueReplay.body.data.configurationSha256,issueResult.body.data.configurationSha256,
    "concurrent issue requests observe the same immutable configuration snapshot hash");
  assert.equal(issueResult.body.data.subtotal,"100.0000");
  assert.equal(issueResult.body.data.discountTotal,"0.0000");
  assert.equal(issueResult.body.data.taxableValue,"100.0000");
  assert.equal(issueResult.body.data.taxTotal,"18.0000");
  assert.equal(issueResult.body.data.grandTotal,"118.0000","issuance recalculates document totals instead of trusting stored totals");

  const issuedDetailBeforeCustomerRename = await call("/api/v1/invoices/" + issuedInvoiceId, {}, phase6aSession.jar);
  assert.equal(issuedDetailBeforeCustomerRename.response.status, 200);
  const [issueCustomerSnapshotRows] = await db.execute(
    "SELECT customer_snapshot FROM invoices WHERE id=?", [issuedInvoiceId],
  );
  assert.equal(issueCustomerSnapshotRows.length, 1);
  const issueCustomerSnapshot = typeof issueCustomerSnapshotRows[0].customer_snapshot === "string"
    ? JSON.parse(issueCustomerSnapshotRows[0].customer_snapshot)
    : issueCustomerSnapshotRows[0].customer_snapshot;
  const frozenCustomerName = String(issueCustomerSnapshot.name);
  assert.ok(frozenCustomerName.length > 0, "issuance stores the customer identity snapshot");
  assert.equal(issuedDetailBeforeCustomerRename.body.data.customerName, frozenCustomerName,
    "issued invoice detail uses the frozen customer snapshot");

  const [customerBeforeRenameRows] = await db.execute(
    "SELECT name FROM customers WHERE id=?", [created.body.data.id],
  );
  assert.equal(customerBeforeRenameRows.length, 1);
  const originalLiveCustomerName = String(customerBeforeRenameRows[0].name);
  try {
    await db.execute("UPDATE customers SET name=? WHERE id=?", [
      originalLiveCustomerName + " updated after issue", created.body.data.id,
    ]);
    const issuedDetailAfterCustomerRename = await call("/api/v1/invoices/" + issuedInvoiceId, {}, phase6aSession.jar);
    assert.equal(issuedDetailAfterCustomerRename.response.status, 200);
    assert.equal(issuedDetailAfterCustomerRename.body.data.customerName, frozenCustomerName,
      "renaming a customer cannot rewrite the identity shown for an issued invoice");
    const issuedInvoiceListAfterCustomerRename = await call(
      "/api/v1/invoices?status=ISSUED&legalEntityId=" + entityA.id + "&customerId=" + created.body.data.id + "&limit=100&offset=0",
      {}, phase6aSession.jar,
    );
    assert.equal(issuedInvoiceListAfterCustomerRename.response.status, 200);
    const issuedInvoiceListRow = issuedInvoiceListAfterCustomerRename.body.data.find(row => row.id === issuedInvoiceId);
    assert.ok(issuedInvoiceListRow, "issued invoice remains in the entity/customer filtered list");
    assert.equal(issuedInvoiceListRow.customerName, frozenCustomerName,
      "invoice list must also display the customer name frozen at issue time");
  } finally {
    await db.execute("UPDATE customers SET name=? WHERE id=?", [originalLiveCustomerName, created.body.data.id]);
  }
  console.log("PASS: issued invoice detail and list preserve the issue-time customer name after later customer master-data edits.");

  // Pack 0: exercise the payment-recording API, not just direct SQL fixtures.
  const phase8PaymentKey="phase8-payment-"+randomUUID();
  const phase8PaymentPayload={
    amount:"25.1234",paymentDate:issueDate,method:"bank transfer",
    reference:"CI-PAY-"+phase6bSuffix,notes:"Pack 0 payment API regression",
  };

  // Pack 3 negative invoice-payment contract cases.
  const missingPaymentKey=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",body:JSON.stringify(phase8PaymentPayload),
  },phase6aSession.jar);
  assert.equal(missingPaymentKey.response.status,400,"invoice payment requires an idempotency key");
  const badPaymentDateKey="p3-bad-date-"+randomUUID();
  const badPaymentDateReference="CI-P3-BAD-DATE-"+randomUUID();
  const badPaymentDate=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",headers:{"Idempotency-Key":badPaymentDateKey},
    body:JSON.stringify({...phase8PaymentPayload,paymentDate:"2026-02-30",reference:badPaymentDateReference}),
  },phase6aSession.jar);
  assert.equal(badPaymentDate.response.status,422,"impossible payment dates are rejected");
  const badPaymentMethodKey="p3-bad-method-"+randomUUID();
  const badPaymentMethodReference="CI-P3-BAD-METHOD-"+randomUUID();
  const badPaymentMethod=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",headers:{"Idempotency-Key":badPaymentMethodKey},
    body:JSON.stringify({...phase8PaymentPayload,method:"123BAD",reference:badPaymentMethodReference}),
  },phase6aSession.jar);
  assert.equal(badPaymentMethod.response.status,422,"invalid payment method labels are rejected");
  const draftPaymentKey="p3-draft-payment-"+randomUUID();
  const draftPayment=await call("/api/v1/invoices/"+phase8Draft.body.data.id+"/payments",{
    method:"POST",headers:{"Idempotency-Key":draftPaymentKey},body:JSON.stringify(phase8PaymentPayload),
  },phase6aSession.jar);
  assert.equal(draftPayment.response.status,409,"a draft invoice cannot accept a payment allocation");
  assert.equal(draftPayment.body.error.code,"PAYMENT_NOT_ALLOWED");
  const forbiddenInvoicePayment=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",headers:{"Idempotency-Key":"p3-forbidden-payment-"+randomUUID()},body:JSON.stringify(phase8PaymentPayload),
  },staffSession.jar);
  assert.equal(forbiddenInvoicePayment.response.status,403,"invoice creator cannot record payments without payments:record");
  const [rejectedPaymentRows]=await db.execute(
    "SELECT COUNT(*) AS n FROM payments WHERE idempotency_key IN (?,?,?) OR reference IN (?,?)",
    [badPaymentDateKey,badPaymentMethodKey,draftPaymentKey,badPaymentDateReference,badPaymentMethodReference]);
  assert.equal(Number(rejectedPaymentRows[0].n),0,"invalid dates/methods and draft payments leave no receipt rows");
  console.log("PASS: Pack 3 invoice-payment rejection cases cover missing idempotency key, impossible date, invalid method, draft invoice and missing recording permission.");

  const concurrentPaymentResults=await Promise.all([
    call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
      method:"POST",headers:{"Idempotency-Key":phase8PaymentKey},body:JSON.stringify(phase8PaymentPayload),
    },phase6aSession.jar),
    call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
      method:"POST",headers:{"Idempotency-Key":phase8PaymentKey},body:JSON.stringify(phase8PaymentPayload),
    },phase6aSession.jar),
  ]);
  assert.deepEqual(concurrentPaymentResults.map(result=>result.response.status).sort((a,b)=>a-b),[200,201],
    "concurrent identical payment requests create one payment and replay the original result");
  assert.deepEqual(concurrentPaymentResults.map(result=>result.body.data.idempotentReplay).sort(),[false,true],
    "payment idempotency permits exactly one creation for a concurrent retry");
  const recordedPayment=concurrentPaymentResults.find(result=>result.body?.data?.idempotentReplay===false);
  assert.ok(recordedPayment,"one concurrent payment response is the original creation");
  assert.equal(recordedPayment.body.data.amount,"25.1234");
  assert.equal(recordedPayment.body.data.paidAmount,"25.1234");
  assert.equal(recordedPayment.body.data.outstandingBalance,"92.8766",
    "payment API computes exact outstanding balance without binary floating-point arithmetic");
  assert.equal(recordedPayment.body.data.paymentStatus,"PARTIALLY_PAID");
  assert.equal(recordedPayment.body.data.status,"RECORDED");
  const conflictingPaymentReplay=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",headers:{"Idempotency-Key":phase8PaymentKey},
    body:JSON.stringify({...phase8PaymentPayload,amount:"26.1234"}),
  },phase6aSession.jar);
  assert.equal(conflictingPaymentReplay.response.status,409,
    "reusing a payment idempotency key with a different amount is rejected");
  assert.equal(conflictingPaymentReplay.body.error.code,"DUPLICATE_SUBMISSION");
  const overpayment=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",headers:{"Idempotency-Key":"phase8-overpay-"+randomUUID()},
    body:JSON.stringify({...phase8PaymentPayload,amount:"1000.0000"}),
  },phase6aSession.jar);
  assert.equal(overpayment.response.status,409,"payments greater than the outstanding balance are rejected");
  assert.equal(overpayment.body.error.code,"PAYMENT_EXCEEDS_BALANCE");
  assert.equal(overpayment.body.error.details.outstandingBalance,"92.8766");
  const zeroPayment=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
    method:"POST",headers:{"Idempotency-Key":"phase8-zero-"+randomUUID()},
    body:JSON.stringify({...phase8PaymentPayload,amount:"0.0000"}),
  },phase6aSession.jar);
  assert.equal(zeroPayment.response.status,422,"zero-value payments are rejected");
  const paymentHistory=await call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{},phase6aSession.jar);
  assert.equal(paymentHistory.response.status,200);
  assert.equal(paymentHistory.body.data.length,1,"concurrent retries produce exactly one payment allocation");
  assert.equal(paymentHistory.body.data[0].amount,"25.1234");
  assert.equal(paymentHistory.body.data[0].allocatedAmount,"25.1234");
  const phase8Outstanding=await call("/api/v1/invoices/"+issuedInvoiceId,{},phase6aSession.jar);
  assert.equal(phase8Outstanding.response.status,200);
  assert.equal(phase8Outstanding.body.data.paidAmount,"25.1234");
  assert.equal(phase8Outstanding.body.data.outstandingBalance,"92.8766");
  assert.equal(phase8Outstanding.body.data.paymentStatus,"PARTIALLY_PAID");
  console.log("PASS: payment API validates inputs, enforces balance, preserves exact decimals, records one allocation under concurrent retries, and rejects conflicting idempotency keys.");





   // Pack 3 Part A: standalone receipt capture, immutable references/snapshots and scoped listing.
   const paymentOptions=await call("/api/v1/payments/options",{},phase6aSession.jar);
   assert.equal(paymentOptions.response.status,200,"receipt entry options require payments:record and current entity scope");
   assert.ok(paymentOptions.body.data.legalEntities.some(entity=>entity.id===entityA.id));
   assert.ok(paymentOptions.body.data.customers.some(customer=>customer.id===created.body.data.id));
   const p3ReceiptKey="p3-receipt-"+randomUUID();
   const p3ReceiptBody={legalEntityId:entityA.id,customerId:created.body.data.id,amount:"12.0000",currency:"INR",
     paymentDate:issueDate,method:"bank transfer",reference:"CI-P3-"+phase6bSuffix,notes:"Pack 3 standalone receipt and partial allocation regression"};
   const p3NoReverse=await seedUser("payment_recorder","p3-no-reverse-"+suffix+"@example.invalid","ACTIVE",
     "Pack3 No Reverse Password #5!",[entityA.id]);
   const p3NoReverseSession=await login(p3NoReverse);
   const p3OutOfScopeKey="p3-out-of-scope-"+randomUUID();
   const p3OutOfScopeReference="CI-P3-OUT-OF-SCOPE-"+randomUUID();
   const p3OutOfScope=await call("/api/v1/payments",{
     method:"POST",headers:{"Idempotency-Key":p3OutOfScopeKey},
     body:JSON.stringify({...p3ReceiptBody,legalEntityId:entityB.id,currency:entityB.currency,reference:p3OutOfScopeReference}),
   },p3NoReverseSession.jar);
   assert.equal(p3OutOfScope.response.status,404,"receipt recorder cannot write outside assigned legal-entity scope");
   const [p3OutOfScopeRows]=await db.execute("SELECT COUNT(*) AS n FROM payments WHERE idempotency_key=? OR reference=?",
     [p3OutOfScopeKey,p3OutOfScopeReference]);
   assert.equal(Number(p3OutOfScopeRows[0].n),0,"cross-entity receipt rejection leaves no ledger row");
   const p3CurrencyMismatchKey="p3-currency-mismatch-"+randomUUID();
   const p3CurrencyMismatchReference="CI-P3-CURRENCY-"+phase6bSuffix;
   const p3CurrencyMismatch=await call("/api/v1/payments",{
     method:"POST",headers:{"Idempotency-Key":p3CurrencyMismatchKey},
     body:JSON.stringify({...p3ReceiptBody,currency:"USD",reference:p3CurrencyMismatchReference}),
   },phase6aSession.jar);
   assert.equal(p3CurrencyMismatch.response.status,422,"receipt currency cannot override the configured legal-entity currency");
   assert.equal(p3CurrencyMismatch.body.error.code,"CURRENCY_MISMATCH");
   const [p3CurrencyMismatchRows]=await db.execute(
     "SELECT COUNT(*) AS n FROM payments WHERE idempotency_key=? OR reference=?",
     [p3CurrencyMismatchKey,p3CurrencyMismatchReference]);
   assert.equal(Number(p3CurrencyMismatchRows[0].n),0,"a rejected currency mismatch must leave no payment record");
   const p3Receipt=await call("/api/v1/payments",{method:"POST",headers:{"Idempotency-Key":p3ReceiptKey},body:JSON.stringify(p3ReceiptBody)},phase6aSession.jar);
   assert.equal(p3Receipt.response.status,201,"standalone receipt can be recorded without changing invoice balances");
   assert.match(p3Receipt.body.data.receiptReference,/^RCPT-[0-9A-F]{32}$/);
   assert.equal(p3Receipt.body.data.status,"RECORDED");
   assert.equal(p3Receipt.body.data.amount,"12.0000");
   assert.equal(p3Receipt.body.data.allocatedAmount,"0.0000");
   assert.equal(p3Receipt.body.data.unallocatedAmount,"12.0000");
   assert.equal(p3Receipt.body.data.customerSnapshot.name,created.body.data.name,"receipt preserves customer name at record time");
   assert.equal(p3Receipt.body.data.legalEntitySnapshot.displayName,entityA.displayName,"receipt preserves legal-entity identity at record time");
   const p3ReceiptReplay=await call("/api/v1/payments",{method:"POST",headers:{"Idempotency-Key":p3ReceiptKey},body:JSON.stringify(p3ReceiptBody)},phase6aSession.jar);
   assert.equal(p3ReceiptReplay.response.status,200,"identical standalone receipt retries return the saved receipt");
   assert.equal(p3ReceiptReplay.body.data.id,p3Receipt.body.data.id);
   const p3ReceiptConflict=await call("/api/v1/payments",{method:"POST",headers:{"Idempotency-Key":p3ReceiptKey},body:JSON.stringify({...p3ReceiptBody,amount:"13.0000"})},phase6aSession.jar);
   assert.equal(p3ReceiptConflict.response.status,409,"receipt idempotency rejects a different amount");
   const p3ReceiptList=await call("/api/v1/payments?legalEntityId="+entityA.id+"&customerId="+created.body.data.id+"&status=RECORDED&limit=100&offset=0",{},phase6aSession.jar);
   assert.equal(p3ReceiptList.response.status,200);
   assert.ok(p3ReceiptList.body.data.some(row=>row.id===p3Receipt.body.data.id));
   const p3ReceiptDetail=await call("/api/v1/payments/"+p3Receipt.body.data.id,{},phase6aSession.jar);
   assert.equal(p3ReceiptDetail.response.status,200);
   assert.equal(p3ReceiptDetail.body.data.customerSnapshot.name,created.body.data.name);
   assert.equal(p3ReceiptDetail.body.data.legalEntitySnapshot.displayName,entityA.displayName);
   assert.deepEqual(p3ReceiptDetail.body.data.allocations,[],"a receipt without allocations is retained and does not change any invoice");
   console.log("PASS: Pack 3 standalone receipts cover scoped options, unique references, immutable party snapshots, idempotent replay/conflict, listing and detail.");

   // Pack 3 Part B: reusable partial allocations, receipt/invoice bounds, atomic reversal and retained history.
   const p3AllocationKeyA="p3-alloc-a-"+randomUUID();
   const p3AllocationBodyA={paymentId:p3Receipt.body.data.id,amount:"5.0000"};
   const p3AllocationA=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":p3AllocationKeyA},body:JSON.stringify(p3AllocationBodyA),
   },phase6aSession.jar);
   assert.equal(p3AllocationA.response.status,201,"a receipt may be partially allocated to an issued invoice");
   assert.equal(p3AllocationA.body.data.amount,"5.0000");
   assert.equal(p3AllocationA.body.data.unallocatedAmount,"7.0000");
   const p3AllocationReplay=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":p3AllocationKeyA},body:JSON.stringify(p3AllocationBodyA),
   },phase6aSession.jar);
   assert.equal(p3AllocationReplay.response.status,200,"same allocation key replays the same allocation");
   assert.equal(p3AllocationReplay.body.data.id,p3AllocationA.body.data.id);
   const p3AllocationConflict=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":p3AllocationKeyA},body:JSON.stringify({...p3AllocationBodyA,amount:"4.0000"}),
   },phase6aSession.jar);
   assert.equal(p3AllocationConflict.response.status,409,"allocation idempotency rejects a conflicting amount");
   const p3OverReceipt=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":"p3-alloc-over-receipt-"+randomUUID()},body:JSON.stringify({paymentId:p3Receipt.body.data.id,amount:"8.0000"}),
   },phase6aSession.jar);
   assert.equal(p3OverReceipt.response.status,409,"allocation cannot exceed the remaining receipt amount");
   assert.equal(p3OverReceipt.body.error.code,"ALLOCATION_EXCEEDS_RECEIPT");
   const p3AllocationKeyB="p3-alloc-b-"+randomUUID();
   const p3AllocationB=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":p3AllocationKeyB},body:JSON.stringify({paymentId:p3Receipt.body.data.id,amount:"2.0000"}),
   },phase6aSession.jar);
   assert.equal(p3AllocationB.response.status,201,"multiple partial chunks from the same receipt to the same invoice are supported");
   assert.equal(p3AllocationB.body.data.unallocatedAmount,"5.0000");
   const p3AfterPartials=await call("/api/v1/invoices/"+issuedInvoiceId,{},phase6aSession.jar);
   assert.equal(p3AfterPartials.body.data.paidAmount,"32.1234");
   assert.equal(p3AfterPartials.body.data.outstandingBalance,"85.8766");
   const p3LargeKey="p3-large-"+randomUUID();
   const p3LargeBody={legalEntityId:entityA.id,customerId:created.body.data.id,amount:"100.0000",currency:"INR",
     paymentDate:issueDate,method:"bank transfer",reference:"CI-P3-LARGE-"+phase6bSuffix,notes:"Pack 3 invoice cap allocation fixture"};
   const p3Large=await call("/api/v1/payments",{method:"POST",headers:{"Idempotency-Key":p3LargeKey},body:JSON.stringify(p3LargeBody)},phase6aSession.jar);
   assert.equal(p3Large.response.status,201);
   const p3OverInvoice=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":"p3-alloc-over-invoice-"+randomUUID()},body:JSON.stringify({paymentId:p3Large.body.data.id,amount:"85.8767"}),
   },phase6aSession.jar);
   assert.equal(p3OverInvoice.response.status,409,"allocation cannot exceed outstanding invoice balance even when receipt has enough value");
   assert.equal(p3OverInvoice.body.error.code,"ALLOCATION_EXCEEDS_BALANCE");
   assert.equal(p3OverInvoice.body.error.details.outstandingBalance,"85.8766");
   const p3BalanceCappedAllocation=await call("/api/v1/invoices/"+issuedInvoiceId+"/allocations",{
     method:"POST",headers:{"Idempotency-Key":"p3-alloc-exact-balance-"+randomUUID()},body:JSON.stringify({paymentId:p3Large.body.data.id,amount:"85.8766"}),
   },phase6aSession.jar);
   assert.equal(p3BalanceCappedAllocation.response.status,201);
   const p3FullyPaid=await call("/api/v1/invoices/"+issuedInvoiceId,{},phase6aSession.jar);
   assert.equal(p3FullyPaid.body.data.paidAmount,"118.0000");
   assert.equal(p3FullyPaid.body.data.outstandingBalance,"0.0000");
   assert.equal(p3FullyPaid.body.data.paymentStatus,"PAID");
   const p3ReverseKey="p3-reverse-large-"+randomUUID();
   const p3ReverseBody={reason:"Pack 3 CI reversal restores invoice balance"};
   const p3Reversed=await call("/api/v1/payments/"+p3Large.body.data.id+"/reverse",{
     method:"POST",headers:{"Idempotency-Key":p3ReverseKey},body:JSON.stringify(p3ReverseBody),
   },phase6aSession.jar);
   assert.equal(p3Reversed.response.status,200);
   assert.equal(p3Reversed.body.data.status,"REVERSED");
   const p3ReverseReplay=await call("/api/v1/payments/"+p3Large.body.data.id+"/reverse",{
     method:"POST",headers:{"Idempotency-Key":p3ReverseKey},body:JSON.stringify(p3ReverseBody),
   },phase6aSession.jar);
   assert.equal(p3ReverseReplay.response.status,200,"same-key reversal retry is idempotent");
   assert.equal(p3ReverseReplay.body.data.idempotentReplay,true);
   assert.equal(p3ReverseReplay.body.data.reversalEventId,p3Reversed.body.data.reversalEventId);
   const p3ReverseConflict=await call("/api/v1/payments/"+p3Large.body.data.id+"/reverse",{
     method:"POST",headers:{"Idempotency-Key":p3ReverseKey},body:JSON.stringify({reason:"A conflicting reversal reason"}),
   },phase6aSession.jar);
   assert.equal(p3ReverseConflict.response.status,409,"reversal idempotency rejects a different reason");
   const p3AfterReversal=await call("/api/v1/invoices/"+issuedInvoiceId,{},phase6aSession.jar);
   assert.equal(p3AfterReversal.body.data.paidAmount,"32.1234","reversing a full receipt restores all linked invoice balances");
   assert.equal(p3AfterReversal.body.data.outstandingBalance,"85.8766");
   const p3ReversedDetail=await call("/api/v1/payments/"+p3Large.body.data.id,{},phase6aSession.jar);
   assert.equal(p3ReversedDetail.body.data.status,"REVERSED");
   assert.equal(p3ReversedDetail.body.data.allocations.length,1,"reversal retains source allocation ledger rows");
   assert.equal(p3ReversedDetail.body.data.reversalEvents.length,1,"reversal event is retained exactly once");
   const p3ReverseMissingReason=await call("/api/v1/payments/"+p3Receipt.body.data.id+"/reverse",{
     method:"POST",headers:{"Idempotency-Key":"p3-reverse-missing-"+randomUUID()},body:JSON.stringify({reason:"x"}),
   },phase6aSession.jar);
   assert.equal(p3ReverseMissingReason.response.status,422,"reversal reasons shorter than three characters are rejected");
   const p3SmallReversed=await call("/api/v1/payments/"+p3Receipt.body.data.id+"/reverse",{
     method:"POST",headers:{"Idempotency-Key":"p3-reverse-small-"+randomUUID()},body:JSON.stringify({reason:"Pack 3 reverse partially allocated receipt"}),
   },phase6aSession.jar);
   assert.equal(p3SmallReversed.response.status,200);
   const p3FinalInvoice=await call("/api/v1/invoices/"+issuedInvoiceId,{},phase6aSession.jar);
   assert.equal(p3FinalInvoice.body.data.paidAmount,"25.1234");
   assert.equal(p3FinalInvoice.body.data.outstandingBalance,"92.8766");
   const p3SmallDetail=await call("/api/v1/payments/"+p3Receipt.body.data.id,{},phase6aSession.jar);
   assert.equal(p3SmallDetail.body.data.status,"REVERSED");
   assert.equal(p3SmallDetail.body.data.allocations.length,2,"each partial allocation chunk remains auditable after reversal");
   const p3ForbiddenReverse=await call("/api/v1/payments/"+p3Large.body.data.id+"/reverse",{
     method:"POST",headers:{"Idempotency-Key":"p3-forbidden-reverse-"+randomUUID()},body:JSON.stringify({reason:"permission enforcement test"}),
   },p3NoReverseSession.jar);
   assert.equal(p3ForbiddenReverse.response.status,403,"payment recorder cannot reverse a receipt without payments:reverse");
   const [p3PaymentAuditRows]=await db.execute(
     "SELECT COUNT(*) AS n FROM audit_events WHERE action='payment.reversed' AND entity_id IN (?,?)",
     [p3Large.body.data.id,p3Receipt.body.data.id]);
   assert.equal(Number(p3PaymentAuditRows[0].n),2,"each payment reversal creates one payment audit event");

   const p3RaceReceipt=await call("/api/v1/payments",{
     method:"POST",headers:{"Idempotency-Key":"p3-reversal-race-receipt-"+randomUUID()},
     body:JSON.stringify({...p3ReceiptBody,amount:"9.0000",reference:"CI-P3-REVERSAL-RACE-"+randomUUID()}),
   },phase6aSession.jar);
   assert.equal(p3RaceReceipt.response.status,201);
   const p3ConcurrentReversals=await Promise.all([
     call("/api/v1/payments/"+p3RaceReceipt.body.data.id+"/reverse",{
       method:"POST",headers:{"Idempotency-Key":"p3-reversal-race-a-"+randomUUID()},body:JSON.stringify({reason:"Pack 3 concurrent reversal A"}),
     },phase6aSession.jar),
     call("/api/v1/payments/"+p3RaceReceipt.body.data.id+"/reverse",{
       method:"POST",headers:{"Idempotency-Key":"p3-reversal-race-b-"+randomUUID()},body:JSON.stringify({reason:"Pack 3 concurrent reversal B"}),
     },phase6aSession.jar),
   ]);
   assert.deepEqual(p3ConcurrentReversals.map(result=>result.response.status).sort((a,b)=>a-b),[200,409],
     "competing reversal requests cannot reverse the same receipt twice");
   const p3RaceDetail=await call("/api/v1/payments/"+p3RaceReceipt.body.data.id,{},phase6aSession.jar);
   assert.equal(p3RaceDetail.body.data.reversalEvents.length,1,"exactly one reversal event persists under concurrent reversal");

   const p3BalanceRace=await Promise.all([
     call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
       method:"POST",headers:{"Idempotency-Key":"p3-balance-race-a-"+randomUUID()},
       body:JSON.stringify({...phase8PaymentPayload,amount:"60.0000",reference:"CI-P3-BALANCE-RACE-A-"+randomUUID()}),
     },phase6aSession.jar),
     call("/api/v1/invoices/"+issuedInvoiceId+"/payments",{
       method:"POST",headers:{"Idempotency-Key":"p3-balance-race-b-"+randomUUID()},
       body:JSON.stringify({...phase8PaymentPayload,amount:"60.0000",reference:"CI-P3-BALANCE-RACE-B-"+randomUUID()}),
     },phase6aSession.jar),
   ]);
   assert.deepEqual(p3BalanceRace.map(result=>result.response.status).sort((a,b)=>a-b),[201,409],
     "concurrent different-key payment attempts cannot overpay an invoice in aggregate");
   assert.equal(p3BalanceRace.find(result=>result.response.status===409).body.error.code,"PAYMENT_EXCEEDS_BALANCE");
   const p3BalanceRaceInvoice=await call("/api/v1/invoices/"+issuedInvoiceId,{},phase6aSession.jar);
   assert.equal(p3BalanceRaceInvoice.body.data.paidAmount,"85.1234");
   assert.equal(p3BalanceRaceInvoice.body.data.outstandingBalance,"32.8766");
   const p3DashboardSummary=await call("/api/v1/payments/summary",{},phase6aSession.jar);
   assert.equal(p3DashboardSummary.response.status,200,"receivables summary is restricted to authenticated payment readers");
   const p3SummaryEntity=p3DashboardSummary.body.data.summaries.find(row=>row.legalEntityId===entityA.id&&row.currency==="INR");
   assert.ok(p3SummaryEntity,"dashboard groups totals by authorized legal entity and currency");
   const p3SummaryInvoices=await call("/api/v1/invoices?status=ISSUED&legalEntityId="+entityA.id+"&limit=100&offset=0",{},phase6aSession.jar);
   assert.equal(p3SummaryInvoices.response.status,200);
   const p3SummaryReceipts=await call("/api/v1/payments?legalEntityId="+entityA.id+"&limit=100&offset=0",{},phase6aSession.jar);
   assert.equal(p3SummaryReceipts.response.status,200);
   const p3MoneySum=(values)=>{
     let units=0n;
     for(const value of values){
       const [whole,fraction=""]=String(value).split(".");
       units+=BigInt(whole||"0")*10000n+BigInt((fraction+"0000").slice(0,4));
     }
     return (units/10000n).toString()+"."+(units%10000n).toString().padStart(4,"0");
   };
   assert.equal(p3SummaryEntity.issuedInvoiceTotal,p3MoneySum(p3SummaryInvoices.body.data.map(row=>row.grandTotal)));
   assert.equal(p3SummaryEntity.allocatedInvoiceTotal,p3MoneySum(p3SummaryInvoices.body.data.map(row=>row.paidAmount)));
   assert.equal(p3SummaryEntity.outstandingBalance,p3MoneySum(p3SummaryInvoices.body.data.map(row=>row.outstandingBalance)));
   const p3RecordedReceipts=p3SummaryReceipts.body.data.filter(row=>row.status==="RECORDED");
   assert.equal(p3SummaryEntity.recordedReceiptTotal,p3MoneySum(p3RecordedReceipts.map(row=>row.amount)));
   assert.equal(p3SummaryEntity.allocatedReceiptTotal,p3MoneySum(p3RecordedReceipts.map(row=>row.allocatedAmount)));
   assert.equal(p3SummaryEntity.unallocatedReceiptTotal,p3MoneySum(p3RecordedReceipts.map(row=>row.unallocatedAmount)));
   assert.equal(p3SummaryEntity.reversedReceiptCount,p3SummaryReceipts.body.data.filter(row=>row.status==="REVERSED").length);
   const p3ForbiddenSummary=await call("/api/v1/payments/summary",{},staffSession.jar);
   assert.equal(p3ForbiddenSummary.response.status,403,"overview financial totals are not exposed without payments:read");
   console.log("PASS: Pack 3 dashboard summary reconciles exact totals to invoice and receipt list APIs and enforces payment-read access.");
   console.log("PASS: Pack 3 concurrent reversal and competing payment requests cannot double-reverse or aggregate-overpay.");
   console.log("PASS: Pack 3 receipt create/replay/conflict, snapshots, scoped listing, partial allocations, amount bounds, full-paid balance, atomic reversals, idempotency and least-privilege reversal are covered.");

  assert.match(issueResult.body.data.invoiceNumber,/^P6B-/);
  assert.match(issueResult.body.data.configurationSha256,/^[0-9a-f]{64}$/);

  const [issuedRows]=await db.execute(
    "SELECT lifecycle_status,invoice_number,financial_year,issue_idempotency_key,supplier_snapshot FROM invoices WHERE id=?",
    [issuedInvoiceId],
  );
  assert.equal(issuedRows.length,1);
  assert.equal(issuedRows[0].lifecycle_status,"ISSUED");
  assert.equal(issuedRows[0].invoice_number,issueResult.body.data.invoiceNumber);
  assert.equal(issuedRows[0].issue_idempotency_key,issueKey);
  assert.equal(JSON.stringify(issuedRows[0].supplier_snapshot).includes(accountNumber),false,
    "legacy supplier snapshots must not persist the full bank account");

  const [issuedSnapshots]=await db.execute(
    "SELECT id,configuration_snapshot,configuration_sha256,numbering_config_id,template_id FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [issuedInvoiceId],
  );
  assert.equal(issuedSnapshots.length,1);
  assert.equal(issuedSnapshots[0].id,issueResult.body.data.configurationSnapshotId);
  assert.equal(issuedSnapshots[0].configuration_sha256,issueResult.body.data.configurationSha256);
  assert.equal(issuedSnapshots[0].numbering_config_id,phase6bNumberingId);
  assert.equal(issuedSnapshots[0].template_id,phase6bTemplateId);
  const issueSnapshot=typeof issuedSnapshots[0].configuration_snapshot==="string"
    ?JSON.parse(issuedSnapshots[0].configuration_snapshot):issuedSnapshots[0].configuration_snapshot;
  assert.ok(issueSnapshot.selectedTaxRules.some(row=>row.id===phase6bTaxRuleId));
  assert.ok(issueSnapshot.selectedTaxRegistrations.some(row=>row.id===phase6bRegistrationId));
  assert.ok(issueSnapshot.legalEntityConfigVersion?.id,"issued snapshot retains its exact legal-entity configuration version reference");

  const issueReplay=await call("/api/v1/invoices/"+issuedInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":issueKey},body:JSON.stringify({documentDate:issueDate}),
  },phase6aSession.jar);
  assert.equal(issueReplay.response.status,200,"same idempotency key returns original issuance result");
  assert.equal(issueReplay.body.data.idempotentReplay,true);
  assert.equal(issueReplay.body.data.invoiceNumber,issueResult.body.data.invoiceNumber);
  assert.equal(issueReplay.body.data.configurationSha256,issueResult.body.data.configurationSha256);

  const alternateDocumentDate = issueDate === "2026-01-01" ? "2026-01-02" : "2026-01-01";
  const dateConflictReplay = await call("/api/v1/invoices/" + issuedInvoiceId + "/issue", {
    method: "POST", headers: { "Idempotency-Key": issueKey }, body: JSON.stringify({ documentDate: alternateDocumentDate }),
  }, phase6aSession.jar);
  assert.equal(dateConflictReplay.response.status, 409, "same issue key with a different document date is a conflicting replay");
  assert.equal(dateConflictReplay.body.error.code, "CONFIGURATION_CONFLICT");
  const [afterDateConflict] = await db.execute(
    "SELECT invoice_date,invoice_number,lifecycle_status FROM invoices WHERE id=?", [issuedInvoiceId],
  );
  assert.equal(afterDateConflict[0].lifecycle_status, "ISSUED", "conflicting issue retry cannot change lifecycle state");
  assert.equal(afterDateConflict[0].invoice_number, issueResult.body.data.invoiceNumber, "conflicting issue retry preserves the allocated document number");
  const persistedIssuedDate = afterDateConflict[0].invoice_date instanceof Date
    ? afterDateConflict[0].invoice_date.toISOString().slice(0, 10)
    : String(afterDateConflict[0].invoice_date).slice(0, 10);
  assert.equal(persistedIssuedDate, issueDate, "conflicting issue retry preserves the originally issued document date");
  const [snapshotCountAfterDateConflict] = await db.execute(
    "SELECT COUNT(*) AS total FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [issuedInvoiceId],
  );
  assert.equal(Number(snapshotCountAfterDateConflict[0].total), 1, "conflicting issue retry cannot replace or duplicate the issue snapshot");

  const conflictingReplay=await call("/api/v1/invoices/"+issuedInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":issueKey+"-DIFFERENT"},body:JSON.stringify({documentDate:issueDate}),
  },phase6aSession.jar);
  assert.equal(conflictingReplay.response.status,409,"a different idempotency key cannot reissue the issued invoice");
  assert.equal(conflictingReplay.body.error.code,"CONFIGURATION_CONFLICT");

  // Reusing a successful issue key on another draft in the same legal entity must not
  // issue a second document, allocate another number, or create another snapshot.
  const reusedIssueKeyInvoiceId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'INR',0.0000,0.0000,0.0000,0.0000)",
    [reusedIssueKeyInvoiceId,entityA.id,created.body.data.id],
  );
  const [[sequenceBeforeReusedKey]] = await db.execute(
    "SELECT next_value FROM invoice_number_sequences WHERE legal_entity_id=? AND document_type='INVOICE' AND financial_year_label=?",
    [entityA.id,issueResult.body.data.financialYear],
  );
  assert.ok(sequenceBeforeReusedKey,"the successful issue has an active sequence row");
  const reusedIssueKeyResult=await call("/api/v1/invoices/"+reusedIssueKeyInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":issueKey},body:JSON.stringify({documentDate:issueDate}),
  },phase6aSession.jar);
  assert.equal(reusedIssueKeyResult.response.status,409,
    "an issue idempotency key already consumed by another invoice must be rejected");
  assert.equal(reusedIssueKeyResult.body.error.code,"CONFIGURATION_CONFLICT");
  const [reusedIssueKeyInvoiceRows]=await db.execute(
    "SELECT lifecycle_status,invoice_number,issue_idempotency_key FROM invoices WHERE id=?",
    [reusedIssueKeyInvoiceId],
  );
  assert.equal(reusedIssueKeyInvoiceRows[0].lifecycle_status,"DRAFT","issue-key collision leaves the second invoice as a draft");
  assert.equal(reusedIssueKeyInvoiceRows[0].invoice_number,null,"issue-key collision allocates no invoice number");
  assert.equal(reusedIssueKeyInvoiceRows[0].issue_idempotency_key,null,"issue-key collision does not persist the consumed key");
  const [[sequenceAfterReusedKey]] = await db.execute(
    "SELECT next_value FROM invoice_number_sequences WHERE legal_entity_id=? AND document_type='INVOICE' AND financial_year_label=?",
    [entityA.id,issueResult.body.data.financialYear],
  );
  assert.equal(String(sequenceAfterReusedKey.next_value),String(sequenceBeforeReusedKey.next_value),
    "issue-key collision consumes no invoice number");
  const [reusedIssueKeySnapshots]=await db.execute(
    "SELECT id FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [reusedIssueKeyInvoiceId],
  );
  assert.equal(reusedIssueKeySnapshots.length,0,"issue-key collision creates no configuration snapshot");

  // Both rules and both registrations are individually valid, but each invoice line is
  // deliberately paired with the other jurisdiction's registration. Issuance must reject it.
  const mismatchedTaxInvoiceId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'INR',200.0000,0,36.0000,236.0000)",
    [mismatchedTaxInvoiceId,entityA.id,created.body.data.id],
  );
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,1,'CI mismatched jurisdiction line A',1.0000,100.0000,0,18.000000,?,?,?,18.0000,118.0000)",
    [randomUUID(),mismatchedTaxInvoiceId,phase6bTaxCode,phase6bTaxRuleId,phase6bOtherRegistrationId],
  );
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,2,'CI mismatched jurisdiction line B',1.0000,100.0000,0,18.000000,?,?,?,18.0000,118.0000)",
    [randomUUID(),mismatchedTaxInvoiceId,phase6bOtherTaxCode,phase6bOtherTaxRuleId,phase6bRegistrationId],
  );
  const mismatchedTaxIssue=await call("/api/v1/invoices/"+mismatchedTaxInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":"p6b-tax-pair-"+phase6bSuffix.toLowerCase()+"-001"},
    body:JSON.stringify({documentDate:issueDate}),
  },phase6aSession.jar);
  assert.equal(mismatchedTaxIssue.response.status,409,"a line cannot use a registration from a different tax jurisdiction");
  assert.equal(mismatchedTaxIssue.body.error.code,"CONFIGURATION_NOT_READY");
  const [mismatchedInvoiceState]=await db.execute("SELECT lifecycle_status FROM invoices WHERE id=?",[mismatchedTaxInvoiceId]);
  assert.equal(mismatchedInvoiceState[0].lifecycle_status,"DRAFT","failed tax-jurisdiction validation must leave the invoice as draft");
  const [mismatchedSnapshots]=await db.execute(
    "SELECT id FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",[mismatchedTaxInvoiceId],
  );
  assert.equal(mismatchedSnapshots.length,0,"failed validation must not persist a configuration snapshot");
  console.log("PASS: issuance rejects cross-jurisdiction line/registration pairings and rolls back the issue transaction.");

  console.log("PASS: Phase 6B end-to-end issue path validates finance-approved rules, reserves and persists the invoice number, stores the immutable configuration snapshot/hash, masks bank details in the supplier snapshot, and enforces same-key replay/conflicting-key rejection.");

  // Debit notes share the transactional numbering/snapshot path but use their own document-type series.
  const debitNumbering=await call("/api/v1/numbering-configs",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,documentType:"DEBIT_NOTE",seriesCode:"P6B_DN_"+phase6bSuffix,
      prefix:"P6B-DN-"+phase6bSuffix+"-",suffix:"",sequenceWidth:5,includeFinancialYear:true,
      financialYearStartMonth:4,financialYearStartDay:1,timeZone:"Asia/Kolkata",effectiveFrom:"2020-01-01",
      effectiveUntil:"",approvalReference:"CI-DN-NUM-APPROVAL-"+phase6bSuffix,activate:true,
      changeReason:"Phase 6B debit-note series fixture"}),
  },phase6aSession.jar);
  assert.equal(debitNumbering.response.status,201,"debit-note series must be configurable");
  const debitTemplate=await call("/api/v1/document-templates",{
    method:"POST",
    body:JSON.stringify({legalEntityId:entityA.id,documentType:"DEBIT_NOTE",templateKey:"DEBIT",
      displayName:"Synthetic debit note template",templateConfig:{...templateConfig,showBankDetails:false},
      effectiveFrom:"2020-01-01",effectiveUntil:"",activate:true,
      changeReason:"Phase 6B debit-note template fixture"}),
  },phase6aSession.jar);
  assert.equal(debitTemplate.response.status,201,"debit-note template must be configurable");
  const debitNoteId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'DEBIT_NOTE','DRAFT',30,'INR',100.0000,0,18.0000,118.0000)",
    [debitNoteId,entityA.id,created.body.data.id],
  );
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,1,'CI debit-note line',1.0000,100.0000,0,18.000000,?,?,?,18.0000,118.0000)",
    [randomUUID(),debitNoteId,phase6bTaxCode,phase6bTaxRuleId,phase6bRegistrationId],
  );
  const debitIssue=await call("/api/v1/invoices/"+debitNoteId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":"p6b-debit-"+phase6bSuffix.toLowerCase()+"-001"},
    body:JSON.stringify({documentDate:issueDate}),
  },phase6aSession.jar);
  assert.equal(debitIssue.response.status,200,"debit note issues through the secured transactional path: "+JSON.stringify(debitIssue.body?.error??null));
  assert.match(debitIssue.body.data.invoiceNumber,/^P6B-DN-/);
  const [debitSnapshotRows]=await db.execute(
    "SELECT resource_type,configuration_sha256,numbering_config_id,template_id FROM document_configuration_snapshots WHERE resource_id=?",
    [debitNoteId],
  );
  assert.equal(debitSnapshotRows.length,1);
  assert.equal(debitSnapshotRows[0].resource_type,"DEBIT_NOTE");
  assert.equal(debitSnapshotRows[0].numbering_config_id,debitNumbering.body.data.id);
  assert.equal(debitSnapshotRows[0].template_id,debitTemplate.body.data.templateId);
  assert.equal(debitSnapshotRows[0].configuration_sha256,debitIssue.body.data.configurationSha256);
  console.log("PASS: debit notes use their own approved numbering series and preserve the selected immutable configuration snapshot.");

  const unitCode = "P6A_" + suffix.toUpperCase();
  const unitCreated = await call("/api/v1/business-units", {
    method: "POST",
    body: JSON.stringify({ code: unitCode, name: "Phase 6A Unit " + suffix, description: "CI-only organization unit",
      legalEntityIds: [entityB.id], brandIds: [brandId], changeReason: "Phase 6A business unit creation fixture" }),
  }, phase6aSession.jar);
  assert.equal(unitCreated.response.status, 201, "business unit requires and accepts explicit valid mappings: " + JSON.stringify(unitCreated.body?.error ?? null));
  const unitId = unitCreated.body.data.id;
  const unitDetail = await call("/api/v1/business-units/" + unitId, {}, phase6aSession.jar);
  assert.equal(unitDetail.response.status, 200);
  assert.deepEqual(unitDetail.body.data.legalEntities.map((row) => row.id), [entityB.id]);
  assert.deepEqual(unitDetail.body.data.brandIds, [brandId]);
  const unitMoved = await call("/api/v1/business-units/" + unitId, {
    method: "PATCH",
    body: JSON.stringify({ legalEntityIds: [entityA.id], brandIds: [], changeReason: "Phase 6A unit mapping history acceptance update" }),
  }, phase6aSession.jar);
  assert.equal(unitMoved.response.status, 200, "business unit mappings can be explicitly changed");
  const [unitEntityLinks] = await db.execute(
    "SELECT legal_entity_id,effective_from,effective_until,is_primary FROM business_unit_legal_entities WHERE business_unit_id=? ORDER BY effective_from",
    [unitId],
  );
  assert.equal(unitEntityLinks.length, 2, "old business-unit entity mapping row is retained rather than deleted");
  assert.ok(unitEntityLinks.find((row) => row.legal_entity_id === entityB.id)?.effective_until);
  assert.equal(unitEntityLinks.find((row) => row.legal_entity_id === entityA.id)?.effective_until ?? null, null);
  const [unitBrandLinks] = await db.execute("SELECT effective_until FROM brand_business_units WHERE business_unit_id=?", [unitId]);
  assert.equal(unitBrandLinks.length, 1, "removed unit-brand mapping remains in the historical mapping table");
  assert.ok(unitBrandLinks[0].effective_until);

  // A related entity can be deactivated after configuration is created. This must not trap
  // an active business unit in a state where it cannot itself be deactivated, and inactive
  // legal entities must not permit their brands/business units to be reactivated.
  const recoveryUnit=await call("/api/v1/business-units",{
    method:"POST",
    body:JSON.stringify({code:"P6A_REC_"+suffix.toUpperCase(),name:"Phase 6A Recovery Unit "+suffix,
      description:"CI-only deactivation regression",legalEntityIds:[entityB.id],brandIds:[brandId],
      changeReason:"Phase 6A deactivation regression fixture"}),
  },phase6aSession.jar);
  assert.equal(recoveryUnit.response.status,201,"test recovery unit can be created before entity deactivation");
  const brandOff=await call("/api/v1/brands/"+brandId,{
    method:"PATCH",body:JSON.stringify({isActive:false,changeReason:"Phase 6A deactivation regression: disable brand"}),
  },phase6aSession.jar);
  assert.equal(brandOff.response.status,200,"mapped brand can be deactivated");
  const prematureEntityOff=await call("/api/v1/legal-entities/"+entityB.id,{
    method:"PATCH",body:JSON.stringify({isActive:false,changeReason:"Phase 6A negative test: refuse while mapped unit is active"}),
  },phase6aSession.jar);
  assert.equal(prematureEntityOff.response.status,409,"legal entity cannot deactivate while a mapped business unit remains active");
  const unitOff=await call("/api/v1/business-units/"+recoveryUnit.body.data.id,{
    method:"PATCH",body:JSON.stringify({isActive:false,changeReason:"Phase 6A deactivation regression: disable unit"}),
  },phase6aSession.jar);
  assert.equal(unitOff.response.status,200,"business unit can be deactivated after its mapped brand is inactive: "+JSON.stringify(unitOff.body?.error??null));
  const entityOff=await call("/api/v1/legal-entities/"+entityB.id,{
    method:"PATCH",body:JSON.stringify({isActive:false,changeReason:"Phase 6A deactivation regression: disable entity"}),
  },phase6aSession.jar);
  assert.equal(entityOff.response.status,200,"legal entity can be deactivated after all mapped brands and units are inactive");
  const unitReactivation=await call("/api/v1/business-units/"+recoveryUnit.body.data.id,{
    method:"PATCH",body:JSON.stringify({isActive:true,changeReason:"Phase 6A negative test: cannot reactivate unit"}),
  },phase6aSession.jar);
  assert.equal(unitReactivation.response.status,409,"business unit cannot reactivate while a mapped entity is inactive");
  const brandReactivation=await call("/api/v1/brands/"+brandId,{
    method:"PATCH",body:JSON.stringify({isActive:true,changeReason:"Phase 6A negative test: cannot reactivate brand"}),
  },phase6aSession.jar);
  assert.equal(brandReactivation.response.status,409,"brand cannot reactivate while its mapped entity is inactive");
  console.log("PASS: inactive entity mappings do not block deactivation, and mapped brands/business units cannot be reactivated inconsistently.");

  const outsider = await seedUser("finance_admin", "phase6a-outsider-" + suffix + "@example.invalid", "ACTIVE",
    "Phase 6A Outsider Password #5!", [testLegalEntityId]);
  const outsiderSession = await login(outsider);
  const outOfScopeInvoiceId=randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',0,'INR',0,0,0,0)",
    [outOfScopeInvoiceId,entityA.id,created.body.data.id],
  );
  const hiddenInvoiceIssue=await call("/api/v1/invoices/"+outOfScopeInvoiceId+"/issue",{
    method:"POST",headers:{"Idempotency-Key":"ci-out-of-scope-"+suffix.toLowerCase()},
    body:JSON.stringify({documentDate:new Date().toISOString().slice(0,10)}),
  },outsiderSession.jar);
  assert.equal(hiddenInvoiceIssue.response.status,404,"out-of-scope invoice is concealed from a finance administrator without that entity grant");
  assert.equal(hiddenInvoiceIssue.body.error.code,"NOT_FOUND");

  const scopedBrands = await call("/api/v1/brands?status=all", {}, outsiderSession.jar);
  assert.equal(scopedBrands.response.status, 200);
  assert.equal(scopedBrands.body.data.some((row) => row.id === brandId), false, "brand list must not leak across legal-entity scope");
  const hiddenBrand = await call("/api/v1/brands/" + brandId, {}, outsiderSession.jar);
  assert.equal(hiddenBrand.response.status, 404, "out-of-scope brand details must be hidden");
  const hiddenUnit = await call("/api/v1/business-units/" + unitId, {}, outsiderSession.jar);
  assert.equal(hiddenUnit.response.status, 404, "out-of-scope business-unit details must be hidden");
  const invalidCrossScopeBrand = await call("/api/v1/brands", {
    method: "POST",
    body: JSON.stringify({ name: "Out-of-scope Brand", code: "XSC-" + suffix.toUpperCase(),
      legalEntityIds: [entityB.id], changeReason: "Attempted cross-scope mapping" }),
  }, outsiderSession.jar);
  assert.equal(invalidCrossScopeBrand.response.status, 403, "brand mapping cannot be created outside caller's legal-entity scope");
  console.log("PASS: Phase 6A integration tests cover registered/billing identity, bank masking and finance-only writes, audit reason and safe before/after data, legal-entity/brand/business-unit versioning, historical mapping retention and cross-entity scope isolation.");

  const financeAdmin = await seedUser("finance_admin", "finance-" + suffix + "@example.invalid", "ACTIVE",
    "Finance Admin Strong Password #5!");
  const financeSession = await login(financeAdmin);
  const itemCode = "PH5-" + suffix.toUpperCase();
  const item = await call("/api/v1/catalog/items", {
    method: "POST",
    body: JSON.stringify({
      itemCode, itemType: "SERVICE", name: "Phase 05 CI service",
      customerDescription: "CI-only auth test fixture", internalDescription: "Not production data",
      unitCode: "unit", defaultUnitPrice: "12.3400", currency: "INR", defaultTaxCode: "",
    }),
  }, financeSession.jar);
  assert.equal(item.response.status, 201);
  assert.equal(item.body.data.defaultUnitPrice, "12.3400");
  // Regression: catalog:create without catalog:update/settings:manage must not reveal internal descriptions.
  const [creatorRoleRows] = await db.execute(
    "SELECT id FROM app_roles WHERE role_key='invoice_creator' LIMIT 1"
  );
  const [catalogCreateRows] = await db.execute(
    "SELECT id FROM app_permissions WHERE permission_key='catalog:create' LIMIT 1"
  );
  assert.equal(creatorRoleRows.length, 1, "invoice_creator role exists");
  assert.equal(catalogCreateRows.length, 1, "catalog:create permission exists");

  const creatorRoleId = creatorRoleRows[0].id;
  const catalogCreatePermissionId = catalogCreateRows[0].id;
  const [existingCreateGrant] = await db.execute(
    "SELECT role_id FROM role_permissions WHERE role_id=? AND permission_id=?",
    [creatorRoleId, catalogCreatePermissionId]
  );
  assert.equal(existingCreateGrant.length, 0,
    "invoice_creator starts without catalog:create in the reviewed baseline");

  await db.execute(
    "INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)",
    [creatorRoleId, catalogCreatePermissionId]
  );

  try {
    const [storedInternalRows] = await db.execute(
      "SELECT internal_description FROM catalog_items WHERE id=?",
      [item.body.data.id]
    );
    assert.equal(storedInternalRows[0]?.internal_description, "Not production data",
      "fixture contains a real stored internal description");

    const createOnlyDetail = await call(
      "/api/v1/catalog/items/" + item.body.data.id,
      {},
      staffSession.jar
    );
    assert.equal(createOnlyDetail.response.status, 200);
    assert.equal(
      Object.hasOwn(createOnlyDetail.body.data, "internalDescription"),
      false,
      "catalog:create without catalog:update must not expose internal description in detail"
    );

    const createOnlyExport = await fetch(
      new URL("/api/v1/catalog/items/export?status=all", baseUrl),
      { headers: { Cookie: cookieHeader(staffSession.jar) }, cache: "no-store" }
    );
    assert.equal(createOnlyExport.status, 200);
    const createOnlyCsv = await createOnlyExport.text();
    const csvHeader = createOnlyCsv.split(/\r?\n/, 1)[0];
    assert.equal(
      csvHeader.split(",").includes("internalDescription"),
      false,
      "catalog:create without catalog:update must not export the internalDescription column"
    );
    assert.equal(
      createOnlyCsv.includes("Not production data"),
      false,
      "catalog export must not reveal the stored internal description value"
    );
    console.log("PASS: create-only catalog permission cannot read or export internal descriptions.");
  } finally {
    await db.execute(
      "DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",
      [creatorRoleId, catalogCreatePermissionId]
    );
  }

  // Phase 7: customer CRUD, duplicate warnings, optimistic concurrency, child records and safe archive.
  const phase7CustomerName = "Phase 07 Customer " + suffix;
  const phase7CustomerCode = "P7-" + suffix.toUpperCase();
  const phase7Customer = await call("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({
      customerCode: phase7CustomerCode, name: phase7CustomerName,
      email: "phase7-" + suffix + "@example.invalid", phone: "+91-900000" + suffix.slice(0, 6),
      billingAddress: { line1: "12 CI Lane", city: "Pune", state: "Maharashtra", postalCode: "411001", countryCode: "IN" },
      shippingAddress: { line1: "Delivery Bay 2", city: "Pune", postalCode: "411002", countryCode: "IN" },
      purchaseOrderReference: "CI-PO-" + suffix, paymentTermsDays: 30,
      contacts: [{ fullName: "Phase 7 Contact", jobTitle: "Accounts", email: "contact-" + suffix + "@example.invalid", phone: "+91-9111111111", isPrimary: true }],
      taxIdentifiers: [{ identifierType: "OTHER", countryCode: "IN", jurisdiction: "CI only", identifierValue: "TAX-" + suffix }],
    }),
  }, financeSession.jar);
  assert.equal(phase7Customer.response.status, 201, "customer CRUD accepts customer billing, shipping, contact and tax identifier details");
  assert.equal(phase7Customer.body.data.recordVersion, 1);
  const phase7CustomerId = phase7Customer.body.data.id;

  // Phase 10: quotation draft creation, idempotency, read, versioned editing and cancellation.
  const quotationDate = new Date().toISOString().slice(0,10);
  const quotationFinanceAdmin = await seedUser("finance_admin", "quotation-" + suffix + "@example.invalid", "ACTIVE",
    "Quotation Strong Password #5!", [entityA.id]);
  const quotationFinanceSession = await login(quotationFinanceAdmin);
  const quotationCustomerName = "Phase 10 Customer " + suffix;
  const quotationCustomer = await call("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({ customerCode: "Q-" + suffix, name: quotationCustomerName, email: "quote-" + suffix.toLowerCase() + "@example.invalid" }),
  }, quotationFinanceSession.jar);
  assert.equal(quotationCustomer.response.status, 201, "quotation lifecycle test creates a separate customer fixture");
  const quotationCustomerId = quotationCustomer.body.data.id;
  // The legal entity is deliberately configured with an 18% default tax rule for invoice tests.
  // Use a separate approved zero-rate rule for quotation lifecycle/DECIMAL(19,4) fixtures so
  // their expected amounts stay stable and the high-value precision case remains within DECIMAL.
  const quotationTaxCode = "P2_ZERO_" + suffix.toUpperCase();
  const quotationTaxRule = await call("/api/v1/tax-rules", {
    method: "POST",
    body: JSON.stringify({
      legalEntityId: entityA.id, taxCode: quotationTaxCode, displayName: "Synthetic Pack 2 zero-rate quotation rule",
      jurisdiction: "CI-JURISDICTION", ratePercent: "0", calculationMode: "EXCLUSIVE", effectiveFrom: "2020-01-01",
      effectiveUntil: "", approvalReference: "CI-P2-ZERO-" + suffix.toUpperCase(),
      changeReason: "Pack 2 test-only zero-rate rule for stable quotation lifecycle and precision fixtures",
    }),
  }, quotationFinanceSession.jar);
  assert.equal(quotationTaxRule.response.status, 201,
    "quotation precision fixture creates an approved zero-rate test rule; response=" + JSON.stringify(quotationTaxRule.body.error ?? quotationTaxRule.body));
  const quotationValidUntil = new Date(Date.parse(quotationDate + "T00:00:00.000Z") + 30 * 86400000).toISOString().slice(0,10);
  const quotationKey = "q-" + randomUUID();
  const quotationPayload = {
    legalEntityId: entityA.id, brandId: null, customerId: quotationCustomerId, currency: "INR",
    invoiceDate: quotationDate, dueDate: null, validUntil: quotationValidUntil, paymentTermsDays: 30,
    notes: "Phase 10 quotation API integration test",
    lines: [{ lineKind: "ITEM", description: "Quotation test service", unitCode: "hour", quantity: "2.0000",
      unitPrice: "20.0000", discountType: "AMOUNT", discountValue: "4.0000", taxCode: quotationTaxCode }],
  };
  const quotation = await call("/api/v1/quotations", {
    method: "POST", headers: { "Idempotency-Key": quotationKey }, body: JSON.stringify(quotationPayload),
  }, quotationFinanceSession.jar);
  assert.equal(quotation.response.status, 201, "quotation draft creation uses the quotation permission and assigned entity scope; response=" + JSON.stringify(quotation.body.error ?? quotation.body));
  assert.equal(quotation.body.data.status, "DRAFT");
  assert.equal(quotation.body.data.grandTotal, "36.0000", "quotation totals use exact server-side calculation");
  const quotationId = quotation.body.data.id;
  const quotationReplay = await call("/api/v1/quotations", {
    method: "POST", headers: { "Idempotency-Key": quotationKey }, body: JSON.stringify(quotationPayload),
  }, quotationFinanceSession.jar);
  assert.equal(quotationReplay.response.status, 200, "same quotation idempotency key and payload replay the existing draft");
  assert.equal(quotationReplay.body.data.id, quotationId);
  assert.equal(quotationReplay.body.data.idempotentReplay, true);
  const conflictingQuotationReplay = await call("/api/v1/quotations", {
    method: "POST", headers: { "Idempotency-Key": quotationKey },
    body: JSON.stringify({ ...quotationPayload, notes: "Different payload using the same key" }),
  }, quotationFinanceSession.jar);
  assert.equal(conflictingQuotationReplay.response.status, 409,
    "reusing the quotation idempotency key with a changed payload is rejected");
  assert.equal(conflictingQuotationReplay.body.error.code, "DUPLICATE_SUBMISSION");
  const concurrentQuotationKey = "q-concurrent-" + randomUUID();
  const concurrentQuotationResults = await Promise.all([
    call("/api/v1/quotations", {
      method: "POST", headers: { "Idempotency-Key": concurrentQuotationKey },
      body: JSON.stringify({ ...quotationPayload, notes: "Pack 2 concurrent identical create regression" }),
    }, quotationFinanceSession.jar),
    call("/api/v1/quotations", {
      method: "POST", headers: { "Idempotency-Key": concurrentQuotationKey },
      body: JSON.stringify({ ...quotationPayload, notes: "Pack 2 concurrent identical create regression" }),
    }, quotationFinanceSession.jar),
  ]);
  assert.deepEqual(concurrentQuotationResults.map(result => result.response.status).sort((a, b) => a - b), [200, 201],
    "concurrent identical quotation create requests produce one creation and one idempotent replay");
  assert.deepEqual(concurrentQuotationResults.map(result => result.body.data.idempotentReplay).sort(), [false, true]);
  assert.equal(concurrentQuotationResults[0].body.data.id, concurrentQuotationResults[1].body.data.id,
    "concurrent quotation retries resolve to the same committed draft");
  const [[concurrentQuotationCount]] = await db.execute(
    "SELECT COUNT(*) AS total FROM quotations WHERE idempotency_key=?", [concurrentQuotationKey],
  );
  assert.equal(Number(concurrentQuotationCount.total), 1,
    "concurrent identical quotation creates persist exactly one quotation row");

  const quotationDetail = await call("/api/v1/quotations/" + quotationId, {}, quotationFinanceSession.jar);
  assert.equal(quotationDetail.response.status, 200);
  assert.equal(quotationDetail.body.data.lines.length, 1);
  assert.equal(quotationDetail.body.data.lines[0].discountValue, "4.0000");
  const quotationList = await call("/api/v1/quotations?status=DRAFT&query=" + encodeURIComponent(quotationCustomerName) + "&limit=25&offset=0", {}, quotationFinanceSession.jar);
  assert.equal(quotationList.response.status, 200);
  assert.ok(quotationList.body.data.some(row => row.id === quotationId), "quotation list search returns the saved draft");

  // Regression: DECIMAL(19,4) values must never pass through JS floating-point subtraction.
  const highValueQuotationKey = "q-high-" + randomUUID();
  const highValueQuotation = await call("/api/v1/quotations", {
    method: "POST", headers: { "Idempotency-Key": highValueQuotationKey },
    body: JSON.stringify({
      ...quotationPayload,
      notes: "Phase 10 exact-decimal precision regression",
      lines: [{ lineKind: "ITEM", description: "High-value precision regression", unitCode: "unit",
        quantity: "1.0000", unitPrice: "999999999999999.9999",
        discountType: "AMOUNT", discountValue: "0.0001", taxCode: quotationTaxCode }],
    }),
  }, quotationFinanceSession.jar);
  assert.equal(highValueQuotation.response.status, 201,
    "high-value quotation fixture must fit DECIMAL(19,4); response=" + JSON.stringify(highValueQuotation.body.error ?? highValueQuotation.body));
  assert.equal(highValueQuotation.body.data.grandTotal, "999999999999999.9998",
    "large quotation totals retain exact decimal precision");
  const highValueQuotationId = highValueQuotation.body.data.id;
  const highValueQuotationList = await call(
    "/api/v1/quotations?status=DRAFT&query=" + encodeURIComponent(quotationCustomerName) + "&limit=25&offset=0",
    {}, quotationFinanceSession.jar,
  );
  assert.equal(highValueQuotationList.response.status, 200);
  const highValueQuotationRow = highValueQuotationList.body.data.find(row => row.id === highValueQuotationId);
  assert.ok(highValueQuotationRow, "quotation list includes the high-value precision fixture");
  assert.equal(highValueQuotationRow.taxableValue, "999999999999999.9998",
    "quotation-list taxable value uses exact decimal subtraction without IEEE-754 precision loss");

  const updatedQuotation = await call("/api/v1/quotations/" + quotationId, {
    method: "PATCH", body: JSON.stringify({ ...quotationPayload, notes: "Updated quote API test", expectedVersion: 1 }),
  }, quotationFinanceSession.jar);
  assert.equal(updatedQuotation.response.status, 200, "quotation draft update succeeds with its current record version");
  assert.equal(updatedQuotation.body.data.recordVersion, 2);
  assert.equal(updatedQuotation.body.data.grandTotal, "36.0000");
  const staleQuotation = await call("/api/v1/quotations/" + quotationId, {
    method: "PATCH", body: JSON.stringify({ ...quotationPayload, expectedVersion: 1 }),
  }, quotationFinanceSession.jar);
  assert.equal(staleQuotation.response.status, 409, "stale quotation edit is rejected");

  const cancelQuotation = await call("/api/v1/quotations/" + quotationId + "/status", {
    method: "POST", body: JSON.stringify({ status: "CANCELLED", expectedVersion: 2, reason: "CI quotation lifecycle test" }),
  }, quotationFinanceSession.jar);
  assert.equal(cancelQuotation.response.status, 200);
  assert.equal(cancelQuotation.body.data.status, "CANCELLED");
  const cancelledQuotation = await call("/api/v1/quotations/" + quotationId, {}, quotationFinanceSession.jar);
  assert.equal(cancelledQuotation.response.status, 200);
  assert.equal(cancelledQuotation.body.data.status, "CANCELLED");

  // Pack 2: use public lifecycle endpoints to prove sent quotation identity is immutable.
  const snapshotQuote = await call("/api/v1/quotations", {
    method: "POST", headers: { "Idempotency-Key": "q-snapshot-" + randomUUID() },
    body: JSON.stringify({ ...quotationPayload, notes: "Pack 2 immutable quotation snapshot regression",
      lines: quotationPayload.lines.map(line => ({ ...line, taxCode: phase6bTaxCode })) }),
  }, quotationFinanceSession.jar);
  assert.equal(snapshotQuote.response.status, 201, "quotation snapshot fixture is created; response=" + JSON.stringify(snapshotQuote.body.error ?? snapshotQuote.body));
  const snapshotQuoteId = snapshotQuote.body.data.id;
  const snapshotOriginalName = quotationCustomerName;
  const sentSnapshotQuote = await call("/api/v1/quotations/" + snapshotQuoteId + "/status", {
    method: "POST", body: JSON.stringify({ status: "SENT", expectedVersion: 1 }),
  }, quotationFinanceSession.jar);
  assert.equal(sentSnapshotQuote.response.status, 200,
    "a valid quotation can be sent through its protected lifecycle endpoint: " + JSON.stringify(sentSnapshotQuote.body.error ?? null));
  assert.equal(sentSnapshotQuote.body.data.status, "SENT");
  assert.equal(sentSnapshotQuote.body.data.recordVersion, 2);
  const [storedQuotationSnapshotRows] = await db.execute(
    "SELECT customer_snapshot,supplier_snapshot,quotation_number FROM quotations WHERE id=?", [snapshotQuoteId],
  );
  assert.equal(storedQuotationSnapshotRows.length, 1);
  const storedCustomerSnapshot = typeof storedQuotationSnapshotRows[0].customer_snapshot === "string"
    ? JSON.parse(storedQuotationSnapshotRows[0].customer_snapshot) : storedQuotationSnapshotRows[0].customer_snapshot;
  const storedSupplierSnapshot = typeof storedQuotationSnapshotRows[0].supplier_snapshot === "string"
    ? JSON.parse(storedQuotationSnapshotRows[0].supplier_snapshot) : storedQuotationSnapshotRows[0].supplier_snapshot;
  assert.equal(storedCustomerSnapshot.name, snapshotOriginalName, "sending stores customer identity at send time");
  assert.ok(storedCustomerSnapshot.customerId === quotationCustomerId, "customer snapshot carries the stable customer reference");
  assert.ok(storedSupplierSnapshot && typeof storedSupplierSnapshot === "object", "sending stores issuer identity");
  assert.ok(storedQuotationSnapshotRows[0].quotation_number, "official quotation number is allocated only when sent");
  const [quotationConfigSnapshotRows] = await db.execute(
    "SELECT configuration_snapshot,configuration_sha256,numbering_config_id,template_id FROM document_configuration_snapshots WHERE resource_type='QUOTATION' AND resource_id=?",
    [snapshotQuoteId],
  );
  assert.equal(quotationConfigSnapshotRows.length, 1, "sent quotation must have exactly one immutable configuration snapshot");
  assert.equal(quotationConfigSnapshotRows[0].numbering_config_id, quotationNumberingResult.body.data.id,
    "sent quotation snapshot references the approved quotation-specific numbering series");
  assert.equal(quotationConfigSnapshotRows[0].template_id, phase6bQuotationTemplateId,
    "sent quotation snapshot references the approved quotation template");
  assert.match(String(quotationConfigSnapshotRows[0].configuration_sha256), /^[0-9a-f]{64}$/,
    "sent quotation snapshot has a SHA-256 integrity digest");
  const storedQuotationConfiguration = typeof quotationConfigSnapshotRows[0].configuration_snapshot === "string"
    ? JSON.parse(quotationConfigSnapshotRows[0].configuration_snapshot) : quotationConfigSnapshotRows[0].configuration_snapshot;
  assert.ok(storedQuotationConfiguration.legalEntityConfigVersion?.id,
    "sent quotation stores its legal-entity configuration version");
  assert.ok(storedQuotationConfiguration.selectedTaxRules?.some(row => row.id === phase6bTaxRuleId),
    "sent quotation snapshot includes its selected approved tax rule");
  assert.ok(storedQuotationConfiguration.selectedTaxRegistrations?.some(row => row.id === phase6bRegistrationId),
    "sent quotation snapshot includes the matching approved tax registration");
  const [customerSnapshotBeforeRename] = await db.execute(
    "SELECT name,record_version FROM customers WHERE id=?", [quotationCustomerId],
  );
  assert.equal(customerSnapshotBeforeRename.length, 1);
  const snapshotCustomerOriginalName = String(customerSnapshotBeforeRename[0].name);
  const renamedSnapshotCustomerName = snapshotCustomerOriginalName + " updated after quotation sent";
  try {
    const renameSnapshotCustomer = await call("/api/v1/customers/" + quotationCustomerId, {
      method: "PATCH", body: JSON.stringify({ expectedVersion: Number(customerSnapshotBeforeRename[0].record_version), name: renamedSnapshotCustomerName }),
    }, quotationFinanceSession.jar);
    assert.equal(renameSnapshotCustomer.response.status, 200,
      "customer rename succeeds through the customer API after sending a quotation");
    const snapshotDetailAfterRename = await call("/api/v1/quotations/" + snapshotQuoteId, {}, quotationFinanceSession.jar);
    assert.equal(snapshotDetailAfterRename.response.status, 200);
    assert.equal(snapshotDetailAfterRename.body.data.customerName, snapshotOriginalName,
      "sent quotation detail displays the stored customer snapshot after the live customer changes");
    assert.equal(snapshotDetailAfterRename.body.data.customerSnapshot.name, snapshotOriginalName);
    const snapshotListByOriginalName = await call(
      "/api/v1/quotations?status=SENT&query=" + encodeURIComponent(snapshotOriginalName) + "&customerId=" + quotationCustomerId + "&limit=25&offset=0",
      {}, quotationFinanceSession.jar,
    );
    assert.equal(snapshotListByOriginalName.response.status, 200);
    const snapshotListRow = snapshotListByOriginalName.body.data.find(row => row.id === snapshotQuoteId);
    assert.ok(snapshotListRow, "sent quotation remains searchable by its frozen customer name and customerId");
    assert.equal(snapshotListRow.customerName, snapshotOriginalName,
      "sent quotation list displays the customer name frozen at send time");
    const snapshotListByNewName = await call(
      "/api/v1/quotations?status=SENT&query=" + encodeURIComponent(renamedSnapshotCustomerName) + "&limit=25&offset=0",
      {}, quotationFinanceSession.jar,
    );
    assert.equal(snapshotListByNewName.response.status, 200);
    const matchingRenamedSnapshot = snapshotListByNewName.body.data.find(row => row.id === snapshotQuoteId);
    assert.ok(matchingRenamedSnapshot, "search by current customer name still finds the historical quotation");
    assert.equal(matchingRenamedSnapshot.customerName, snapshotOriginalName,
      "searching by a current name does not rewrite the historical display name");
    const attemptedSentQuoteEdit = await call("/api/v1/quotations/" + snapshotQuoteId, {
      method: "PATCH", body: JSON.stringify({ ...quotationPayload, expectedVersion: 2 }),
    }, quotationFinanceSession.jar);
    assert.equal(attemptedSentQuoteEdit.response.status, 409, "sent quotation cannot be edited through draft update API");
    assert.equal(attemptedSentQuoteEdit.body.error.code, "QUOTATION_NOT_EDITABLE");
    const acceptSnapshotQuote = await call("/api/v1/quotations/" + snapshotQuoteId + "/status", {
      method: "POST", body: JSON.stringify({ status: "ACCEPTED", expectedVersion: 2 }),
    }, quotationFinanceSession.jar);
    assert.equal(acceptSnapshotQuote.response.status, 200, "sent quotation can be accepted with its current version");
    assert.equal(acceptSnapshotQuote.body.data.status, "ACCEPTED");
    assert.equal(acceptSnapshotQuote.body.data.recordVersion, 3);
    const staleAcceptedStatus = await call("/api/v1/quotations/" + snapshotQuoteId + "/status", {
      method: "POST", body: JSON.stringify({ status: "CANCELLED", expectedVersion: 2, reason: "stale regression" }),
    }, quotationFinanceSession.jar);
    assert.equal(staleAcceptedStatus.response.status, 409, "stale status transition cannot overwrite a newer accepted state");
    assert.equal(staleAcceptedStatus.body.error.code, "VERSION_CONFLICT");
    const snapshotDetailAfterAccept = await call("/api/v1/quotations/" + snapshotQuoteId, {}, quotationFinanceSession.jar);
    assert.equal(snapshotDetailAfterAccept.body.data.status, "ACCEPTED");
    assert.equal(snapshotDetailAfterAccept.body.data.customerName, snapshotOriginalName);
  } finally {
    await db.execute("UPDATE customers SET name=?,record_version=record_version+1 WHERE id=?",
      [snapshotCustomerOriginalName, quotationCustomerId]);
  }

  // Pack 2: list, detail and status transitions must agree on the legal entity's business date.
  const businessDateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const quotationBusinessToday = businessDateParts.find(part => part.type === "year")?.value + "-" +
    businessDateParts.find(part => part.type === "month")?.value + "-" +
    businessDateParts.find(part => part.type === "day")?.value;
  const quotationYesterdayDate = new Date(quotationBusinessToday + "T00:00:00.000Z");
  quotationYesterdayDate.setUTCDate(quotationYesterdayDate.getUTCDate() - 1);
  const quotationYesterday = quotationYesterdayDate.toISOString().slice(0, 10);
  const expiredFixture = await call("/api/v1/quotations", {
    method: "POST", headers: { "Idempotency-Key": "q-expiry-" + randomUUID() },
    body: JSON.stringify({ ...quotationPayload, notes: "Pack 2 quotation expiry fixture" }),
  }, quotationFinanceSession.jar);
  assert.equal(expiredFixture.response.status, 201, "expiry fixture quotation can be created");
  const expiredQuotationId = expiredFixture.body.data.id;
  const sentExpiryFixture = await call("/api/v1/quotations/" + expiredQuotationId + "/status", {
    method: "POST", body: JSON.stringify({ status: "SENT", expectedVersion: 1 }),
  }, quotationFinanceSession.jar);
  assert.equal(sentExpiryFixture.response.status, 200,
    "expiry fixture follows the protected DRAFT to SENT transition before the simulated passage of time");
  assert.equal(sentExpiryFixture.body.data.status, "SENT");
  // Advance the fixture beyond its validity period to model time passing. Keep lifecycle status/version
  // untouched; the application must derive EXPIRED consistently from the entity's business date.
  await db.execute(
    "UPDATE quotations SET valid_until=? WHERE id=? AND status='SENT'",
    [quotationYesterday, expiredQuotationId],
  );
  const expiredDetail = await call("/api/v1/quotations/" + expiredQuotationId, {}, quotationFinanceSession.jar);
  assert.equal(expiredDetail.response.status, 200);
  assert.equal(expiredDetail.body.data.status, "EXPIRED",
    "quotation detail labels a sent quotation expired after the entity business date passes validUntil");
  const expiredList = await call(
    "/api/v1/quotations?status=EXPIRED&query=" + encodeURIComponent(quotationCustomerName) + "&limit=25&offset=0",
    {}, quotationFinanceSession.jar,
  );
  assert.equal(expiredList.response.status, 200);
  assert.ok(expiredList.body.data.some(row => row.id === expiredQuotationId),
    "quotation list expiry filter agrees with quotation detail");
  const sentList = await call(
    "/api/v1/quotations?status=SENT&query=" + encodeURIComponent(quotationCustomerName) + "&limit=25&offset=0",
    {}, quotationFinanceSession.jar,
  );
  assert.equal(sentList.response.status, 200);
  assert.equal(sentList.body.data.some(row => row.id === expiredQuotationId), false,
    "expired quotations no longer appear under the SENT status filter");
  const acceptExpired = await call("/api/v1/quotations/" + expiredQuotationId + "/status", {
    method: "POST", body: JSON.stringify({ status: "ACCEPTED", expectedVersion: 2 }),
  }, quotationFinanceSession.jar);
  assert.equal(acceptExpired.response.status, 409, "an expired quotation cannot be accepted");
  assert.equal(acceptExpired.body.error.code, "INVALID_STATUS_TRANSITION");
  // Pack 2: conversion must be atomic and idempotent even when two retries race.
  // This is a CI-only accepted-quotation state fixture: quote status transition gates are
  // separately tested by the quotation status route; this test isolates conversion behavior.
  const conversionQuotationKey = "q-convert-source-" + suffix;
  const conversionQuotation = await call("/api/v1/quotations", {
    method: "POST",
    headers: { "Idempotency-Key": conversionQuotationKey },
    body: JSON.stringify({ ...quotationPayload, notes: "Pack 2 concurrent conversion fixture",
      lines: quotationPayload.lines.map(line => ({ ...line, taxCode: phase6bTaxCode })) }),
  }, quotationFinanceSession.jar);
  assert.equal(conversionQuotation.response.status, 201,
    "conversion fixture quotation is created as a draft: " + JSON.stringify(conversionQuotation.body.error ?? null));
  const conversionQuotationId = conversionQuotation.body.data.id;
  const sendConversionQuote = await call("/api/v1/quotations/" + conversionQuotationId + "/status", {
    method: "POST", body: JSON.stringify({ status: "SENT", expectedVersion: 1 }),
  }, quotationFinanceSession.jar);
  assert.equal(sendConversionQuote.response.status, 200,
    "conversion fixture follows the public DRAFT to SENT transition: " + JSON.stringify(sendConversionQuote.body.error ?? null));
  assert.equal(sendConversionQuote.body.data.status, "SENT");
  const acceptConversionQuote = await call("/api/v1/quotations/" + conversionQuotationId + "/status", {
    method: "POST", body: JSON.stringify({ status: "ACCEPTED", expectedVersion: 2 }),
  }, quotationFinanceSession.jar);
  assert.equal(acceptConversionQuote.response.status, 200,
    "conversion fixture follows the public SENT to ACCEPTED transition: " + JSON.stringify(acceptConversionQuote.body.error ?? null));
  assert.equal(acceptConversionQuote.body.data.status, "ACCEPTED");
  const conversionIdempotencyKey = "q-convert-result-" + randomUUID();
  const concurrentConversions = await Promise.all([
    call("/api/v1/quotations/" + conversionQuotationId + "/convert", {
      method: "POST", headers: { "Idempotency-Key": conversionIdempotencyKey }, body: "{}",
    }, quotationFinanceSession.jar),
    call("/api/v1/quotations/" + conversionQuotationId + "/convert", {
      method: "POST", headers: { "Idempotency-Key": conversionIdempotencyKey }, body: "{}",
    }, quotationFinanceSession.jar),
  ]);
  assert.deepEqual(concurrentConversions.map(result => result.response.status).sort((a,b) => a-b), [200,201],
    "concurrent identical quotation conversion requests return one creation and one idempotent replay");
  const convertedInvoiceId = concurrentConversions[0].body.data.invoiceId;
  assert.ok(convertedInvoiceId, "conversion response includes the created invoice draft ID");
  assert.equal(concurrentConversions[1].body.data.invoiceId, convertedInvoiceId,
    "concurrent conversion requests resolve to the same invoice draft");
  assert.deepEqual(concurrentConversions.map(result => result.body.data.idempotentReplay).sort(), [false,true],
    "exactly one concurrent conversion creates the draft and the other is marked as a replay");
  const [convertedQuoteRows] = await db.execute(
    "SELECT status,converted_invoice_id,conversion_idempotency_key,record_version FROM quotations WHERE id=?",
    [conversionQuotationId],
  );
  assert.equal(convertedQuoteRows.length, 1);
  assert.equal(convertedQuoteRows[0].status, "CONVERTED");
  assert.equal(convertedQuoteRows[0].converted_invoice_id, convertedInvoiceId);
  assert.equal(convertedQuoteRows[0].conversion_idempotency_key, conversionIdempotencyKey);
  const [convertedInvoiceRows] = await db.execute(
    "SELECT lifecycle_status,related_invoice_id,grand_total,idempotency_key FROM invoices WHERE id=?",
    [convertedInvoiceId],
  );
  assert.equal(convertedInvoiceRows.length, 1);
  assert.equal(convertedInvoiceRows[0].lifecycle_status, "DRAFT",
    "quotation conversion creates a draft and never issues an invoice implicitly");
  assert.equal(convertedInvoiceRows[0].idempotency_key, conversionIdempotencyKey);
  assert.equal(String(convertedInvoiceRows[0].grand_total), conversionQuotation.body.data.grandTotal,
    "conversion preserves the accepted quotation's calculated amount after fresh approved-tax recalculation");
  const [[convertedInvoiceCount]] = await db.execute(
    "SELECT COUNT(*) AS total FROM invoices WHERE idempotency_key=?",
    [conversionIdempotencyKey],
  );
  assert.equal(Number(convertedInvoiceCount.total), 1, "concurrent conversion creates exactly one invoice row");
  const [[convertedAuditCount]] = await db.execute(
    "SELECT COUNT(*) AS total FROM audit_events WHERE entity_type='invoice' AND entity_id=? AND action='invoice.draft.created'",
    [convertedInvoiceId],
  );
  assert.equal(Number(convertedAuditCount.total), 1, "the converted draft has exactly one creation audit event");
  const differentConversionKey = await call("/api/v1/quotations/" + conversionQuotationId + "/convert", {
    method: "POST", headers: { "Idempotency-Key": "q-convert-different-" + randomUUID() }, body: "{}",
  }, quotationFinanceSession.jar);
  assert.equal(differentConversionKey.response.status, 409,
    "a converted quotation cannot create another invoice using a different idempotency key");
  assert.equal(differentConversionKey.body.error.code, "DUPLICATE_SUBMISSION");
  const [invoiceCountAfterDifferentKey] = await db.execute(
    "SELECT COUNT(*) AS total FROM invoices WHERE idempotency_key=?",
    [conversionIdempotencyKey],
  );
  assert.equal(Number(invoiceCountAfterDifferentKey[0].total), 1,
    "a conflicting conversion retry does not create a second invoice");

  // Invalid entity timezones must block conversion rather than silently use the server's UTC date.
  const invalidZoneQuote = await call("/api/v1/quotations", {
    method: "POST",
    headers: { "Idempotency-Key": "q-invalid-zone-source-" + randomUUID() },
    body: JSON.stringify({ ...quotationPayload, notes: "Pack 2 invalid timezone conversion regression",
      lines: quotationPayload.lines.map(line => ({ ...line, taxCode: phase6bTaxCode })) }),
  }, quotationFinanceSession.jar);
  assert.equal(invalidZoneQuote.response.status, 201, "invalid-timezone conversion fixture is created");
  const invalidZoneQuoteId = invalidZoneQuote.body.data.id;
  const sendInvalidZoneQuote = await call("/api/v1/quotations/" + invalidZoneQuoteId + "/status", {
    method: "POST", body: JSON.stringify({ status: "SENT", expectedVersion: 1 }),
  }, quotationFinanceSession.jar);
  assert.equal(sendInvalidZoneQuote.response.status, 200,
    "invalid-timezone fixture follows the normal send transition before changing test configuration");
  const acceptInvalidZoneQuote = await call("/api/v1/quotations/" + invalidZoneQuoteId + "/status", {
    method: "POST", body: JSON.stringify({ status: "ACCEPTED", expectedVersion: 2 }),
  }, quotationFinanceSession.jar);
  assert.equal(acceptInvalidZoneQuote.response.status, 200);
  const [priorTimeZoneRows] = await db.execute(
    "SELECT time_zone FROM legal_entities WHERE id=?", [entityA.id],
  );
  assert.equal(priorTimeZoneRows.length, 1);
  const priorTimeZone = priorTimeZoneRows[0].time_zone ?? null;
  const invalidZoneConversionKey = "q-convert-invalid-zone-" + randomUUID();
  try {
    await db.execute("UPDATE legal_entities SET time_zone='Invalid/Timezone' WHERE id=?", [entityA.id]);
    const invalidZoneConversion = await call("/api/v1/quotations/" + invalidZoneQuoteId + "/convert", {
      method: "POST", headers: { "Idempotency-Key": invalidZoneConversionKey }, body: "{}",
    }, quotationFinanceSession.jar);
    assert.equal(invalidZoneConversion.response.status, 409,
      "quotation conversion must fail closed when the legal entity timezone is invalid");
    assert.equal(invalidZoneConversion.body.error.code, "CONFIGURATION_NOT_READY");
    const [invalidZoneQuoteState] = await db.execute(
      "SELECT status,converted_invoice_id FROM quotations WHERE id=?", [invalidZoneQuoteId],
    );
    assert.equal(invalidZoneQuoteState[0].status, "ACCEPTED", "failed timezone validation preserves the accepted quotation");
    assert.equal(invalidZoneQuoteState[0].converted_invoice_id, null, "failed timezone validation does not mark the quotation converted");
    const [[invalidZoneInvoiceCount]] = await db.execute(
      "SELECT COUNT(*) AS total FROM invoices WHERE idempotency_key=?", [invalidZoneConversionKey],
    );
    assert.equal(Number(invalidZoneInvoiceCount.total), 0, "invalid timezone creates no invoice draft");
  } finally {
    await db.execute("UPDATE legal_entities SET time_zone=? WHERE id=?", [priorTimeZone, entityA.id]);
  }
  console.log("PASS: Pack 2 quotation conversion fails closed on an invalid entity timezone and leaves no draft behind.");
  console.log("PASS: Pack 2 quotation conversion tests cover concurrent retries, one-draft invariant, same-key replay, different-key conflict, timezone readiness, preserved totals and creation audit evidence.");

  console.log("PASS: Phase 10 quotation API covers scoped draft create, exact totals, idempotent replay, detail/list, optimistic-concurrency update, stale-write rejection and reasoned cancellation.");


  const customerCodeSearch = await call("/api/v1/customers?query=" + encodeURIComponent(phase7CustomerCode) + "&status=active&limit=10&offset=0", {}, financeSession.jar);
  assert.equal(customerCodeSearch.response.status, 200);
  assert.ok(customerCodeSearch.body.data.some(row => row.id === phase7CustomerId), "customer search matches normalized customer code");
  const excessiveCustomerLimit = await call("/api/v1/customers?limit=101", {}, financeSession.jar);
  assert.equal(excessiveCustomerLimit.response.status, 400, "customer pagination limit is server-capped");
  const excessiveCustomerOffset = await call("/api/v1/customers?offset=1000001", {}, financeSession.jar);
  assert.equal(excessiveCustomerOffset.response.status, 400, "customer pagination offset is bounded");
  const privilegedTaxSearch = await call("/api/v1/customers?query=" + encodeURIComponent("TAX-" + suffix) + "&status=all", {}, financeSession.jar);
  assert.ok(privilegedTaxSearch.body.data.some(row => row.id === phase7CustomerId), "finance/settings admins can search customer tax identifiers");
  const restrictedTaxSearch = await call("/api/v1/customers?query=" + encodeURIComponent("TAX-" + suffix) + "&status=all", {}, staffSession.jar);
  assert.equal(restrictedTaxSearch.response.status, 200);
  assert.equal(restrictedTaxSearch.body.meta.pagination.total, 0, "ordinary customer readers cannot search for restricted tax identifier values");

  const scopedFinance = await seedUser("finance_admin", "scoped-finance-" + suffix + "@example.invalid", "ACTIVE",
    "Scoped Finance Strong Password #7!", [testLegalEntityId]);
  const scopedFinanceSession = await login(scopedFinance);
  const linkedInvoiceId = randomUUID();
  await db.execute(
    "INSERT INTO invoices (id,legal_entity_id,customer_id,document_type,lifecycle_status,currency,grand_total) VALUES (?, ?, ?, 'INVOICE', 'DRAFT', 'INR', '24.6800')",
    [linkedInvoiceId, testLegalEntityId, phase7CustomerId],
  );
  const linkedInvoiceLineId = randomUUID();
  await db.execute(
    "INSERT INTO invoice_lines (id,invoice_id,catalog_item_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_amount,line_total) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [linkedInvoiceLineId, linkedInvoiceId, item.body.data.id, "Phase 05 CI service", "2.0000", "12.3400", "0.0000", "0.000000", null, null, "0.0000", "24.6800"],
  );
  const linkedQuotationId = randomUUID();
  await db.execute(
    "INSERT INTO quotations (id,legal_entity_id,customer_id,status,currency,grand_total) VALUES (?, ?, ?, 'DRAFT', 'INR', '49.0000')",
    [linkedQuotationId, testLegalEntityId, phase7CustomerId],
  );

  const unprivilegedSensitiveCreate = await call("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({ name: "Forbidden Tax Customer " + suffix, taxIdentifiers: [{ identifierType: "OTHER", countryCode: "IN", identifierValue: "FORBIDDEN-TAX-" + suffix }] }),
  }, staffSession.jar);
  assert.equal(unprivilegedSensitiveCreate.response.status, 403, "customer writers without settings:manage cannot create restricted tax identifiers");
  const unprivilegedSensitiveUpdate = await call("/api/v1/customers/" + phase7CustomerId, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: 1, taxIdentifiers: [{ identifierType: "OTHER", countryCode: "IN", identifierValue: "FORBIDDEN-UPDATE-" + suffix }] }),
  }, staffSession.jar);
  assert.equal(unprivilegedSensitiveUpdate.response.status, 403, "customer writers without settings:manage cannot replace restricted tax identifiers");
  const unprivilegedSensitiveImport = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" },
    body: "name,taxIdentifier\r\nForbidden import,FORBIDDEN-CSV-" + suffix,
  }, staffSession.jar);
  assert.equal(unprivilegedSensitiveImport.response.status, 403, "customer CSV imports enforce sensitive-field permission server-side");
  const childTaxDuplicate = await call("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({ name: "Distinct Customer " + suffix, email: "distinct-" + suffix + "@example.invalid",
      taxIdentifiers: [{ identifierType: "OTHER", countryCode: "IN", identifierValue: "TAX-" + suffix }] }),
  }, financeSession.jar);
  assert.equal(childTaxDuplicate.response.status, 201);
  assert.ok(childTaxDuplicate.body.duplicateWarnings?.some(w => w.id === phase7CustomerId && w.matchOn?.includes("taxIdentifier")),
    "duplicate detection includes normalized child tax identifiers, not only the legacy primary field");
  const duplicateCustomer = await call("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({ name: phase7CustomerName, email: "phase7-" + suffix + "@example.invalid" }),
  }, financeSession.jar);
  assert.equal(duplicateCustomer.response.status, 201, "potential duplicates are warnings and do not silently merge or prevent deliberate creation");
  assert.ok(duplicateCustomer.body.duplicateWarnings?.some((warning) => warning.id === phase7CustomerId),
    "customer create returns duplicate candidates for an explicit user decision");

  for (const [label, billingAddress] of [
    ["unknown address keys", { line1: "Strict address", county: "Not a reviewed key" }],
    ["address lines over 255 characters", { line1: "X".repeat(256) }],
    ["lower-case or three-letter country codes", { line1: "Strict address", countryCode: "in" }],
    ["non-string address values", { line1: { nested: true } }],
  ]) {
    const rejected = await call("/api/v1/customers", {
      method: "POST", body: JSON.stringify({ name: "Strict address " + suffix, billingAddress }),
    }, financeSession.jar);
    assert.equal(rejected.response.status, 422, "customer address rejects " + label);
  }

  const phase7Detail = await call("/api/v1/customers/" + phase7CustomerId, {}, financeSession.jar);
  assert.equal(phase7Detail.response.status, 200);
  assert.equal(phase7Detail.body.data.contacts[0].fullName, "Phase 7 Contact");
  assert.equal(phase7Detail.body.data.taxIdentifiers[0].identifierValue, "TAX-" + suffix);
  assert.equal(phase7Detail.body.data.billingAddress.city, "Pune");
  assert.equal(phase7Detail.body.data.shippingAddress.postalCode, "411002");
  assert.equal(phase7Detail.body.data.recordVersion, 1);

  assert.equal(phase7Detail.body.data.referenceCounts.invoices, null, "invoice counts remain hidden without legal-entity scope");
  assert.equal(phase7Detail.body.data.referenceCounts.quotations, null, "quotation counts remain hidden without legal-entity scope");
  assert.equal(phase7Detail.body.data.referenceCounts.payments, null, "payment counts remain hidden when legal-entity attribution cannot be established");
  assert.equal("linkedInvoices" in phase7Detail.body.data, false, "linked invoice metadata is not exposed without legal-entity scope");
  const scopedCustomerDetail = await call("/api/v1/customers/" + phase7CustomerId, {}, scopedFinanceSession.jar);
  assert.equal(scopedCustomerDetail.response.status, 200);
  assert.equal(scopedCustomerDetail.body.data.referenceCounts.invoices, 1);
  assert.equal(scopedCustomerDetail.body.data.referenceCounts.quotations, 1);
  assert.equal(scopedCustomerDetail.body.data.referenceCounts.payments, null, "entity scope alone cannot scope payments without payment-level entity attribution");
  assert.ok(scopedCustomerDetail.body.data.linkedInvoices.some(invoice => invoice.id === linkedInvoiceId),
    "authorized users see linked invoices only within their legal-entity scope");
  assert.ok(scopedCustomerDetail.body.data.linkedQuotations.some(quotation => quotation.id === linkedQuotationId),
    "authorized users see linked quotations only within their legal-entity scope");

  const updatedCustomer = await call("/api/v1/customers/" + phase7CustomerId, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: 1, name: phase7CustomerName + " Updated",
      billingAddress: null, purchaseOrderReference: "CI-PO-UPDATED-" + suffix,
      contacts: [{ fullName: "Updated CI Contact", email: "updated-" + suffix + "@example.invalid", isPrimary: true }],
      taxIdentifiers: [{ identifierType: "OTHER", countryCode: "IN", jurisdiction: "CI only", identifierValue: "TAX-UPDATED-" + suffix }],
    }),
  }, financeSession.jar);
  assert.equal(updatedCustomer.response.status, 200, "customer PATCH supports versioned updates and child record replacement");
  assert.equal(updatedCustomer.body.data.recordVersion, 2);
  assert.equal(updatedCustomer.body.data.name, phase7CustomerName + " Updated");
  assert.ok(updatedCustomer.body.duplicateWarnings);
  const [customerUpdateAudit] = await db.execute(
    "SELECT after_json FROM audit_events WHERE entity_type='customer' AND entity_id=? AND action='customer.updated' ORDER BY created_at DESC LIMIT 1",
    [phase7CustomerId]);
  const customerUpdateAfter = typeof customerUpdateAudit[0].after_json === "string" ? JSON.parse(customerUpdateAudit[0].after_json) : customerUpdateAudit[0].after_json;
  assert.deepEqual([...customerUpdateAfter.changedFields].sort(), ["billingAddress", "contacts", "name", "purchaseOrderReference", "taxIdentifiers"],
    "customer update audit lists exactly the fields that changed");
  const [contactRowsBefore] = await db.execute("SELECT id FROM customer_contacts WHERE customer_id=? ORDER BY id", [phase7CustomerId]);
  const [taxRowsBefore] = await db.execute("SELECT id FROM customer_tax_identifiers WHERE customer_id=? ORDER BY id", [phase7CustomerId]);
  const [[auditCountBefore]] = await db.execute("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='customer' AND entity_id=?", [phase7CustomerId]);
  const unchangedCustomer = await call("/api/v1/customers/" + phase7CustomerId, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: 2, name: phase7CustomerName + " Updated", purchaseOrderReference: "CI-PO-UPDATED-" + suffix, billingAddress: null,
      contacts: [{ fullName: "Updated CI Contact", email: "UPDATED-" + suffix + "@example.invalid", isPrimary: true }],
      taxIdentifiers: [{ identifierType: "other", countryCode: "IN", jurisdiction: "CI only", identifierValue: "TAX-UPDATED-" + suffix }],
    }),
  }, financeSession.jar);
  assert.equal(unchangedCustomer.response.status, 200, "resubmitting identical customer values succeeds");
  assert.equal(unchangedCustomer.body.data.unchanged, true);
  assert.equal(unchangedCustomer.body.data.recordVersion, 2, "an unchanged customer does not advance its version");
  const [contactRowsAfter] = await db.execute("SELECT id FROM customer_contacts WHERE customer_id=? ORDER BY id", [phase7CustomerId]);
  const [taxRowsAfter] = await db.execute("SELECT id FROM customer_tax_identifiers WHERE customer_id=? ORDER BY id", [phase7CustomerId]);
  assert.deepEqual(contactRowsAfter, contactRowsBefore, "unchanged contacts are not deleted and recreated");
  assert.deepEqual(taxRowsAfter, taxRowsBefore, "unchanged tax identifiers are not deleted and recreated");
  const [[auditCountAfter]] = await db.execute("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='customer' AND entity_id=?", [phase7CustomerId]);
  assert.equal(Number(auditCountAfter.n), Number(auditCountBefore.n), "an unchanged customer update writes no audit event");
  const staleCustomerUpdate = await call("/api/v1/customers/" + phase7CustomerId, {
    method: "PATCH", body: JSON.stringify({ expectedVersion: 1, name: "Stale customer overwrite" }),
  }, financeSession.jar);
  assert.equal(staleCustomerUpdate.response.status, 409, "stale customer edit is rejected rather than overwriting newer data");

  // Link a receipt so archive has to preserve and report a historical relationship.
  await db.execute(
    "INSERT INTO payments (id,customer_id,amount,currency,payment_date,method,status,recorded_by) VALUES (?,?,?, ?,CURDATE(),'OTHER','RECORDED',?)",
    [randomUUID(), phase7CustomerId, "10.0000", "INR", financeAdmin.userId],
  );
  // Archive counts follow the customer-detail rule: only a caller with read permission and legal-entity scope sees them.
  const archivedCustomer = await call("/api/v1/customers/" + phase7CustomerId + "/archive", {
    method: "POST", body: JSON.stringify({ expectedVersion: 2, reason: "Phase 7 CI archive acceptance" }),
  }, scopedFinanceSession.jar);
  assert.equal(archivedCustomer.response.status, 200, "archive is a soft archive and preserves linked historic records");
  assert.equal(archivedCustomer.body.data.isActive, false);
  assert.equal(archivedCustomer.body.data.referenceCounts.payments, null, "archive response never exposes an unscoped payment total");
  assert.equal(archivedCustomer.body.data.referenceCounts.invoices, 1);
  assert.equal(archivedCustomer.body.data.referenceCounts.quotations, 1);
  const archivedCustomerDetail = await call("/api/v1/customers/" + phase7CustomerId, {}, financeSession.jar);
  assert.equal(archivedCustomerDetail.response.status, 200, "archived customers remain accessible for historic references");
  assert.equal(archivedCustomerDetail.body.data.isActive, false);
  const archivedCustomerList = await call("/api/v1/customers?query=" + encodeURIComponent(phase7CustomerName + " Updated") + "&status=archived", {}, financeSession.jar);
  assert.equal(archivedCustomerList.response.status, 200);
  assert.ok(archivedCustomerList.body.data.some((row) => row.id === phase7CustomerId));
  const archivedCustomerUpdate = await call("/api/v1/customers/" + phase7CustomerId, {
    method: "PATCH", body: JSON.stringify({ expectedVersion: 3, name: "Cannot edit archived customer" }),
  }, financeSession.jar);
  assert.equal(archivedCustomerUpdate.response.status, 409, "archived customer cannot be edited as active master data");

  // Phase 7: catalog detail/update/soft archive, exact decimal serialization and duplicate code rejection.
  const itemDetail = await call("/api/v1/catalog/items/" + item.body.data.id, {}, financeSession.jar);
  assert.equal(itemDetail.response.status, 200);
  assert.equal(itemDetail.body.data.recordVersion, 1);
  assert.equal(itemDetail.body.data.referenceCounts.invoiceLines, null, "catalog invoice-line counts are hidden without legal-entity scope");
  assert.equal(itemDetail.body.data.referenceCounts.quotationLines, null, "catalog quotation-line counts are hidden without legal-entity scope");
  const scopedItemDetail = await call("/api/v1/catalog/items/" + item.body.data.id, {}, scopedFinanceSession.jar);
  assert.equal(scopedItemDetail.body.data.referenceCounts.invoiceLines, 1, "scoped readers see invoice lines in their legal entities");
  assert.equal(scopedItemDetail.body.data.referenceCounts.quotationLines, 0);
  const itemUpdated = await call("/api/v1/catalog/items/" + item.body.data.id, {
    method: "PATCH", body: JSON.stringify({ expectedVersion: 1, name: "Phase 07 Updated Service " + suffix, defaultUnitPrice: "12.3401" }),
  }, financeSession.jar);
  assert.equal(itemUpdated.response.status, 200);
  assert.equal(itemUpdated.body.data.recordVersion, 2);
  assert.equal(itemUpdated.body.data.defaultUnitPrice, "12.3401");
  const [itemUpdateAudit] = await db.execute(
    "SELECT before_json,after_json FROM audit_events WHERE entity_type='catalog_item' AND entity_id=? AND action='catalog_item.updated' ORDER BY created_at DESC LIMIT 1",
    [item.body.data.id]);
  const parseJsonColumn = (value) => typeof value === "string" ? JSON.parse(value) : value;
  const itemAuditBefore = parseJsonColumn(itemUpdateAudit[0].before_json);
  const itemAuditAfter = parseJsonColumn(itemUpdateAudit[0].after_json);
  assert.deepEqual([...itemAuditAfter.changedFields].sort(), ["defaultUnitPrice", "name"], "catalog audit lists only changed fields");
  assert.equal(itemAuditBefore.defaultUnitPrice, "12.3400", "catalog price change records the previous price");
  assert.equal(itemAuditAfter.defaultUnitPrice, "12.3401", "catalog price change records the new price");
  assert.equal("currency" in itemAuditAfter, false, "unchanged commercial fields are not recorded as changed");
  const unchangedItem = await call("/api/v1/catalog/items/" + item.body.data.id, {
    method: "PATCH", body: JSON.stringify({ expectedVersion: 2, defaultUnitPrice: "12.3401", currency: "INR" }),
  }, financeSession.jar);
  assert.equal(unchangedItem.response.status, 200);
  assert.equal(unchangedItem.body.data.unchanged, true, "resubmitting identical catalog values is a no-op");
  assert.equal(unchangedItem.body.data.recordVersion, 2);
  const [unchangedInvoiceLine] = await db.execute(
    "SELECT description,unit_price,line_total FROM invoice_lines WHERE id=?",
    [linkedInvoiceLineId],
  );
  assert.equal(unchangedInvoiceLine[0].description, "Phase 05 CI service", "editing the catalog must not rewrite an invoice-line description already copied into a document");
  assert.equal(unchangedInvoiceLine[0].unit_price, "12.3400", "editing a default catalog price must not rewrite an existing invoice line");
  assert.equal(unchangedInvoiceLine[0].line_total, "24.6800", "editing the catalog must not rewrite an existing line total");

  const staleItemUpdate = await call("/api/v1/catalog/items/" + item.body.data.id, {
    method: "PATCH", body: JSON.stringify({ expectedVersion: 1, name: "Stale item overwrite" }),
  }, financeSession.jar);
  assert.equal(staleItemUpdate.response.status, 409, "stale catalog edit is rejected");
  const duplicateItemCode = await call("/api/v1/catalog/items", {
    method: "POST", body: JSON.stringify({
      itemCode, itemType: "SERVICE", name: "Conflicting SKU", customerDescription: "Duplicate code test",
      unitCode: "unit", defaultUnitPrice: "1.0000", currency: "INR",
    }),
  }, financeSession.jar);
  assert.equal(duplicateItemCode.response.status, 409, "duplicate item/SKU codes are rejected by the server");
  const archivedItem = await call("/api/v1/catalog/items/" + item.body.data.id + "/archive", {
    method: "POST", body: JSON.stringify({ expectedVersion: 2, reason: "Phase 7 CI archive acceptance" }),
  }, financeSession.jar);
  assert.equal(archivedItem.response.status, 200);
  assert.equal(archivedItem.body.data.isActive, false);
  assert.equal(archivedItem.body.data.referenceCounts.invoiceLines, null, "archive response hides counts from an unscoped caller");
  const [itemArchiveAudit] = await db.execute(
    "SELECT after_json FROM audit_events WHERE entity_type='catalog_item' AND entity_id=? AND action='catalog_item.archived' LIMIT 1", [item.body.data.id]);
  assert.equal(parseJsonColumn(itemArchiveAudit[0].after_json).referenceCounts.invoiceLines, 1, "archive audit keeps the true reference totals");
  const archivedItemDetail = await call("/api/v1/catalog/items/" + item.body.data.id, {}, financeSession.jar);
  assert.equal(archivedItemDetail.response.status, 200, "archived catalog items stay readable for history");
  assert.equal(archivedItemDetail.body.data.isActive, false);
  const [customerAuditRows] = await db.execute(
    "SELECT action,after_json FROM audit_events WHERE entity_type='customer' AND entity_id=? ORDER BY created_at",
    [phase7CustomerId],
  );
  assert.ok(customerAuditRows.some((entry) => entry.action === "customer.updated"));
  assert.ok(customerAuditRows.some((entry) => entry.action === "customer.archived"));
  assert.equal(JSON.stringify(customerAuditRows).includes("TAX-UPDATED-" + suffix), false,
    "customer audit metadata logs changed field names, not tax identifier values");
  console.log("PASS: Phase 7 customer/catalog tests cover CRUD, contact/tax details, duplicate warnings, exact-decimal edits, optimistic concurrency, permissioned soft archive, historical references and audit redaction.");

  // Phase 7 CSV import/export: dry run never writes; commit is explicit and atomic; exports are permission-aware.
  const csvCell = (value) => `"${String(value).replaceAll('"','""')}"`;
  const csvCustomerCode = "CSV-" + suffix.toUpperCase();
  const csvCustomerPhone = "+91-9" + String(BigInt("0x" + suffix) % 1000000000n).padStart(9, "0");
  const [csvPhoneMatches] = await db.execute("SELECT id FROM customers WHERE phone=? LIMIT 1", [csvCustomerPhone]);
  assert.equal(csvPhoneMatches.length, 0, "CSV fixture phone number is unique for this run");
  const customerCsv = [
    "customerCode,name,email,phone,billingAddressJson,shippingAddressJson,purchaseOrderReference,paymentTermsDays,taxIdentifier",
    [csvCustomerCode, "CSV Import Customer " + suffix, "csv-" + suffix + "@example.invalid", csvCustomerPhone,
      JSON.stringify({line1:"CSV Address",city:"Pune",countryCode:"IN"}), "", "CSV-PO-" + suffix, "15", ""].map(csvCell).join(","),
  ].join("\r\n");
  const csvPreview = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: customerCsv,
  }, financeSession.jar);
  assert.equal(csvPreview.response.status, 200, "valid customer CSV previews without writes");
  assert.equal(csvPreview.body.data.valid, true);
  const csvBeforeCommit = await call("/api/v1/customers?query=" + encodeURIComponent(csvCustomerCode), {}, financeSession.jar);
  assert.equal(csvBeforeCommit.body.meta.pagination.total, 0, "validation-only CSV preview does not create rows");
  assert.match(csvPreview.body.data.validationToken, /^v1\.\d+\.[A-Za-z0-9_-]{43}$/, "validation returns a signed, short-lived commit token");
  const customerToken = csvPreview.body.data.validationToken;
  const financeSessionId = await sessionIdFor(financeSession);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenRejections = [
    ["direct commit without a validation token", "/api/v1/customers/import?mode=commit", null, 422, "VALIDATION_TOKEN_REQUIRED", financeSession],
    ["confirmDuplicates=true without a validation token", "/api/v1/customers/import?mode=commit&confirmDuplicates=true", null, 422, "VALIDATION_TOKEN_REQUIRED", financeSession],
    ["a token issued to another user and session", "/api/v1/customers/import?mode=commit", customerToken, 409, "VALIDATION_TOKEN_INVALID", staffSession],
    ["a token issued for the customer resource used on catalog import", "/api/v1/catalog/items/import?mode=commit", customerToken, 409, "VALIDATION_TOKEN_INVALID", financeSession],
    ["an expired token", "/api/v1/customers/import?mode=commit", mintImportToken({ resource: "customers", userId: financeAdmin.userId, sessionId: financeSessionId, csv: customerCsv, expiresAt: nowSeconds - 1 }), 409, "VALIDATION_TOKEN_EXPIRED", financeSession],
    ["a token whose expiry was edited", "/api/v1/customers/import?mode=commit", customerToken.replace(/^v1\.(\d+)\./, (_, exp) => "v1." + (Number(exp) + 3600) + "."), 409, "VALIDATION_TOKEN_INVALID", financeSession],
    ["a token signed with another secret", "/api/v1/customers/import?mode=commit", "v1." + (nowSeconds + 600) + "." + createHmac("sha256", "not-the-server-secret").update("x").digest("base64url"), 409, "VALIDATION_TOKEN_INVALID", financeSession],
  ];
  for (const [label, path, token, status, code, session] of tokenRejections) {
    const rejected = await call(path, { method: "POST", headers: importHeaders(token), body: customerCsv }, session.jar);
    assert.equal(rejected.response.status, status, "CSV commit rejects " + label);
    assert.equal(rejected.body.error.code, code, "CSV commit error code for " + label);
  }
  const tokenForOtherCsv = await call("/api/v1/customers/import?mode=commit", {
    method: "POST", headers: importHeaders(customerToken), body: customerCsv + "\r\n",
  }, financeSession.jar);
  assert.equal(tokenForOtherCsv.response.status, 409, "CSV commit rejects a token issued for different CSV bytes");
  assert.equal(tokenForOtherCsv.body.error.code, "VALIDATION_TOKEN_INVALID");
  const csvAfterRejections = await call("/api/v1/customers?query=" + encodeURIComponent(csvCustomerCode) + "&status=all", {}, financeSession.jar);
  assert.equal(csvAfterRejections.body.meta.pagination.total, 0, "rejected CSV commits write no rows");
  const csvCommitted = await call("/api/v1/customers/import?mode=commit", {
    method: "POST", headers: importHeaders(customerToken), body: customerCsv,
  }, financeSession.jar);
  assert.equal(csvCommitted.response.status, 201, "a separately requested valid CSV commit creates the records atomically");
  assert.equal(csvCommitted.body.data.createdCount, 1);
  const duplicateCustomerCsv = [
    "customerCode,name,email",
    ["CSV-DUP-" + suffix.toUpperCase(), phase7CustomerName + " Updated", "csv-duplicate-" + suffix + "@example.invalid"].map(csvCell).join(","),
  ].join("\r\n");
  const duplicateCustomerPreview = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: duplicateCustomerCsv,
  }, financeSession.jar);
  assert.equal(duplicateCustomerPreview.response.status, 200);
  assert.ok(duplicateCustomerPreview.body.data.duplicateWarnings.length, "customer import reports possible duplicate names");
  assert.equal(duplicateCustomerPreview.body.data.requiresDuplicateConfirmation, true);
  const duplicateCustomerToken = duplicateCustomerPreview.body.data.validationToken;
  const duplicateConfirmWithoutToken = await call("/api/v1/customers/import?mode=commit&confirmDuplicates=true", {
    method: "POST", headers: importHeaders(null), body: duplicateCustomerCsv,
  }, financeSession.jar);
  assert.equal(duplicateConfirmWithoutToken.response.status, 422, "duplicate confirmation alone cannot bypass validation");
  const duplicateCustomerBlocked = await call("/api/v1/customers/import?mode=commit", {
    method: "POST", headers: importHeaders(duplicateCustomerToken), body: duplicateCustomerCsv,
  }, financeSession.jar);
  assert.equal(duplicateCustomerBlocked.response.status, 409, "server blocks duplicate customer import until explicit confirmation");
  assert.equal(duplicateCustomerBlocked.body.error.code, "DUPLICATE_CONFIRMATION_REQUIRED");
  assert.equal(duplicateCustomerBlocked.body.data.requiresDuplicateConfirmation, true);
  const duplicateCustomerNotCreated = await call("/api/v1/customers?query=CSV-DUP-" + suffix.toUpperCase() + "&status=all", {}, financeSession.jar);
  assert.equal(duplicateCustomerNotCreated.body.meta.pagination.total, 0, "blocked duplicate import writes no rows");
  const duplicateCustomerConfirmed = await call("/api/v1/customers/import?mode=commit&confirmDuplicates=true", {
    method: "POST", headers: importHeaders(duplicateCustomerToken), body: duplicateCustomerCsv,
  }, financeSession.jar);
  assert.equal(duplicateCustomerConfirmed.response.status, 201, "explicitly confirmed duplicate customer import can commit atomically");

  const invalidCsvPreview = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" },
    body: "customerCode,name,paymentTermsDays\r\nBAD-ROW,Invalid Terms,70000",
  }, financeSession.jar);
  assert.equal(invalidCsvPreview.response.status, 422, "invalid CSV rows produce row-level validation reports");
  assert.equal(invalidCsvPreview.body.report.errors[0].rowNumber, 2);

  const duplicateHeaderCsv = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: "name,name\r\nFirst,Second",
  }, financeSession.jar);
  assert.equal(duplicateHeaderCsv.response.status, 422, "duplicate CSV headers must be rejected");
  assert.equal(duplicateHeaderCsv.body.error.code, "CSV_PARSE_ERROR");
  const unterminatedQuoteCsv = await call("/api/v1/catalog/items/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" },
    body: "itemType,name,customerDescription,unitCode,defaultUnitPrice,currency\r\nSERVICE,\"Unclosed,Description,unit,1.0000,INR",
  }, financeSession.jar);
  assert.equal(unterminatedQuoteCsv.response.status, 422, "unterminated quoted CSV fields must be rejected");
  assert.equal(unterminatedQuoteCsv.body.error.code, "CSV_PARSE_ERROR");

  const excessiveRowsCsv = "name,email\r\n" + Array.from({ length: 501 }, (_, index) =>
    "CSV row " + index + ",csv-row-" + index + "@example.invalid").join("\r\n");
  const excessiveRows = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: excessiveRowsCsv,
  }, financeSession.jar);
  assert.equal(excessiveRows.response.status, 422, "CSV imports reject more than 500 data rows");
  assert.equal(excessiveRows.body.error.code, "CSV_PARSE_ERROR");

  const oversizedCsv = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: "name\r\n" + "X".repeat(1_000_001),
  }, financeSession.jar);
  assert.equal(oversizedCsv.response.status, 413, "CSV imports reject files larger than one megabyte");
  assert.equal(oversizedCsv.body.error.code, "UPLOAD_TOO_LARGE");

  const atomicCodeA = "CSV-ATOMIC-A-" + suffix.toUpperCase();
  const atomicCodeB = "CSV-ATOMIC-B-" + suffix.toUpperCase();
  const invalidMultiRowCsv = [
    "customerCode,name,email",
    [atomicCodeA, "Valid row that must not be partially imported", "atomic-a-" + suffix + "@example.invalid"].map(csvCell).join(","),
    [atomicCodeB, "Invalid email row", "not-an-email"].map(csvCell).join(","),
  ].join("\r\n");
  const invalidMultiRowImport = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: invalidMultiRowCsv,
  }, financeSession.jar);
  assert.equal(invalidMultiRowImport.response.status, 422, "a multi-row file with any invalid row is rejected as a whole");
  const atomicCodeSearch = await call("/api/v1/customers?query=" + encodeURIComponent(atomicCodeA) + "&status=all", {}, financeSession.jar);
  assert.equal(atomicCodeSearch.body.meta.pagination.total, 0, "the valid row in a rejected multi-row import is not partially created");

  const customerExport = await fetch(new URL("/api/v1/customers/export?status=all", baseUrl), {
    headers: { Cookie: cookieHeader(financeSession.jar) }, cache: "no-store",
  });
  assert.equal(customerExport.status, 200, "authorized finance admin can export customer CSV");
  assert.match(customerExport.headers.get("content-type") ?? "", /text\/csv/i);
  const customerExportText = await customerExport.text();
  assert.ok(customerExportText.includes("customerCode,name,email"));
  assert.ok(customerExportText.includes(csvCustomerCode));
  const ordinaryExport = await fetch(new URL("/api/v1/customers/export?status=all", baseUrl), {
    headers: { Cookie: cookieHeader(staffSession.jar) }, cache: "no-store",
  });
  assert.equal(ordinaryExport.status, 200);
  const ordinaryExportText = await ordinaryExport.text();
  assert.doesNotMatch(ordinaryExportText.split("\r\n")[0], /internalNotes|taxIdentifier|contactsJson|taxIdentifiersJson/,
    "customer CSV does not include privileged notes or tax identifier columns for ordinary customer readers");

  // Formula escaping must keep spreadsheets inert and still round-trip exactly (phone numbers start with "+").
  const formulaName = "=Formula Co " + suffix;
  const formulaPhone = "+44 20 7946 " + suffix.slice(0, 4);
  const formulaCustomer = await call("/api/v1/customers", {
    method: "POST", body: JSON.stringify({ name: formulaName, phone: formulaPhone, purchaseOrderReference: "'=already quoted" }),
  }, financeSession.jar);
  assert.equal(formulaCustomer.response.status, 201);
  const formulaExport = await fetch(new URL("/api/v1/customers/export?status=all", baseUrl), {
    headers: { Cookie: cookieHeader(financeSession.jar) }, cache: "no-store",
  });
  const formulaExportLines = (await formulaExport.text()).split("\r\n");
  const formulaLine = formulaExportLines.find((line) => line.includes("'" + formulaName));
  assert.ok(formulaLine, "formula-like names are exported with a neutralising apostrophe");
  assert.ok(formulaLine.includes("'" + formulaPhone), "phone numbers starting with + are exported inert");
  assert.ok(formulaLine.includes("''=already quoted"), "values already starting with an apostrophe keep it after the escape");
  const roundTripCsv = formulaExportLines[0] + "\r\n" + formulaLine + "\r\n";
  const roundTripPreview = await call("/api/v1/customers/import?mode=validate", {
    method: "POST", headers: importHeaders(null), body: roundTripCsv,
  }, financeSession.jar);
  assert.equal(roundTripPreview.response.status, 200, "an exported row validates for re-import");
  const roundTripCommit = await call("/api/v1/customers/import?mode=commit&confirmDuplicates=true", {
    method: "POST", headers: importHeaders(roundTripPreview.body.data.validationToken), body: roundTripCsv,
  }, financeSession.jar);
  assert.equal(roundTripCommit.response.status, 201);
  const roundTripDetail = await call("/api/v1/customers/" + roundTripCommit.body.data.createdIds[0], {}, financeSession.jar);
  assert.equal(roundTripDetail.body.data.name, formulaName, "formula escape is removed on re-import");
  assert.equal(roundTripDetail.body.data.phone, formulaPhone, "phone numbers round-trip unchanged");
  assert.equal(roundTripDetail.body.data.purchaseOrderReference, "'=already quoted", "a leading apostrophe in the data survives the round trip");

  const csvItemCode = "CSV-ITEM-" + suffix.toUpperCase();
  const catalogCsv = [
    "itemCode,itemType,name,customerDescription,internalDescription,unitCode,defaultUnitPrice,currency,defaultTaxCode",
    [csvItemCode, "SERVICE", "CSV Catalog Service " + suffix, "CSV-only service description", "Internal CSV note",
      "hour", "7.2500", "INR", ""].map(csvCell).join(","),
  ].join("\r\n");
  const catalogPreview = await call("/api/v1/catalog/items/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: catalogCsv,
  }, financeSession.jar);
  assert.equal(catalogPreview.response.status, 200);
  assert.equal(catalogPreview.body.data.valid, true);
  const catalogWithoutToken = await call("/api/v1/catalog/items/import?mode=commit", {
    method: "POST", headers: importHeaders(null), body: catalogCsv,
  }, financeSession.jar);
  assert.equal(catalogWithoutToken.response.status, 422, "catalog commit without a validation token is rejected");
  const catalogExpired = await call("/api/v1/catalog/items/import?mode=commit", {
    method: "POST", headers: importHeaders(mintImportToken({ resource: "catalog", userId: financeAdmin.userId, sessionId: financeSessionId, csv: catalogCsv, expiresAt: Math.floor(Date.now() / 1000) - 1 })), body: catalogCsv,
  }, financeSession.jar);
  assert.equal(catalogExpired.response.status, 409, "catalog commit with an expired token is rejected");
  assert.equal(catalogExpired.body.error.code, "VALIDATION_TOKEN_EXPIRED");
  const catalogCommitted = await call("/api/v1/catalog/items/import?mode=commit", {
    method: "POST", headers: importHeaders(catalogPreview.body.data.validationToken), body: catalogCsv,
  }, financeSession.jar);
  assert.equal(catalogCommitted.response.status, 201);
  assert.equal(catalogCommitted.body.data.createdCount, 1);
  const duplicateCatalogCsv = [
    "itemCode,itemType,name,customerDescription,unitCode,defaultUnitPrice,currency",
    ["CSV-DUP-ITEM-" + suffix.toUpperCase(), "SERVICE", "Phase 07 Updated Service " + suffix, "Duplicate-name fixture", "hour", "5.0000", "INR"].map(csvCell).join(","),
  ].join("\r\n");
  const duplicateCatalogPreview = await call("/api/v1/catalog/items/import?mode=validate", {
    method: "POST", headers: { "Content-Type": "text/csv" }, body: duplicateCatalogCsv,
  }, financeSession.jar);
  assert.equal(duplicateCatalogPreview.response.status, 200);
  assert.ok(duplicateCatalogPreview.body.data.duplicateWarnings.length, "catalog import reports possible duplicate names");
  const duplicateCatalogToken = duplicateCatalogPreview.body.data.validationToken;
  const duplicateCatalogConfirmWithoutToken = await call("/api/v1/catalog/items/import?mode=commit&confirmDuplicates=true", {
    method: "POST", headers: importHeaders(null), body: duplicateCatalogCsv,
  }, financeSession.jar);
  assert.equal(duplicateCatalogConfirmWithoutToken.response.status, 422, "catalog duplicate confirmation alone cannot bypass validation");
  const duplicateCatalogBlocked = await call("/api/v1/catalog/items/import?mode=commit", {
    method: "POST", headers: importHeaders(duplicateCatalogToken), body: duplicateCatalogCsv,
  }, financeSession.jar);
  assert.equal(duplicateCatalogBlocked.response.status, 409, "server blocks duplicate catalog import until explicit confirmation");
  assert.equal(duplicateCatalogBlocked.body.error.code, "DUPLICATE_CONFIRMATION_REQUIRED");
  const duplicateCatalogConfirmed = await call("/api/v1/catalog/items/import?mode=commit&confirmDuplicates=true", {
    method: "POST", headers: importHeaders(duplicateCatalogToken), body: duplicateCatalogCsv,
  }, financeSession.jar);
  assert.equal(duplicateCatalogConfirmed.response.status, 201, "explicitly confirmed duplicate catalog import can commit atomically");

  const catalogExport = await fetch(new URL("/api/v1/catalog/items/export?status=all", baseUrl), {
    headers: { Cookie: cookieHeader(financeSession.jar) }, cache: "no-store",
  });
  assert.equal(catalogExport.status, 200);
  const catalogExportText = await catalogExport.text();
  assert.ok(catalogExportText.includes(csvItemCode));
  assert.ok(catalogExportText.includes("7.2500"), "catalog export retains exact decimal text");

  const formulaCatalogName = "=Catalog Formula " + suffix;
  const formulaCatalogDescription = "+Catalog description " + suffix;
  const formulaCatalogInternal = "@Internal catalog note " + suffix;
  const formulaCatalog = await call("/api/v1/catalog/items", {
    method: "POST",
    body: JSON.stringify({ itemType: "SERVICE", name: formulaCatalogName,
      customerDescription: formulaCatalogDescription, internalDescription: formulaCatalogInternal,
      unitCode: "unit", defaultUnitPrice: "9.1250", currency: "INR" }),
  }, financeSession.jar);
  assert.equal(formulaCatalog.response.status, 201, "catalog record with formula-leading text can be created");
  const formulaCatalogExport = await fetch(new URL("/api/v1/catalog/items/export?status=all", baseUrl), {
    headers: { Cookie: cookieHeader(financeSession.jar) }, cache: "no-store",
  });
  assert.equal(formulaCatalogExport.status, 200);
  const formulaCatalogLines = (await formulaCatalogExport.text()).split("\r\n");
  const formulaCatalogLine = formulaCatalogLines.find(line => line.includes("'" + formulaCatalogName));
  assert.ok(formulaCatalogLine, "catalog item names that resemble spreadsheet formulas are neutralized");
  assert.ok(formulaCatalogLine.includes("'" + formulaCatalogDescription), "catalog descriptions that begin with + are neutralized");
  assert.ok(formulaCatalogLine.includes("'" + formulaCatalogInternal), "privileged internal descriptions that begin with @ are neutralized");
  const formulaCatalogRoundTripCsv = formulaCatalogLines[0] + "\r\n" + formulaCatalogLine + "\r\n";
  const formulaCatalogPreview = await call("/api/v1/catalog/items/import?mode=validate", {
    method: "POST", headers: importHeaders(null), body: formulaCatalogRoundTripCsv,
  }, financeSession.jar);
  assert.equal(formulaCatalogPreview.response.status, 200, "formula-safe catalog export can be revalidated for import: " + JSON.stringify(formulaCatalogPreview.body));
  const formulaCatalogCommit = await call("/api/v1/catalog/items/import?mode=commit&confirmDuplicates=true", {
    method: "POST", headers: importHeaders(formulaCatalogPreview.body.data.validationToken), body: formulaCatalogRoundTripCsv,
  }, financeSession.jar);
  assert.equal(formulaCatalogCommit.response.status, 201, "confirmed exported catalog row can be round-tripped");
  const formulaCatalogDetail = await call("/api/v1/catalog/items/" + formulaCatalogCommit.body.data.createdIds[0], {}, financeSession.jar);
  assert.equal(formulaCatalogDetail.body.data.name, formulaCatalogName, "catalog name round-trips without formula escape");
  assert.equal(formulaCatalogDetail.body.data.customerDescription, formulaCatalogDescription, "catalog description round-trips unchanged");
  assert.equal(formulaCatalogDetail.body.data.internalDescription, formulaCatalogInternal, "privileged internal description round-trips unchanged");
  assert.equal(formulaCatalogDetail.body.data.defaultUnitPrice, "9.1250", "catalog price keeps exact four-place decimal formatting");

  // Pack 2: a sent invoice line is immutable even when its linked catalogue defaults are edited later.
  const pack2SnapshotCatalogItem = await call("/api/v1/catalog/items", {
    method: "POST",
    body: JSON.stringify({
      itemCode: "P2-SNAPSHOT-" + suffix.toUpperCase(), itemType: "SERVICE",
      name: "Pack 2 Snapshot Service " + suffix, customerDescription: "Original catalogue description",
      unitCode: "unit", defaultUnitPrice: "12.3400", currency: "INR", defaultTaxCode: phase6bTaxCode,
    }),
  }, financeSession.jar);
  assert.equal(pack2SnapshotCatalogItem.response.status, 201,
    "Pack 2 snapshot fixture creates a fresh active catalogue item through the API: " + JSON.stringify(pack2SnapshotCatalogItem.body.error ?? null));
  const pack2CatalogSnapshotDraft = await call("/api/v1/invoices", {
    method: "POST",
    headers: { "Idempotency-Key": "p2-catalog-snapshot-draft-" + randomUUID() },
    body: JSON.stringify({
      legalEntityId: entityA.id, brandId: null, customerId: quotationCustomerId, currency: "INR",
      invoiceDate: issueDate, dueDate: null, paymentTermsDays: 30, notes: "Pack 2 catalog snapshot regression",
      lines: [{
        catalogItemId: pack2SnapshotCatalogItem.body.data.id, lineKind: "ITEM", description: pack2SnapshotCatalogItem.body.data.name,
        unitCode: pack2SnapshotCatalogItem.body.data.unitCode, quantity: "1.0000", unitPrice: "12.3400",
        discountType: "AMOUNT", discountValue: "0.0000", taxCode: phase6bTaxCode,
      }],
    }),
  }, quotationFinanceSession.jar);
  assert.equal(pack2CatalogSnapshotDraft.response.status, 201,
    "Pack 2 catalogue-snapshot invoice draft is created through the API: " + JSON.stringify(pack2CatalogSnapshotDraft.body.error ?? null));
  const pack2CatalogSnapshotInvoiceId = pack2CatalogSnapshotDraft.body.data.id;
  const pack2CatalogSnapshotIssue = await call("/api/v1/invoices/" + pack2CatalogSnapshotInvoiceId + "/issue", {
    method: "POST", headers: { "Idempotency-Key": "p2-catalog-snapshot-issue-" + randomUUID() },
    body: JSON.stringify({ documentDate: issueDate }),
  }, quotationFinanceSession.jar);
  assert.equal(pack2CatalogSnapshotIssue.response.status, 200,
    "catalogue-linked invoice can be issued and snapshotted before catalogue master data is changed");
  const [[catalogSnapshotBefore]] = await db.execute(
    "SELECT configuration_sha256 FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [pack2CatalogSnapshotInvoiceId],
  );
  assert.ok(catalogSnapshotBefore?.configuration_sha256, "catalogue-linked issued invoice has a configuration snapshot hash");
  const [catalogLineBeforeRows] = await db.execute(
    "SELECT catalog_item_id,description,unit_code,unit_price,tax_code,tax_rate,tax_amount,line_total FROM invoice_lines WHERE invoice_id=? ORDER BY line_number",
    [pack2CatalogSnapshotInvoiceId],
  );
  assert.equal(catalogLineBeforeRows.length, 1);
  assert.equal(catalogLineBeforeRows[0].catalog_item_id, pack2SnapshotCatalogItem.body.data.id, "issued line keeps the catalogue source link");
  assert.equal(catalogLineBeforeRows[0].description, pack2SnapshotCatalogItem.body.data.name);
  assert.equal(String(catalogLineBeforeRows[0].unit_price), "12.3400");
  const [catalogVersionRows] = await db.execute(
    "SELECT record_version FROM catalog_items WHERE id=?", [pack2SnapshotCatalogItem.body.data.id],
  );
  assert.equal(catalogVersionRows.length, 1);
  const catalogUpdateAfterIssue = await call("/api/v1/catalog/items/" + pack2SnapshotCatalogItem.body.data.id, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: Number(catalogVersionRows[0].record_version),
      name: "Catalogue Changed After Issue " + suffix,
      customerDescription: "Changed master-data description after issue",
      unitCode: "project",
      defaultUnitPrice: "99.9900",
    }),
  }, financeSession.jar);
  assert.equal(catalogUpdateAfterIssue.response.status, 200,
    "catalogue defaults remain editable for future documents after the linked invoice has issued");
  const pack2CatalogSnapshotDetailAfterEdit = await call("/api/v1/invoices/" + pack2CatalogSnapshotInvoiceId, {}, quotationFinanceSession.jar);
  assert.equal(pack2CatalogSnapshotDetailAfterEdit.response.status, 200);
  const historicLine = pack2CatalogSnapshotDetailAfterEdit.body.data.lines?.[0];
  assert.ok(historicLine, "issued invoice detail returns the stored historical line");
  assert.equal(historicLine.description, pack2SnapshotCatalogItem.body.data.name, "catalogue name edit does not rewrite the issued line description");
  assert.equal(String(historicLine.unitPrice), "12.3400", "catalogue price edit does not rewrite the issued line rate");
  assert.equal(historicLine.unitCode, pack2SnapshotCatalogItem.body.data.unitCode, "catalogue unit edit does not rewrite the issued line unit");
  const [[catalogSnapshotAfter]] = await db.execute(
    "SELECT configuration_sha256 FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [pack2CatalogSnapshotInvoiceId],
  );
  assert.equal(catalogSnapshotAfter.configuration_sha256, catalogSnapshotBefore.configuration_sha256,
    "editing catalogue defaults does not replace or mutate the issued configuration snapshot");
  const [catalogLineAfterRows] = await db.execute(
    "SELECT catalog_item_id,description,unit_code,unit_price,tax_code,tax_rate,tax_amount,line_total FROM invoice_lines WHERE invoice_id=? ORDER BY line_number",
    [pack2CatalogSnapshotInvoiceId],
  );
  assert.deepEqual(catalogLineAfterRows[0], catalogLineBeforeRows[0],
    "catalogue default changes preserve the complete stored issued line and its calculated tax/totals");
  console.log("PASS: Pack 2 issued invoice line and configuration snapshot remain unchanged after API edits to the linked catalogue item.");

  // Pack 2: stress the invoice number allocator with two distinct invoices issued at the same time.
  const pack2ConcurrentPayload = (description) => ({
    legalEntityId: entityA.id, brandId: null, customerId: quotationCustomerId, currency: "INR",
    invoiceDate: issueDate, dueDate: null, paymentTermsDays: 30, notes: "Pack 2 concurrent issuance regression",
    lines: [{
      lineKind: "ITEM", description, unitCode: "unit", quantity: "1.0000", unitPrice: "100.0000",
      discountType: "AMOUNT", discountValue: "0.0000", taxCode: phase6bTaxCode,
    }],
  });
  const pack2ConcurrentDraftResults = await Promise.all([
    call("/api/v1/invoices", {
      method: "POST", headers: { "Idempotency-Key": "p2-concurrent-create-a-" + randomUUID() },
      body: JSON.stringify(pack2ConcurrentPayload("Pack 2 concurrent invoice A")),
    }, quotationFinanceSession.jar),
    call("/api/v1/invoices", {
      method: "POST", headers: { "Idempotency-Key": "p2-concurrent-create-b-" + randomUUID() },
      body: JSON.stringify(pack2ConcurrentPayload("Pack 2 concurrent invoice B")),
    }, quotationFinanceSession.jar),
  ]);
  assert.deepEqual(pack2ConcurrentDraftResults.map(result => result.response.status), [201, 201],
    "two separate concurrent invoice drafts are independently created");
  const pack2ConcurrentInvoiceIds = pack2ConcurrentDraftResults.map(result => result.body.data.id);
  assert.equal(new Set(pack2ConcurrentInvoiceIds).size, 2, "concurrent draft creation yields two distinct invoice IDs");
  const [sequenceBeforePack2RaceRows] = await db.execute(
    "SELECT next_value FROM invoice_number_sequences WHERE legal_entity_id=? AND document_type='INVOICE' AND financial_year_label=?",
    [entityA.id, issueResult.body.data.financialYear],
  );
  assert.equal(sequenceBeforePack2RaceRows.length, 1, "invoice financial-year sequence exists before concurrent issuance");
  const sequenceBeforePack2Race = BigInt(String(sequenceBeforePack2RaceRows[0].next_value));
  const pack2ConcurrentIssueResults = await Promise.all(pack2ConcurrentInvoiceIds.map((invoiceId, index) =>
    call("/api/v1/invoices/" + invoiceId + "/issue", {
      method: "POST",
      headers: { "Idempotency-Key": "p2-concurrent-issue-" + index + "-" + randomUUID() },
      body: JSON.stringify({ documentDate: issueDate }),
    }, quotationFinanceSession.jar),
  ));
  assert.deepEqual(pack2ConcurrentIssueResults.map(result => result.response.status), [200, 200],
    "two distinct invoices can issue successfully under concurrent requests; responses=" +
      JSON.stringify(pack2ConcurrentIssueResults.map(result => ({ status: result.response.status, body: result.body }))));
  assert.deepEqual(pack2ConcurrentIssueResults.map(result => result.body.data.idempotentReplay), [false, false],
    "each distinct invoice is issued once rather than treated as an idempotent replay");
  const pack2ConcurrentNumbers = pack2ConcurrentIssueResults.map(result => result.body.data.invoiceNumber);
  assert.ok(pack2ConcurrentNumbers.every(number => typeof number === "string" && number.length > 0),
    "both concurrent issue operations allocate official document numbers");
  assert.equal(new Set(pack2ConcurrentNumbers).size, 2, "concurrent different-invoice issuance never allocates the same invoice number");
  for (let index = 0; index < pack2ConcurrentInvoiceIds.length; index++) {
    const [issuedRow] = await db.execute(
      "SELECT lifecycle_status,invoice_number FROM invoices WHERE id=?",
      [pack2ConcurrentInvoiceIds[index]],
    );
    assert.equal(issuedRow[0].lifecycle_status, "ISSUED");
    assert.equal(issuedRow[0].invoice_number, pack2ConcurrentNumbers[index]);
    const [[snapshotCount]] = await db.execute(
      "SELECT COUNT(*) AS total FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
      [pack2ConcurrentInvoiceIds[index]],
    );
    assert.equal(Number(snapshotCount.total), 1, "every concurrently issued invoice has exactly one configuration snapshot");
  }
  const [sequenceAfterPack2RaceRows] = await db.execute(
    "SELECT next_value FROM invoice_number_sequences WHERE legal_entity_id=? AND document_type='INVOICE' AND financial_year_label=?",
    [entityA.id, issueResult.body.data.financialYear],
  );
  const sequenceAfterPack2Race = BigInt(String(sequenceAfterPack2RaceRows[0].next_value));
  assert.equal(sequenceAfterPack2Race, sequenceBeforePack2Race + 2n,
    "concurrent issuance advances the shared invoice number sequence exactly once per issued invoice");
  console.log("PASS: Pack 2 distinct-invoice concurrency allocated two unique numbers and two immutable snapshots with exactly two sequence increments.");

  console.log("PASS: Phase 7 CSV tests cover validation-only preview, signed validation tokens bound to user/session/resource/CSV bytes with expiry, customer and catalog formula-safe round trips, malformed/oversized/over-row-limit files, whole-file validation, row-numbered errors, atomic commit, exact decimal values and permission-aware sensitive columns.");

  const invalid = await call("/api/v1/customers", {
    method: "POST", body: JSON.stringify({ name: "   ", unexpected: "rejected" }),
  }, staffSession.jar);
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");

  const invalidEmail = await call("/api/v1/customers", {
    method: "POST", body: JSON.stringify({ name: "Invalid email " + suffix, email: "not-an-email" }),
  }, financeSession.jar);
  assert.equal(invalidEmail.response.status, 422, "customer email values must pass email validation");
  const invalidTaxCountry = await call("/api/v1/customers", {
    method: "POST", body: JSON.stringify({ name: "Invalid tax country " + suffix,
      taxIdentifiers: [{ identifierType: "OTHER", countryCode: "USA", identifierValue: "NOT-A-REAL-TAX-ID" }] }),
  }, financeSession.jar);
  assert.equal(invalidTaxCountry.response.status, 422, "tax identifier country code must be a two-letter uppercase code");
  const invalidDecimal = await call("/api/v1/catalog/items", {
    method: "POST", body: JSON.stringify({ itemType: "SERVICE", name: "Invalid decimal " + suffix,
      customerDescription: "validation fixture", unitCode: "hour", defaultUnitPrice: "01.00000", currency: "INR" }),
  }, financeSession.jar);
  assert.equal(invalidDecimal.response.status, 422, "catalog default price must use a non-negative exact decimal with at most four fractional digits");
  const invalidCurrency = await call("/api/v1/catalog/items", {
    method: "POST", body: JSON.stringify({ itemType: "SERVICE", name: "Invalid currency " + suffix,
      customerDescription: "validation fixture", unitCode: "hour", defaultUnitPrice: "1.0000", currency: "inr" }),
  }, financeSession.jar);
  assert.equal(invalidCurrency.response.status, 422, "catalog currency must be a three-letter uppercase code");
  const overlongCustomerName = await call("/api/v1/customers", {
    method: "POST", body: JSON.stringify({ name: "X".repeat(256) }),
  }, financeSession.jar);
  assert.equal(overlongCustomerName.response.status, 422, "customer name length is bounded by schema");
  const invalidItemType = await call("/api/v1/catalog/items", {
    method: "POST", body: JSON.stringify({ itemType: "OTHER", name: "Invalid enum " + suffix,
      customerDescription: "validation fixture", unitCode: "hour", defaultUnitPrice: "1.0000", currency: "INR" }),
  }, financeSession.jar);
  assert.equal(invalidItemType.response.status, 422, "catalog item type is restricted to PRODUCT or SERVICE");


  const viewerSession = await login(viewer);
  const viewerProfile = await call("/api/v1/auth/me", {}, viewerSession.jar);
  assert.equal(viewerProfile.response.status, 200);
  assert.deepEqual(viewerProfile.body.data.user.legalEntityIds, [testLegalEntityId], "entity scope is resolved from the database, not a client claim");
  const viewerList = await call("/api/v1/customers?limit=25&offset=0", {}, viewerSession.jar);
  assert.equal(viewerList.response.status, 200, "read-only role can read customers");
  const viewerWrite = await expectStatus(
    call("/api/v1/customers", { method: "POST", body: JSON.stringify({ name: "Forbidden read-only write" }) }, viewerSession.jar),
    403,
    "read-only role cannot create customers",
  );
  assert.equal(viewerWrite.body.error.code, "FORBIDDEN");
  await expectStatus(call("/api/v1/users", {}, viewerSession.jar), 403, "read-only role cannot access user administration");

  const suspendedLoginCsrf = await getCsrf();
  const suspendedAttempt = await call("/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ email: suspended.email, password: suspended.password }),
  }, suspendedLoginCsrf);
  assert.equal(suspendedAttempt.response.status, 401, "suspended account cannot log in");

  const adminSession = await login(admin);

  // Exercise every role against every currently implemented protected master-data/user route.
  // System administrators are deliberately not implicit superusers of finance records.
  const issuerSession = await login(issuer);
  const paymentRecorderSession = await login(paymentRecorder);
  const approverSession = await login(approver);
  for (const [roleKey, session] of [
    ["system_admin", adminSession],
    ["finance_admin", financeSession],
    ["invoice_creator", staffSession],
    ["invoice_issuer", issuerSession],
    ["payment_recorder", paymentRecorderSession],
    ["approver", approverSession],
    ["auditor", viewerSession],
  ]) {
    await assertRoleSurface(roleKey, session);
  }

  const selfAdminChange = await expectStatus(
    call("/api/v1/users/" + admin.userId, {
      method: "PATCH", body: JSON.stringify({ accountStatus: "SUSPENDED" }),
    }, adminSession.jar),
    403,
    "administrator cannot modify their own privileged account through the user-admin endpoint",
  );
  assert.equal(selfAdminChange.body.error.code, "FORBIDDEN");

  const financePrivilegeEscalation = await expectStatus(
    call("/api/v1/users/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: "forbidden-admin-" + suffix + "@example.invalid",
        displayName: "Forbidden Admin Invitation",
        roleKeys: ["system_admin"],
        legalEntityIds: [],
      }),
    }, financeSession.jar),
    403,
    "finance administrator without users:manage cannot invite or assign users",
  );
  assert.equal(financePrivilegeEscalation.body.error.code, "FORBIDDEN");

  const invitation = await call("/api/v1/users/invitations", {
    method: "POST",
    body: JSON.stringify({
      email: "invitee-" + suffix + "@example.invalid",
      displayName: "Invited CI User",
      roleKeys: ["auditor"],
      legalEntityIds: [],
    }),
  }, adminSession.jar);
  assert.equal(invitation.response.status, 201, "system admin with users:manage can create invitation");
  assert.ok(invitation.body.data.activationToken);
  const invitee = { email: invitation.body.data.email, password: "Invitee Strong Password #5!" };

  const activationCsrf = await getCsrf();
  const activated = await call("/api/v1/auth/activate", {
    method: "POST",
    body: JSON.stringify({ token: invitation.body.data.activationToken, password: invitee.password }),
  }, activationCsrf);
  assert.equal(activated.response.status, 200, "valid invitation activates an account");
  assert.equal(activated.body.data.activated, true);
  const activationReplayCsrf = await getCsrf();
  const replay = await call("/api/v1/auth/activate", {
    method: "POST",
    body: JSON.stringify({ token: invitation.body.data.activationToken, password: "Another Strong Password #5!" }),
  }, activationReplayCsrf);
  assert.equal(replay.response.status, 400, "invitation token is single-use");

  const inviteeSession = await login(invitee);
  assert.ok(inviteeSession.body.data.user.permissions.includes("customers:read"));
  assert.ok(!inviteeSession.body.data.user.permissions.includes("customers:create"), "auditor role has no customer create permission");
  assert.ok(!inviteeSession.body.data.user.permissions.includes("customers:update"), "auditor role has no customer update permission");
  const roleChange = await call("/api/v1/users/" + invitation.body.data.userId, {
    method: "PATCH", body: JSON.stringify({ roleKeys: ["invoice_creator"] }),
  }, adminSession.jar);
  assert.equal(roleChange.response.status, 200);
  assert.equal(roleChange.body.data.sessionsRevokedOnPrivilegeChange, true);
  const staleAfterPrivilegeChange = await expectStatus(call("/api/v1/customers", {}, inviteeSession.jar), 401, "role change revokes existing sessions");
  assert.equal(staleAfterPrivilegeChange.body.error.code, "UNAUTHENTICATED");

  const newInviteeSession = await login(invitee);
  const suspend = await call("/api/v1/users/" + invitation.body.data.userId, {
    method: "PATCH", body: JSON.stringify({ accountStatus: "SUSPENDED" }),
  }, adminSession.jar);
  assert.equal(suspend.response.status, 200);
  const staleAfterSuspend = await expectStatus(call("/api/v1/customers", {}, newInviteeSession.jar), 401, "account suspension revokes sessions immediately");
  assert.equal(staleAfterSuspend.body.error.code, "UNAUTHENTICATED");

  const oldStaffCookie = cookieHeader(new Map(staffSession.jar));
  const logout = await call("/api/v1/auth/logout", { method: "POST", body: "{}" }, staffSession.jar);
  assert.equal(logout.response.status, 200);
  const afterLogout = await call("/api/v1/customers", { headers: { Cookie: oldStaffCookie } });
  assert.equal(afterLogout.response.status, 401, "logout revokes the database session, even if an old cookie is replayed");

  const scopeRemoved = await call("/api/v1/users/" + viewer.userId, {
    method: "PATCH",
    body: JSON.stringify({ legalEntityIds: [] }),
  }, adminSession.jar);
  assert.equal(scopeRemoved.response.status, 200, "authorized administrator can change legal-entity scope");
  assert.deepEqual(scopeRemoved.body.data.legalEntityIds, []);
  assert.equal(scopeRemoved.body.data.sessionsRevokedOnPrivilegeChange, true);
  const staleAfterScopeChange = await expectStatus(
    call("/api/v1/customers", {}, viewerSession.jar),
    401,
    "removing a user's entity scope revokes the prior session",
  );
  assert.equal(staleAfterScopeChange.body.error.code, "UNAUTHENTICATED");

  const revokeSession = await login(viewer);
  const revokedAll = await call("/api/v1/auth/sessions/revoke-all", { method: "POST", body: "{}" }, revokeSession.jar);
  assert.equal(revokedAll.response.status, 200);
  const afterRevokeAll = await call("/api/v1/customers", { headers: { Cookie: cookieHeader(revokeSession.jar) } });
  assert.equal(afterRevokeAll.response.status, 401, "revoke-all invalidates existing session tokens");

  const absoluteExpiryUser = await seedUser("auditor", "absolute-expiry-" + suffix + "@example.invalid", "ACTIVE", "Absolute Expiry Password #5!");
  const absoluteExpirySession = await login(absoluteExpiryUser);
  const [absoluteSessionRows] = await db.execute(
    "SELECT id FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [absoluteExpiryUser.userId],
  );
  assert.equal(absoluteSessionRows.length, 1);
  await db.execute("UPDATE auth_sessions SET created_at=DATE_SUB(NOW(3), INTERVAL 9 HOUR), expires_at=DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id=?", [absoluteSessionRows[0].id]);
  const absoluteExpired = await expectStatus(call("/api/v1/customers", {}, absoluteExpirySession.jar), 401, "absolute session expiry is enforced");
  assert.equal(absoluteExpired.body.error.code, "UNAUTHENTICATED");

  const idleExpiryUser = await seedUser("auditor", "idle-expiry-" + suffix + "@example.invalid", "ACTIVE", "Idle Expiry Password #5!");
  const idleExpirySession = await login(idleExpiryUser);
  const [idleSessionRows] = await db.execute(
    "SELECT id FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [idleExpiryUser.userId],
  );
  assert.equal(idleSessionRows.length, 1);
  await db.execute("UPDATE auth_sessions SET last_seen_at=DATE_SUB(NOW(3), INTERVAL 31 MINUTE) WHERE id=?", [idleSessionRows[0].id]);
  const idleExpired = await expectStatus(call("/api/v1/customers", {}, idleExpirySession.jar), 401, "idle session expiry is enforced");
  assert.equal(idleExpired.body.error.code, "UNAUTHENTICATED");

  const rateCsrf = await getCsrf();
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await call("/api/v1/auth/login", {
      method: "POST", body: JSON.stringify({ email: "rate-" + suffix + "@example.invalid", password: "Incorrect Strong Password" }),
    }, rateCsrf);
    assert.equal(result.response.status, 401, "failed credentials use a generic response before the threshold");
  }
  const rateLimited = await call("/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ email: "rate-" + suffix + "@example.invalid", password: "Incorrect Strong Password" }),
  }, rateCsrf);
  assert.equal(rateLimited.response.status, 429, "account-based login throttle activates at the configured threshold");
  assert.ok(Number(rateLimited.response.headers.get("retry-after")) > 0);

  // Pack 4 Part B: issued-document correction requests never mutate the source before independent review.
  async function p4CreateIssuedInvoice(label) {
    const id=randomUUID();
    await db.execute(
      "INSERT INTO invoices (id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,currency,subtotal,discount_total,tax_total,grand_total) VALUES (?, ?, NULL, ?, 'INVOICE','DRAFT',30,'INR',100.0000,0,0.0000,100.0000)",
      [id,entityA.id,created.body.data.id],
    );
    await db.execute(
      "INSERT INTO invoice_lines (id,invoice_id,line_number,description,quantity,unit_price,discount_amount,tax_rate,tax_code,tax_rule_id,tax_registration_id,tax_amount,line_total) VALUES (?,?,1,?,1.0000,100.0000,0,0.000000,?,?,?,0.0000,100.0000)",
      [randomUUID(),id,"CI Pack4 "+label,phase6bTaxCode,phase6bTaxRuleId,phase6bRegistrationId],
    );
    const issued=await call("/api/v1/invoices/"+id+"/issue",{
      method:"POST",headers:{"Idempotency-Key":"p4-issue-"+label.toLowerCase()+"-"+randomUUID()},
      body:JSON.stringify({documentDate:issueDate}),
    },phase6aSession.jar);
    assert.equal(issued.response.status,200,"Pack 4 correction fixture invoice issues: "+JSON.stringify(issued.body?.error??null));
    return {id,number:issued.body.data.invoiceNumber};
  }
  const p4Reviewer=await seedUser("finance_admin","p4-reviewer-"+suffix+"@example.invalid","ACTIVE",
    "Pack4 Reviewer Password #5!",[entityA.id]);
  const p4ReviewerSession=await login(p4Reviewer);

  const p4CancelSource=await p4CreateIssuedInvoice("cancel");
  const p4CancelKey="p4-cancel-request-"+randomUUID();
  const p4CancelReason="Correct issuer invoice duplicate from a disposable CI fixture.";
  const p4CancelRequest=await call("/api/v1/correction-requests",{
    method:"POST",headers:{"Idempotency-Key":p4CancelKey},
    body:JSON.stringify({invoiceId:p4CancelSource.id,correctionType:"CANCEL",reason:p4CancelReason}),
  },phase6aSession.jar);
  assert.equal(p4CancelRequest.response.status,201,"issued invoice can request a governed cancellation");
  assert.equal(p4CancelRequest.body.data.status,"PENDING_REVIEW");
  assert.equal(p4CancelRequest.body.data.invoiceNumber,p4CancelSource.number);
  const p4CancelReplay=await call("/api/v1/correction-requests",{
    method:"POST",headers:{"Idempotency-Key":p4CancelKey},
    body:JSON.stringify({invoiceId:p4CancelSource.id,correctionType:"CANCEL",reason:p4CancelReason}),
  },phase6aSession.jar);
  assert.equal(p4CancelReplay.response.status,200,"same-key correction request replays the existing request");
  assert.equal(p4CancelReplay.body.data.id,p4CancelRequest.body.data.id);
  assert.equal(p4CancelReplay.body.data.idempotentReplay,true);
  const p4CancelConflict=await call("/api/v1/correction-requests",{
    method:"POST",headers:{"Idempotency-Key":p4CancelKey},
    body:JSON.stringify({invoiceId:p4CancelSource.id,correctionType:"CANCEL",reason:"Conflicting correction reason payload."}),
  },phase6aSession.jar);
  assert.equal(p4CancelConflict.response.status,409,"correction request idempotency rejects a changed payload");
  const p4DuplicatePendingKey=randomUUID()+randomUUID();
  const p4DuplicatePending=await call("/api/v1/correction-requests",{
    method:"POST",headers:{"Idempotency-Key":p4DuplicatePendingKey},
    body:JSON.stringify({invoiceId:p4CancelSource.id,correctionType:"DEBIT_NOTE",reason:"Attempt another correction while one is pending."}),
  },phase6aSession.jar);
  assert.equal(p4DuplicatePending.response.status,409,"one pending correction request per invoice is enforced");
  assert.equal(p4DuplicatePending.body.error.code,"CORRECTION_ALREADY_PENDING");
  const p4SourceBeforeReview=await call("/api/v1/invoices/"+p4CancelSource.id,{},phase6aSession.jar);
  assert.equal(p4SourceBeforeReview.body.data.lifecycleStatus,"ISSUED","request creation cannot mutate an issued invoice");
  assert.equal(p4SourceBeforeReview.body.data.invoiceNumber,p4CancelSource.number);
  const p4SelfReview=await call("/api/v1/correction-requests/"+p4CancelRequest.body.data.id+"/decision",{
    method:"POST",body:JSON.stringify({decision:"APPROVE",reason:"Requester attempts to approve their own correction."}),
  },phase6aSession.jar);
  assert.equal(p4SelfReview.response.status,409,"correction requester cannot approve their own request");
  assert.equal(p4SelfReview.body.error.code,"SEPARATION_OF_DUTIES");
  const p4Queue=await call("/api/v1/correction-requests?status=PENDING_REVIEW&invoiceId="+p4CancelSource.id,{},p4ReviewerSession.jar);
  assert.equal(p4Queue.response.status,200,"independent reviewer can read the scoped correction queue");
  assert.equal(p4Queue.body.data.length,1);
  assert.equal(p4Queue.body.data[0].history.length,1,"correction request history retains its REQUESTED event");
  const p4CancelReview=await call("/api/v1/correction-requests/"+p4CancelRequest.body.data.id+"/decision",{
    method:"POST",body:JSON.stringify({decision:"APPROVE",reason:"CI fixture independent review confirms test cancellation."}),
  },p4ReviewerSession.jar);
  assert.equal(p4CancelReview.response.status,200,"approved correction may execute only under approved cancellation policy");
  assert.equal(p4CancelReview.body.data.status,"EXECUTED");
  const [p4CancelledRows]=await db.execute("SELECT lifecycle_status,invoice_number,cancellation_reason,cancelled_by FROM invoices WHERE id=?",[p4CancelSource.id]);
  assert.equal(p4CancelledRows[0].lifecycle_status,"CANCELLED");
  assert.equal(p4CancelledRows[0].invoice_number,p4CancelSource.number,"cancellation preserves the allocated invoice number");
  assert.equal(p4CancelledRows[0].cancellation_reason,p4CancelReason);
  assert.equal(p4CancelledRows[0].cancelled_by,p4Reviewer.userId,"the independent reviewer is recorded as cancelling actor");
  const [p4CancelEvents]=await db.execute("SELECT event_type FROM invoice_correction_request_events WHERE request_id=? ORDER BY created_at,id",[p4CancelRequest.body.data.id]);
  assert.deepEqual(p4CancelEvents.map(row=>row.event_type),["REQUESTED","EXECUTED"]);
  const p4CancelHistory=await call("/api/v1/correction-requests?status=all&invoiceId="+p4CancelSource.id,{},p4ReviewerSession.jar);
  assert.equal(p4CancelHistory.body.data[0].history.length,2,"request history includes the executed decision");
  const [p4CancelAudit]=await db.execute("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('invoice.cancelled','invoice.correction.executed') AND entity_id IN (?,?)",[p4CancelSource.id,p4CancelRequest.body.data.id]);
  assert.equal(Number(p4CancelAudit[0].n),2,"cancellation and review execution each emit an audit event");
  console.log("PASS: Pack 4 correction request idempotency, one-pending guard, immutable source invoice, maker-checker separation and audited cancellation pass.");

  const p4PaymentGuardSource=await p4CreateIssuedInvoice("payment-guard");
  const p4TestPayment=await call("/api/v1/invoices/"+p4PaymentGuardSource.id+"/payments",{
    method:"POST",headers:{"Idempotency-Key":"p4-payment-before-correction-"+randomUUID()},
    body:JSON.stringify({amount:"1.0000",paymentDate:issueDate,method:"bank transfer",reference:"CI-P4-PAY-"+suffix,notes:"Pack 4 payment-state guard fixture"}),
  },phase6aSession.jar);
  assert.equal(p4TestPayment.response.status,201,"Pack 4 payment guard invoice accepts an in-scope payment");
  const p4PaidCancelRequest=await call("/api/v1/correction-requests",{
    method:"POST",headers:{"Idempotency-Key":"p4-paid-cancel-"+randomUUID()},
    body:JSON.stringify({invoiceId:p4PaymentGuardSource.id,correctionType:"CANCEL",reason:"Request cancellation for an invoice with a recorded payment."}),
  },phase6aSession.jar);
  assert.equal(p4PaidCancelRequest.response.status,201);
  const p4PaidCancelReview=await call("/api/v1/correction-requests/"+p4PaidCancelRequest.body.data.id+"/decision",{
    method:"POST",body:JSON.stringify({decision:"APPROVE",reason:"Review attempt checks active recorded payment allocations."}),
  },p4ReviewerSession.jar);
  assert.equal(p4PaidCancelReview.response.status,409,"cancellation with active recorded allocations must be blocked");
  assert.equal(p4PaidCancelReview.body.error.code,"PAYMENT_STATE_GUARD");
  const p4PaidAfterGuard=await call("/api/v1/invoices/"+p4PaymentGuardSource.id,{},phase6aSession.jar);
  assert.equal(p4PaidAfterGuard.body.data.lifecycleStatus,"ISSUED","payment guard must preserve the issued invoice");
  const p4StillPending=await call("/api/v1/correction-requests?status=PENDING_REVIEW&invoiceId="+p4PaymentGuardSource.id,{},p4ReviewerSession.jar);
  assert.equal(p4StillPending.body.data.length,1,"blocked execution leaves request available for further review");
  console.log("PASS: Pack 4 cancellation refuses active recorded allocations and leaves source invoice/request unchanged.");

  const p4NoteSource=await p4CreateIssuedInvoice("note-policy");
  const p4NoteRequest=await call("/api/v1/correction-requests",{
    method:"POST",headers:{"Idempotency-Key":"p4-credit-note-"+randomUUID()},
    body:JSON.stringify({invoiceId:p4NoteSource.id,correctionType:"CREDIT_NOTE",reason:"Request credit note after a documented source-invoice issue."}),
  },phase6aSession.jar);
  assert.equal(p4NoteRequest.response.status,201);
  const p4NoteExecution=await call("/api/v1/correction-requests/"+p4NoteRequest.body.data.id+"/decision",{
    method:"POST",body:JSON.stringify({decision:"APPROVE",reason:"Credit-note treatment is not implemented until tax/numbering review."}),
  },p4ReviewerSession.jar);
  assert.equal(p4NoteExecution.response.status,409,"credit-note execution must fail closed without approved implementation");
  assert.equal(p4NoteExecution.body.error.code,"CORRECTION_TREATMENT_BLOCKED");
  const p4NoteSourceAfter=await call("/api/v1/invoices/"+p4NoteSource.id,{},phase6aSession.jar);
  assert.equal(p4NoteSourceAfter.body.data.lifecycleStatus,"ISSUED","blocked credit-note request cannot change source invoice");
  const p4NoteReject=await call("/api/v1/correction-requests/"+p4NoteRequest.body.data.id+"/decision",{
    method:"POST",body:JSON.stringify({decision:"REJECT",reason:"Reject until the issuer-approved statutory note treatment is available."}),
  },p4ReviewerSession.jar);
  assert.equal(p4NoteReject.response.status,200);
  assert.equal(p4NoteReject.body.data.status,"REJECTED");
  const p4NoteHistory=await call("/api/v1/correction-requests?status=all&invoiceId="+p4NoteSource.id,{},p4ReviewerSession.jar);
  assert.equal(p4NoteHistory.body.data[0].history.length,2,"blocked note execution does not add a fabricated event; rejection is audited");

  const p4NoQueueUser=await call("/api/v1/correction-requests?status=all",{},p3NoReverseSession.jar);
  assert.equal(p4NoQueueUser.response.status,403,"users without approvals:read or invoice draft-update cannot access correction requests");
  console.log("PASS: Pack 4 keeps credit-note execution blocked, permits an independently reasoned rejection, and enforces correction queue access.");

  const dbSessions = await db.execute("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=?", [staff.userId]);
  assert.ok(Number(dbSessions[0][0].count) >= 1);
  console.log("PASS: Phase 05B authorization tests cover the exact seven-role grant matrix, effective session permissions, role-by-role reads/writes of every implemented protected data surface, anonymous denial, CSRF, account lifecycle, privilege escalation prevention, scope-change session revocation and rate limiting; customer/catalog API contracts and decimal serialization also pass.");
} finally {
  await db.end();
}
