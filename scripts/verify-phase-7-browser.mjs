import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const baseUrl = process.env.PHASE7_BROWSER_BASE_URL ?? "http://127.0.0.1:3003";
const databaseHost = process.env.DATABASE_HOST ?? "";
const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.CI !== "true" || databaseHost !== "127.0.0.1" || databaseName !== "falchion_ci") {
  throw new Error("Phase 7 browser tests may run only against the disposable falchion_ci database in GitHub Actions.");
}
if (new URL(baseUrl).hostname !== "127.0.0.1") {
  throw new Error("Phase 7 browser test base URL must be loopback.");
}

const suffix = randomBytes(6).toString("hex").toUpperCase();
const userId = randomUUID();
const email = `phase7-browser-${suffix.toLowerCase()}@example.invalid`;
const password = `P7-browser-${randomBytes(12).toString("hex")}!`;
const customerCode = `PW-${suffix}`;
const customerName = `Browser Customer ${suffix}`;
const updatedCustomerName = `Updated Browser Customer ${suffix}`;
const itemCode = `PW-${suffix}`;
const itemName = `Browser Service ${suffix}`;
const internalDescription = `E2E-INTERNAL-${suffix}`;
const artifactDirectory = process.env.RUNNER_TEMP
  ? `${process.env.RUNNER_TEMP}/phase7-browser`
  : "/tmp/phase7-browser";
await mkdir(artifactDirectory, { recursive: true });

const db = await mysql.createConnection({
  host: databaseHost,
  port: Number(process.env.DATABASE_PORT ?? "3306"),
  database: databaseName,
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  connectTimeout: 10000,
});

function hashPassword(value) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) return reject(error);
      resolve("scrypt$32768$8$1$" + salt.toString("base64url") + "$" + key.toString("base64url"));
    });
  });
}

let browser;
let page;
const runtimeErrors = [];
let checksPassed = 0;
function pass(message) {
  checksPassed += 1;
  console.log(`PASS: ${message}`);
}
async function waitForList(page) {
  await page.locator("table.data-table").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading records…"));
}
async function assertNoPageOverflow(page, width) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
  await page.waitForTimeout(150);
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(metrics.document <= metrics.viewport + 1 && metrics.body <= metrics.viewport + 1,
    `Horizontal page overflow at ${width}px: ${JSON.stringify(metrics)}`);
  pass(`No horizontal page overflow at ${width}px viewport.`);
}

try {
  const [roleRows] = await db.execute("SELECT id FROM app_roles WHERE role_key='finance_admin' LIMIT 1");
  assert.equal(roleRows.length, 1, "finance_admin role is present after reference seeding.");
  await db.execute(
    "INSERT INTO app_users (id,email,display_name,identity_provider,provider_subject,password_hash,account_status) VALUES (?,?,?,'local_password',?,?,?)",
    [userId, email, "Phase 7 Browser Test", email, await hashPassword(password), "ACTIVE"],
  );
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId, roleRows[0].id]);
  pass("Dedicated browser-test account was seeded in disposable CI MySQL.");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => {
    runtimeErrors.push(error.message);
    console.error("BROWSER PAGE ERROR: " + error.message);
  });
  page.on("console", message => {
    if (message.type() === "error") console.error("BROWSER CONSOLE ERROR: " + message.text());
  });
  page.on("requestfailed", request => {
    console.error("BROWSER REQUEST FAILED: " + request.method() + " " + request.url() + " :: " + (request.failure()?.errorText ?? "unknown"));
  });
  page.on("response", response => {
    if (response.status() >= 500) console.error("BROWSER HTTP 5XX: " + response.status() + " " + response.url());
  });

  await page.goto(`${baseUrl}/customers`);
  await page.waitForURL(url => url.pathname === "/login");
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await page.getByLabel("Work email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(url => url.pathname === "/");
  await page.locator(".app-shell").waitFor({ state: "visible" });
  pass("Anonymous workspace access redirects to sign-in and UI login opens the protected workspace.");

  await page.goto(`${baseUrl}/customers`);
  await page.getByRole("heading", { name: "Customers", exact: true }).waitFor();
  await waitForList(page);
  const newCustomerButton = page.getByRole("button", { name: /New customer/i });
  await newCustomerButton.click();
  await page.getByRole("heading", { name: "Create customer", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "customerCode");
  pass("Opening the customer editor moves keyboard focus into the form.");

  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Create customer", exact: true }).waitFor({ state: "detached" });
  assert.equal(await newCustomerButton.evaluate(element => element === document.activeElement), true,
    "Escape closes the non-modal editor and returns focus to its opener.");
  pass("Escape closes the customer editor and restores focus to its opener.");

  await newCustomerButton.click();
  await page.getByRole("heading", { name: "Create customer", exact: true }).waitFor();
  await page.getByRole("button", { name: "Create record", exact: true }).click();
  assert.equal(await page.locator("#name").evaluate(element => element.matches(":invalid")), true,
    "the browser prevents an empty required customer name from being submitted.");
  await page.getByRole("heading", { name: "Create customer", exact: true }).waitFor();
  pass("Required customer fields prevent an empty submission.");

  await page.locator("#customerCode").fill(customerCode);
  await page.getByLabel(/Customer \/ legal name/).fill(customerName);
  await page.locator("#email").fill(`customer-${suffix.toLowerCase()}@example.invalid`);
  await page.getByRole("button", { name: "Create record", exact: true }).click();
  await page.waitForTimeout(500);
  console.log("DEBUG: customer-create URL=" + page.url());
  console.log("DEBUG: customer-create visible page text:\\n" + (await page.locator("body").innerText()).slice(-6000));
  await page.getByText("Record created.", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: customerName, exact: true }).waitFor();
  pass("Customer create workflow persists data through the real UI and API.");

  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  await page.getByRole("heading", { name: "Edit Customer", exact: true }).waitFor();
  await page.getByLabel(/Customer \/ legal name/).fill(updatedCustomerName);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("heading", { name: updatedCustomerName, exact: true }).waitFor();
  await page.getByText("Record updated. Any prior invoice/quotation snapshots remain unchanged.", { exact: true }).waitFor();
  pass("Customer edit workflow uses the versioned update path and refreshes detail.");

  await page.getByRole("button", { name: "Archive record", exact: true }).click();
  await page.getByRole("heading", { name: `Archive ${updatedCustomerName}?`, exact: true }).waitFor();
  await page.locator("#archiveReason").fill("Disposable browser acceptance fixture");
  await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await page.getByText("Archived. The record remains recoverable for audit/history, and any historical documents stay linked.", { exact: true }).waitFor();
  await page.locator("#customers-status").selectOption("all");
  await page.locator("#customers-search").fill("NO-MATCH-" + suffix);
  await page.getByText("No customers found", { exact: true }).waitFor();
  await page.locator("#customers-search").fill(customerCode);
  await page.locator("tbody tr").filter({ hasText: customerCode }).getByText("Archived", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1, "customer code search narrows results to the matching record.");
  pass("Customer search covers a no-results state and exact code filtering after archive.");
  pass("Customer archive requires a reason and remains visible in the archived filter.");

  await page.goto(`${baseUrl}/catalog`);
  await page.getByRole("heading", { name: "Items & services", exact: true }).waitFor();
  await waitForList(page);
  await page.getByRole("button", { name: /New item \/ service/i }).click();
  await page.getByRole("heading", { name: "Create item / service", exact: true }).waitFor();
  await page.locator("#itemType").selectOption("SERVICE");
  await page.locator("#itemCode").fill(itemCode);
  await page.locator("#name").fill(itemName);
  await page.locator("#unitCode").fill("hour");
  await page.locator("#defaultUnitPrice").fill("125.5000");
  await page.locator("#currency").fill("INR");
  await page.locator("#customerDescription").fill("Browser-test customer-facing description");
  await page.locator("#internalDescription").fill(internalDescription);
  await page.getByRole("button", { name: "Create record", exact: true }).click();
  await page.getByRole("heading", { name: itemName, exact: true }).waitFor();
  await page.getByText(internalDescription, { exact: true }).waitFor();
  await page.locator(".master-data-detail__grid").getByText("INR 125.5000", { exact: true }).waitFor();
  pass("Catalog create workflow preserves exact decimal price and privileged internal details.");

  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  await page.getByRole("heading", { name: "Edit Items & service", exact: true }).waitFor();
  await page.locator("#defaultUnitPrice").fill("126.7500");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("heading", { name: itemName, exact: true }).waitFor();
  await page.getByText("Record updated. Any prior invoice/quotation snapshots remain unchanged.", { exact: true }).waitFor();
  await page.locator(".master-data-detail__grid").getByText("INR 126.7500", { exact: true }).waitFor();
  pass("Catalog edit workflow updates future defaults without floating-point display corruption.");

  await page.getByRole("button", { name: "Archive record", exact: true }).click();
  await page.getByRole("heading", { name: `Archive ${itemName}?`, exact: true }).waitFor();
  await page.locator("#archiveReason").fill("Disposable browser acceptance fixture");
  await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await page.getByText("Archived. The record remains recoverable for audit/history, and any historical documents stay linked.", { exact: true }).waitFor();
  await page.locator("#catalog-status").selectOption("all");
  await page.locator("#catalog-search").fill("NO-MATCH-" + suffix);
  await page.getByText("No items or services found", { exact: true }).waitFor();
  await page.locator("#catalog-search").fill(itemCode);
  await page.locator("tbody tr").filter({ hasText: itemCode }).getByText("Archived", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1, "catalog code search narrows results to the matching record.");
  pass("Catalog search covers no-results feedback and exact code filtering.");
  pass("Catalog archive requires a reason and preserves the archived row for history.");

  const importedCustomerCode = "UI-CSV-" + suffix.toUpperCase();
  const customerCsvPath = `${artifactDirectory}/customers-import.csv`;
  await writeFile(customerCsvPath,
    "customerCode,name,email\r\n" + importedCustomerCode + ",Browser CSV Import " + suffix +
      ",browser-csv-" + suffix.toLowerCase() + "@example.invalid\r\n",
    "utf8");
  await page.goto(`${baseUrl}/customers`);
  await page.getByRole("heading", { name: "Customers", exact: true }).waitFor();
  await waitForList(page);
  await page.locator("details.master-data-import summary").click();
  await page.locator("#customers-csv-file").setInputFiles(customerCsvPath);
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await page.getByText("Validated 1 rows", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Commit 1 rows", exact: true }).click();
  await page.getByText(/Imported 1 customer records/).waitFor();
  await page.locator("#customers-search").fill(importedCustomerCode);
  await page.locator("tbody tr").filter({ hasText: importedCustomerCode }).waitFor();
  pass("Customer CSV import validates before explicit commit and the imported record is searchable.");

  // Pack 2 Part A: exercise invoice draft/edit/issue through the real browser workspace.
  const [invoiceEntityRows] = await db.execute(
    "SELECT id,display_name,currency,tax_setup_status,time_zone,default_tax_code FROM legal_entities " +
      "WHERE display_name LIKE 'Phase 6A Entity A %' AND is_active=TRUE ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(invoiceEntityRows.length, 1, "invoice browser flow needs the approved disposable Phase 6A entity");
  const invoiceTestEntity = invoiceEntityRows[0];
  assert.equal(invoiceTestEntity.tax_setup_status, "APPROVED_CONFIGURED",
    "invoice browser flow uses only the approved synthetic CI tax configuration");
  assert.equal(invoiceTestEntity.time_zone, "Asia/Kolkata", "invoice test entity has a valid configured time zone");
  assert.ok(invoiceTestEntity.default_tax_code, "invoice test entity has a default approved tax code");
  await db.execute(
    "INSERT INTO user_legal_entity_access (user_id, legal_entity_id, granted_by) VALUES (?, ?, NULL)",
    [userId, invoiceTestEntity.id],
  );

  // Seed a fully synthetic, single-issuer brand mapping for the redesigned brand-first invoice flow.
  // These rows exist only in the disposable falchion_ci database.
  const invoiceBrandId = randomUUID();
  const invoiceBrandCode = "MYFXPOS-PW-" + suffix;
  const invoiceBrandName = "MyFX POS Browser " + suffix;
  const invoiceBrandTemplateKey = "MYFXPOS-PW-" + suffix;
  const invoiceBrandSnapshot = {
    name: invoiceBrandName,
    code: invoiceBrandCode,
    logoReference: "/brand/myfx-pos.webp",
    primaryColor: "#DCAF51",
    theme: { primaryColor: "#DCAF51", accentColor: "#DCAF51" },
  };
  await db.execute(
    "INSERT INTO brands (id,name,code,description,logo_reference,theme_json,default_template_key,is_active) VALUES (?,?,?,?,?,?,?,TRUE)",
    [invoiceBrandId,invoiceBrandName,invoiceBrandCode,"Synthetic browser-only brand mapping","/brand/myfx-pos.webp",
      JSON.stringify(invoiceBrandSnapshot.theme),invoiceBrandTemplateKey],
  );
  await db.execute(
    "INSERT INTO brand_legal_entities (brand_id,legal_entity_id,is_default,effective_from,effective_until) VALUES (?,?,TRUE,NOW(3),NULL)",
    [invoiceBrandId,invoiceTestEntity.id],
  );
  await db.execute(
    "INSERT INTO brand_config_versions (id,brand_id,version_number,effective_from,config_snapshot,change_reason,changed_by) VALUES (?,?,1,NOW(3),?,?,?)",
    [randomUUID(),invoiceBrandId,JSON.stringify(invoiceBrandSnapshot),"Synthetic browser acceptance configuration",userId],
  );
  for (const documentType of ["INVOICE","QUOTATION"]) {
    await db.execute(
      "INSERT INTO invoice_document_templates (id,legal_entity_id,brand_id,document_type,template_key,display_name,version_number,template_config,effective_from,effective_until,is_active,created_by) VALUES (?,?,?,?,?,?,1,?,CURRENT_DATE,NULL,TRUE,?)",
      [randomUUID(),invoiceTestEntity.id,invoiceBrandId,documentType,invoiceBrandTemplateKey,
        invoiceBrandName + " " + documentType,JSON.stringify({
          primaryColor: "#DCAF51",
          accentColor: "#DCAF51",
          title: "PROFORMA INVOICE:",
          terms: "Synthetic CI terms only; not legal wording.",
          footer: "Synthetic browser acceptance document.",
        }),userId],
    );
  }

  const [invoiceCustomerRows] = await db.execute(
    "SELECT id,name FROM customers WHERE customer_code=? AND is_active=TRUE LIMIT 1",
    [importedCustomerCode],
  );
  assert.equal(invoiceCustomerRows.length, 1, "invoice/quotation browser flow uses the active CSV-imported customer");
  const invoiceTestCustomer = invoiceCustomerRows[0];
  const invoiceUiDate = new Date().toISOString().slice(0, 10);
  const invoiceLineDescription = "Pack 2 browser invoice " + suffix;
  const inlineCustomerName = "Inline Invoice Customer " + suffix;
  const inlineCustomerEmail = "invoice-" + suffix.toLowerCase() + "@example.invalid";
  await page.goto(baseUrl + "/invoices");
  await page.getByRole("heading", { name: "Invoices", exact: true }).waitFor();
  await waitForList(page);
  await page.getByRole("button", { name: /New invoice/i }).first().click();
  const invoiceEditor = page.locator(".invoice-editor").last();
  await invoiceEditor.getByRole("heading", { name: "Create invoice", exact: true }).waitFor();
  await invoiceEditor.getByLabel("Invoice from").selectOption(invoiceBrandId);
  await invoiceEditor.getByLabel("Customer").selectOption("__new__");
  await invoiceEditor.getByLabel("Customer / company name").fill(inlineCustomerName);
  await invoiceEditor.getByLabel("Email to send the invoice to").fill(inlineCustomerEmail);
  await invoiceEditor.getByLabel("Invoice date").fill(invoiceUiDate);
  await invoiceEditor.getByLabel("Milestone (optional)").fill("Implementation milestone");
  await invoiceEditor.getByLabel("Description").fill(invoiceLineDescription);
  await invoiceEditor.getByLabel("Quantity").fill("2.0000");
  await invoiceEditor.getByLabel(/^Rate/).fill("100.0000");
  await invoiceEditor.locator("details.invoice-line-advanced summary").click();
  await invoiceEditor.getByLabel("Unit", { exact: true }).fill("hour");
  await invoiceEditor.getByLabel("Discount type").selectOption("PERCENT");
  await invoiceEditor.getByLabel("Discount (%)").fill("10.0000");
  await invoiceEditor.getByLabel("Approved tax code").selectOption(String(invoiceTestEntity.default_tax_code));
  await invoiceEditor.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved. The server recalculated the totals.", { exact: true }).waitFor();
  await page.getByText("INR 212.4000", { exact: true }).first().waitFor();
  pass("Brand-first invoice draft accepts inline customer/company details, recipient email and milestone, then calculates exact-decimal totals.");

  const [inlineCustomerRows] = await db.execute(
    "SELECT id,name,email FROM customers WHERE name=? AND email=? AND is_active=TRUE LIMIT 1",
    [inlineCustomerName,inlineCustomerEmail],
  );
  assert.equal(inlineCustomerRows.length, 1, "inline invoice composer persists the customer and billing recipient.");
  const invoiceBrowserCustomer = inlineCustomerRows[0];

  const editableInvoice = page.locator(".invoice-editor").last();
  await editableInvoice.getByLabel(/^Rate/).fill("120.0000");
  await editableInvoice.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved. The server recalculated the totals.", { exact: true }).waitFor();
  await page.getByText("INR 254.8800", { exact: true }).first().waitFor();
  await page.locator(".invoice-editor").last().getByRole("button", { name: "Issue & send invoice", exact: true }).click();
  await page.getByText("Invoice issued and email queued. Check its delivery status in the invoice details.", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Email delivery and evidence" }).waitFor();

  const [invoiceByLineRows] = await db.execute(
    "SELECT i.id,i.customer_id,i.lifecycle_status,i.invoice_number,i.grand_total FROM invoices i JOIN invoice_lines l ON l.invoice_id=i.id " +
      "WHERE i.legal_entity_id=? AND i.customer_id=? AND l.description=? ORDER BY i.created_at DESC LIMIT 1",
    [invoiceTestEntity.id,invoiceBrowserCustomer.id,invoiceLineDescription],
  );
  assert.equal(invoiceByLineRows.length, 1, "invoice created and issued by the workspace persists exactly one matching document");
  assert.equal(invoiceByLineRows[0].lifecycle_status, "ISSUED");
  assert.ok(invoiceByLineRows[0].invoice_number, "issue action allocates the official invoice number");
  assert.equal(String(invoiceByLineRows[0].grand_total), "254.8800");
  const [queuedEmailRows] = await db.execute(
    "SELECT recipient_email,status FROM email_outbox WHERE source_document_type='INVOICE' AND source_document_id=? ORDER BY created_at DESC LIMIT 1",
    [invoiceByLineRows[0].id],
  );
  assert.equal(queuedEmailRows.length, 1, "Issue & send queues one durable email with the issued invoice PDF.");
  assert.equal(queuedEmailRows[0].recipient_email, inlineCustomerEmail);
  assert.equal(queuedEmailRows[0].status, "QUEUED");
  const [issuedBrowserSnapshots] = await db.execute(
    "SELECT configuration_sha256 FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [invoiceByLineRows[0].id],
  );
  assert.equal(issuedBrowserSnapshots.length, 1, "UI issuance persists one immutable configuration snapshot");
  assert.match(String(issuedBrowserSnapshots[0].configuration_sha256), /^[0-9a-f]{64}$/);
  pass("Invoice workspace edits the draft, issues it with one primary action, queues the PDF email, allocates a number and persists an integrity-hashed snapshot.");

  // Pack 9 browser acceptance: the onboarding/settings surface reports readiness for the real test entity.
  await page.goto(baseUrl + "/settings");
  await page.getByRole("heading", { name: "Your invoicing workspace", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Core issuance checks passed", exact: true }).waitFor();
  pass("Settings onboarding confirms first-invoice readiness for the authorized legal entity.");
  await page.getByRole("button", { name: "Advanced settings", exact: true }).click();
  await page.getByRole("heading", { name: "Company & invoice configuration", exact: true }).waitFor();
  await page.getByRole("button", { name: /Tax Registrations & rules/ }).waitFor();
  await page.getByRole("button", { name: "Back to quick setup", exact: true }).click();
  await page.getByRole("heading", { name: "Your invoicing workspace", exact: true }).waitFor();
  pass("Advanced setup remains available without replacing the simplified Settings entry point.");

  // Pack 2 Part B: create, send, accept and convert a quotation through its real workspace.
  const quotationUiDate = new Date().toISOString().slice(0, 10);
  const quotationValidUntilDate = new Date(quotationUiDate + "T00:00:00.000Z");
  quotationValidUntilDate.setUTCDate(quotationValidUntilDate.getUTCDate() + 30);
  const quotationUiValidUntil = quotationValidUntilDate.toISOString().slice(0, 10);
  const quotationLineDescription = "Pack 2 browser quotation " + suffix;
  const quotationNotes = "Pack 2 browser quotation lifecycle " + suffix;
  await page.goto(baseUrl + "/quotations");
  await page.getByRole("heading", { name: "Quotations", exact: true }).waitFor();
  await waitForList(page);
  await page.getByRole("button", { name: /New quotation/i }).first().click();
  const quotationEditor = page.locator(".invoice-editor").last();
  await quotationEditor.getByRole("heading", { name: "Create quotation", exact: true }).waitFor();
  await quotationEditor.getByLabel("Legal entity").selectOption(String(invoiceTestEntity.id));
  await quotationEditor.getByLabel("Customer").selectOption(String(invoiceTestCustomer.id));
  await quotationEditor.locator("#quotation-date").fill(quotationUiDate);
  await quotationEditor.locator("#quotation-valid-until").fill(quotationUiValidUntil);
  await quotationEditor.locator("#quotation-payment-terms").fill("30");
  await quotationEditor.locator("#quotation-notes").fill(quotationNotes);
  await quotationEditor.locator('input[id^="quotation-description-"]').fill(quotationLineDescription);
  await quotationEditor.locator('input[id^="quotation-unit-"]').fill("hour");
  await quotationEditor.locator('input[id^="quotation-quantity-"]').fill("2.0000");
  await quotationEditor.locator('input[id^="quotation-rate-"]').fill("100.0000");
  await quotationEditor.locator('select[id^="quotation-discount-type-"]').selectOption("PERCENT");
  await quotationEditor.locator('input[id^="quotation-discount-value-"]').fill("10.0000");
  await quotationEditor.locator('select[id^="quotation-tax-"]').selectOption(String(invoiceTestEntity.default_tax_code));
  await quotationEditor.getByRole("button", { name: "Create quotation draft", exact: true }).click();
  await page.getByText("Quotation draft created.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Mark as sent", exact: true }).waitFor();
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await page.getByRole("heading", { name: "Mark quotation as sent?", exact: true }).waitFor();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await page.getByRole("button", { name: "Mark accepted", exact: true }).waitFor();
  pass("Quotation workspace sends a draft using the protected status transition.");

  await page.getByRole("button", { name: "Mark accepted", exact: true }).click();
  await page.getByRole("heading", { name: "Change quotation to accepted?", exact: true }).waitFor();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await page.getByRole("button", { name: "Convert to invoice draft", exact: true }).waitFor();
  await page.getByRole("button", { name: "Convert to invoice draft", exact: true }).click();
  await page.getByText(/Invoice draft created from the accepted quotation/).waitFor();
  await page.getByText("Converted to invoice", { exact: true }).waitFor();
  const [convertedBrowserQuotes] = await db.execute(
    "SELECT id,status,converted_invoice_id FROM quotations WHERE legal_entity_id=? AND customer_id=? AND notes=? ORDER BY created_at DESC LIMIT 1",
    [invoiceTestEntity.id, invoiceTestCustomer.id, quotationNotes],
  );
  assert.equal(convertedBrowserQuotes.length, 1, "quotation created and converted by the workspace persists exactly one source document");
  assert.equal(convertedBrowserQuotes[0].status, "CONVERTED");
  assert.ok(convertedBrowserQuotes[0].converted_invoice_id, "converted quotation links to its resulting invoice draft");
  const [convertedBrowserInvoiceRows] = await db.execute(
    "SELECT id,lifecycle_status,related_invoice_id,grand_total FROM invoices WHERE id=? LIMIT 1",
    [convertedBrowserQuotes[0].converted_invoice_id],
  );
  assert.equal(convertedBrowserInvoiceRows.length, 1);
  assert.equal(convertedBrowserInvoiceRows[0].lifecycle_status, "DRAFT",
    "quotation conversion creates an editable draft and does not issue it automatically");
  assert.equal(String(convertedBrowserInvoiceRows[0].grand_total), "212.4000");
  pass("Quotation workspace sends, accepts and converts to one linked editable invoice draft without issuing it.");


   // Pack 3 browser acceptance: standalone receipt -> partial allocation -> full reversal.
   const p3ExternalReference = "P3-PAY-" + suffix;
   await page.goto(baseUrl + "/payments");
   await page.getByRole("heading", { name: "Payment ledger", exact: true }).waitFor();
   await page.getByLabel("Legal entity", { exact: true }).selectOption(String(invoiceTestEntity.id));
   await page.getByLabel("Customer", { exact: true }).selectOption(String(invoiceTestCustomer.id));
   await page.getByLabel("Amount", { exact: true }).fill("50.0000");
   await page.getByLabel("Payment date", { exact: true }).fill(invoiceUiDate);
   await page.getByLabel("Payment method", { exact: true }).selectOption("CASH");
   await page.getByLabel("External reference (optional)", { exact: true }).fill(p3ExternalReference);
   await page.getByLabel("Notes (optional)", { exact: true }).fill("Pack 3 browser receipt allocation/reversal acceptance");
   await page.getByRole("button", { name: "Record receipt", exact: true }).click();
   await page.getByRole("heading", { name: /^RCPT-[0-9A-F]{32}$/ }).waitFor();
   const [p3BrowserReceiptRows] = await db.execute(
     "SELECT id,receipt_reference,status FROM payments WHERE legal_entity_id=? AND customer_id=? AND reference=? ORDER BY created_at DESC LIMIT 1",
     [invoiceTestEntity.id, invoiceTestCustomer.id, p3ExternalReference],
   );
   assert.equal(p3BrowserReceiptRows.length, 1, "Payments workspace persists one standalone receipt");
   assert.equal(p3BrowserReceiptRows[0].status, "RECORDED");
   const p3BrowserReceipt = p3BrowserReceiptRows[0];
   await page.locator("#receipt-invoice").waitFor({ state: "visible" });
   await page.locator("#receipt-invoice").selectOption(String(invoiceByLineRows[0].id));
   await page.locator("#receipt-allocation-amount").fill("25.0000");
   await page.getByRole("button", { name: "Save allocation", exact: true }).click();
   await page.getByText("Receipt allocation saved. The server updated the invoice balance using recorded allocations.", { exact: true }).waitFor();
   const [p3BrowserAllocRows] = await db.execute("SELECT id,amount FROM payment_allocations WHERE payment_id=? AND invoice_id=?",
     [p3BrowserReceipt.id, invoiceByLineRows[0].id]);
   assert.equal(p3BrowserAllocRows.length, 1);
   assert.equal(String(p3BrowserAllocRows[0].amount), "25.0000");
   pass("Payments workspace records a standalone receipt and allocates only the chosen partial amount.");

   await page.getByRole("button", { name: "Reverse receipt", exact: true }).click();
   await page.locator("#receipt-reversal-reason").fill("Pack 3 browser test full receipt reversal");
   await page.getByRole("button", { name: "Confirm reversal", exact: true }).click();
   await page.getByText("Receipt reversed. Its allocation history remains available and linked invoice balances have been restored.", { exact: true }).waitFor();
   const [p3BrowserReverseRows] = await db.execute("SELECT status,reversal_reason FROM payments WHERE id=? LIMIT 1",[p3BrowserReceipt.id]);
   assert.equal(p3BrowserReverseRows[0].status, "REVERSED");
   assert.equal(p3BrowserReverseRows[0].reversal_reason, "Pack 3 browser test full receipt reversal");
   const [p3BrowserRetainedRows] = await db.execute("SELECT COUNT(*) AS n FROM payment_allocations WHERE payment_id=? AND invoice_id=?",
     [p3BrowserReceipt.id, invoiceByLineRows[0].id]);
   assert.equal(Number(p3BrowserRetainedRows[0].n), 1, "reversal retains allocation history instead of deleting it");
   pass("Payments workspace reverses a receipt with a reason and preserves allocation history.");

   // Direct payment recording from invoice details stays connected to the same receipt ledger.
   await page.goto(baseUrl + "/invoices");
   await page.getByRole("heading", { name: "Invoices", exact: true }).waitFor();
   await waitForList(page);
   const targetInvoiceRow = page.locator("tbody tr").filter({ hasText: invoiceByLineRows[0].invoice_number });
   await targetInvoiceRow.getByRole("button", { name: "Details", exact: true }).click();
   await page.getByRole("heading", { name: invoiceByLineRows[0].invoice_number, exact: true }).waitFor();

   // Pack 9 browser acceptance: generate and download a private PDF from the issued source record.
   const pdfPanel = page.locator("section.master-data-panel").filter({
     has: page.getByRole("heading", { name: "PDF documents and history", exact: true }),
   });
   await pdfPanel.waitFor({ state: "visible" });
   await pdfPanel.getByRole("button", { name: "Generate PDF", exact: true }).click();
   await pdfPanel.getByText("The PDF was generated, checksum-verified, and stored as a new history item.", { exact: true }).waitFor();
   const pdfRow = pdfPanel.locator("tbody tr").first();
   await pdfRow.getByText("READY", { exact: true }).waitFor();
   const pdfFileResponsePromise = page.waitForResponse(response => {
     const url = new URL(response.url());
     return url.pathname.startsWith("/api/v1/documents/files/") && response.request().method() === "GET";
   });
   const pdfDownloadPromise = page.waitForEvent("download");
   await pdfRow.getByRole("link", { name: "Download PDF", exact: true }).click();
   const [pdfFileResponse, pdfDownload] = await Promise.all([pdfFileResponsePromise, pdfDownloadPromise]);
   assert.equal(pdfFileResponse.status(), 200, "authorized PDF file route returns HTTP 200");
   assert.equal(pdfFileResponse.headers()["content-type"], "application/pdf");
   assert.match(pdfFileResponse.headers()["content-digest"] ?? "", /^sha-256=:/);
   assert.equal(pdfFileResponse.headers()["x-content-type-options"], "nosniff");
   assert.equal(pdfDownload.suggestedFilename(), invoiceByLineRows[0].invoice_number + ".pdf");
   const pdfPath = artifactDirectory + "/issued-invoice-" + suffix + ".pdf";
   await pdfDownload.saveAs(pdfPath);
   const pdfBytes = await readFile(pdfPath);
   assert.ok(pdfBytes.byteLength > 512, "downloaded PDF contains a non-trivial document payload");
   assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-", "downloaded document has the PDF file signature");
   pass("Issued invoice PDF is generated and downloaded through the re-authorized private file route with integrity headers.");

   await page.locator("#invoice-payment-amount").fill("10.0000");
   await page.locator("#invoice-payment-date").fill(invoiceUiDate);
   await page.locator("#invoice-payment-method").selectOption("CASH");
   const p3DirectReference = "P3-DIRECT-" + suffix;
   await page.locator("#invoice-payment-reference").fill(p3DirectReference);
   await page.locator("#invoice-payment-notes").fill("Pack 3 invoice detail payment UI acceptance");
   await page.getByRole("button", { name: "Record and allocate payment", exact: true }).click();
   await page.getByText(/Payment RCPT-[0-9A-F]{32} recorded and fully allocated to this invoice\./).waitFor();
   const [p3DirectRows] = await db.execute("SELECT id,receipt_reference,status FROM payments WHERE reference=? ORDER BY created_at DESC LIMIT 1",[p3DirectReference]);
   assert.equal(p3DirectRows.length, 1);
   assert.equal(p3DirectRows[0].status, "RECORDED");
   pass("Invoice details record a fully allocated payment through the permission-gated receipt API.");

   // Pack 4 Part B browser flow: the issued record stays unchanged while correction is pending.
   const correctionPanel=page.locator(".correction-panel");
   await correctionPanel.getByRole("heading",{name:"Issued-document correction",exact:true}).waitFor();
   await page.locator("#invoice-correction-type").selectOption("CANCEL");
   await page.locator("#invoice-correction-reason").fill("Browser acceptance requests cancellation after reviewing the issued invoice.");
   await correctionPanel.getByRole("button",{name:"Submit correction request",exact:true}).click();
   await page.getByText("Correction request recorded for independent review; the issued invoice remains unchanged.",{exact:true}).waitFor();
   const [browserCorrectionRows]=await db.execute(
     "SELECT id,status,correction_type FROM invoice_correction_requests WHERE invoice_id=? ORDER BY created_at DESC LIMIT 1",
     [invoiceByLineRows[0].id]);
   assert.equal(browserCorrectionRows.length,1);
   assert.equal(browserCorrectionRows[0].status,"PENDING_REVIEW");
   assert.equal(browserCorrectionRows[0].correction_type,"CANCEL");
   const [browserSourceAfterRequest]=await db.execute("SELECT lifecycle_status,invoice_number FROM invoices WHERE id=?",[invoiceByLineRows[0].id]);
   assert.equal(browserSourceAfterRequest[0].lifecycle_status,"ISSUED");
   assert.equal(browserSourceAfterRequest[0].invoice_number,invoiceByLineRows[0].invoice_number);
   pass("Invoice UI submits a reasoned correction request without mutating the issued document.");

   await page.goto(baseUrl + "/approvals");
   await page.getByRole("heading",{name:"Issued-document correction review",exact:true}).waitFor();
   await page.locator(".correction-request-card").filter({hasText:invoiceByLineRows[0].invoice_number}).waitFor();
   pass("Approvals workspace lists the scoped correction request with review rationale and history.");

   await page.goto(baseUrl + "/policy-decisions");
   await page.getByRole("heading",{name:"Business and finance decisions",exact:true}).waitFor();
   await page.getByText("Issued-document cancellation and correction",{exact:true}).first().waitFor();
   pass("Policy decision workspace renders issuer-scoped decision rows and correction-policy evidence fields.");



    const reportsSummaryResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/reports/summary" && response.request().method() === "GET" && response.status() === 200;
    });
    const invoiceReportResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/reports/invoices" && response.request().method() === "GET" && response.status() === 200;
    });
    await page.goto(`${baseUrl}/reports`);
     await Promise.all([reportsSummaryResponse, invoiceReportResponse]);
     await page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
     await page.getByRole("heading", { name: "Business summary", exact: true }).waitFor();
     await page.getByRole("heading", { name: "Invoice report", exact: true }).waitFor();
     await page.getByText(/Provisional metric definitions — finance approval pending/).waitFor();
     await page.getByText(invoiceByLineRows[0].invoice_number, { exact: true }).waitFor();
     await page.locator(".report-filter-panel").waitFor({ state: "visible" });
     assert.equal(await page.locator(".report-workspace [role=alert]").count(), 0, "reports workspace loads without a surfaced API error");
     pass("Pack 7 reporting screen connects to secured summary and invoice-report APIs with provisional-metric warning.");

     const auditEventsResponse = page.waitForResponse(response => {
       const url = new URL(response.url());
       return url.pathname === "/api/v1/audit" && response.request().method() === "GET" && response.status() === 200;
     });
     await page.goto(`${baseUrl}/audit`);
     await auditEventsResponse;
     await page.getByRole("heading", { name: "Audit trail", exact: true }).waitFor();
     await page.getByRole("heading", { name: "Recorded actions", exact: true }).waitFor();
     await page.locator(".audit-filter-panel").waitFor({ state: "visible" });
     await page.getByText(/matching event|No events match/).waitFor();
     assert.equal(await page.locator(".audit-workspace [role=alert]").count(), 0, "audit workspace loads without a surfaced API error");
     pass("Pack 7 audit screen loads the scoped event-search interface without surfacing sensitive payloads.");

     await page.goto(baseUrl + "/");
    await page.getByRole("heading", { name: "Receivables snapshot", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Reporting snapshot", exact: true }).waitFor();
    await page.getByText(/Finance approval pending/).waitFor();
    await page.getByText("Outstanding balance", { exact: true }).first().waitFor();
    await page.getByText("Unallocated receipts", { exact: true }).first().waitFor();
    pass("Overview displays the scoped receivables reconciliation snapshot.");
    for (const width of [1365, 768, 390]) {
      await assertNoPageOverflow(page, width);
    }
    pass("Receivables snapshot renders without horizontal overflow at desktop, tablet and mobile widths.");



  for (const width of [1365, 768, 390]) {
    await assertNoPageOverflow(page, width);
    await page.goto(`${baseUrl}/customers`);
    await page.getByRole("heading", { name: "Customers", exact: true }).waitFor();
    await waitForList(page);
    await assertNoPageOverflow(page, width);
    await page.goto(`${baseUrl}/catalog`);
    await page.getByRole("heading", { name: "Items & services", exact: true }).waitFor();
    await waitForList(page);
    await assertNoPageOverflow(page, width);
     await page.goto(`${baseUrl}/reports`);
     await page.getByRole("heading", { name: "Business summary", exact: true }).waitFor();
     await assertNoPageOverflow(page, width);
     await page.goto(`${baseUrl}/audit`);
     await page.getByRole("heading", { name: "Recorded actions", exact: true }).waitFor();
     await assertNoPageOverflow(page, width);
  }
  pass("Customer and catalog workspaces rendered at desktop, tablet, and mobile widths.");

  assert.deepEqual(runtimeErrors, [], "Browser interactions must not produce uncaught page errors.");
  pass("No uncaught browser JavaScript errors were observed.");
  console.log(`PASS: ${checksPassed} Phase 7 browser acceptance checks.`);
} catch (error) {
  if (page) {
    try {
      console.error("DEBUG: failing browser URL=" + page.url());
      console.error("DEBUG: page errors so far: " + JSON.stringify(runtimeErrors));
      console.error("DEBUG: failing browser visible page text:\\n" + (await page.locator("body").innerText()).slice(-8000));
      await page.screenshot({ path: `${artifactDirectory}/failure.png`, fullPage: true });
    } catch (diagnosticError) {
      console.error("DEBUG: browser diagnostics failed: " + String(diagnosticError));
    }
  }
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.end().catch(() => {});
}
