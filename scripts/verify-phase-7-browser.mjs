import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
  const [invoiceCustomerRows] = await db.execute(
    "SELECT id,name FROM customers WHERE customer_code=? AND is_active=TRUE LIMIT 1",
    [importedCustomerCode],
  );
  assert.equal(invoiceCustomerRows.length, 1, "invoice/quotation browser flow uses the active CSV-imported customer");
  const invoiceTestCustomer = invoiceCustomerRows[0];
  const invoiceUiDate = new Date().toISOString().slice(0, 10);
  const invoiceLineDescription = "Pack 2 browser invoice " + suffix;
  await page.goto(baseUrl + "/invoices");
  await page.getByRole("heading", { name: "Invoices", exact: true }).waitFor();
  await waitForList(page);
  await page.getByRole("button", { name: /New invoice/i }).first().click();
  const invoiceEditor = page.locator(".invoice-editor").last();
  await invoiceEditor.getByRole("heading", { name: "Create invoice draft", exact: true }).waitFor();
  await invoiceEditor.getByLabel("Legal entity").selectOption(String(invoiceTestEntity.id));
  await invoiceEditor.getByLabel("Customer").selectOption(String(invoiceTestCustomer.id));
  await invoiceEditor.getByLabel("Invoice date").fill(invoiceUiDate);
  await invoiceEditor.getByLabel("Description").fill(invoiceLineDescription);
  await invoiceEditor.getByLabel("Unit", { exact: true }).fill("hour");
  await invoiceEditor.getByLabel("Quantity").fill("2.0000");
  await invoiceEditor.getByLabel("Unit rate").fill("100.0000");
  await invoiceEditor.getByLabel("Discount type").selectOption("PERCENT");
  await invoiceEditor.getByLabel("Discount (%)").fill("10.0000");
  await invoiceEditor.getByLabel("Approved tax code").selectOption(String(invoiceTestEntity.default_tax_code));
  await invoiceEditor.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByText("Draft saved. Authoritative totals were recalculated by the server.", { exact: true }).waitFor();
  await page.getByText("INR 212.4000", { exact: true }).first().waitFor();
  pass("Invoice workspace creates a real draft and displays server-calculated exact-decimal totals.");

  const editableInvoice = page.locator(".invoice-editor").last();
  await editableInvoice.getByLabel("Unit rate").fill("120.0000");
  await editableInvoice.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved. Authoritative totals were recalculated by the server.", { exact: true }).waitFor();
  await page.getByText("INR 254.8800", { exact: true }).first().waitFor();
  await page.locator(".invoice-editor").last().getByRole("button", { name: "Close", exact: true }).click();
  await page.getByText("INVOICE DETAILS", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Issue invoice", exact: true }).click();
  await page.getByText("Invoice issued successfully. Its number and issue-time configuration snapshot are preserved.", { exact: true }).waitFor();
  const [invoiceByLineRows] = await db.execute(
    "SELECT i.id,i.lifecycle_status,i.invoice_number,i.grand_total FROM invoices i JOIN invoice_lines l ON l.invoice_id=i.id " +
      "WHERE i.legal_entity_id=? AND i.customer_id=? AND l.description=? ORDER BY i.created_at DESC LIMIT 1",
    [invoiceTestEntity.id, invoiceTestCustomer.id, invoiceLineDescription],
  );
  assert.equal(invoiceByLineRows.length, 1, "invoice created and issued by the workspace persists exactly one matching document");
  assert.equal(invoiceByLineRows[0].lifecycle_status, "ISSUED");
  assert.ok(invoiceByLineRows[0].invoice_number, "issue action allocates the official invoice number");
  assert.equal(String(invoiceByLineRows[0].grand_total), "254.8800");
  const [issuedBrowserSnapshots] = await db.execute(
    "SELECT configuration_sha256 FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
    [invoiceByLineRows[0].id],
  );
  assert.equal(issuedBrowserSnapshots.length, 1, "UI issuance persists one immutable configuration snapshot");
  assert.match(String(issuedBrowserSnapshots[0].configuration_sha256), /^[0-9a-f]{64}$/);
  pass("Invoice workspace edits the draft, issues it, allocates a number, and persists one integrity-hashed snapshot.");

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
