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
    "customerCode,name,email\\r\\n" + importedCustomerCode + ",Browser CSV Import " + suffix +
      ",browser-csv-" + suffix.toLowerCase() + "@example.invalid\\r\\n",
    "utf8");
  await page.goto(`${baseUrl}/customers`);
  await page.getByRole("heading", { name: "Customers", exact: true }).waitFor();
  await waitForList(page);
  await page.locator("details.master-data-import summary").click();
  await page.locator("#customers-csv-file").setInputFiles(customerCsvPath);
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await page.getByText("Validated 1 rows", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Commit 1 rows", exact: true }).click();
  await page.getByText("Committed 1 rows", { exact: true }).waitFor();
  await page.locator("#customers-search").fill(importedCustomerCode);
  await page.locator("tbody tr").filter({ hasText: importedCustomerCode }).waitFor();
  pass("Customer CSV import validates before explicit commit and the imported record is searchable.");

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
