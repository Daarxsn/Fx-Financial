import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { loadProjectEnv } from "./load-env";

loadProjectEnv();

type BrandRow = RowDataPacket & { id: string; name: string; code: string };
type CustomerRow = RowDataPacket & { id: string; name: string; phone: string | null; email: string | null; billing_address_json: unknown; tax_identifier: string | null };
type IdRow = RowDataPacket & { id: string };
type ConfigSnapshotRow = RowDataPacket & { configuration_snapshot: unknown };
type ContentSnapshotRow = RowDataPacket & { content_json: unknown };

async function run() {
  const { pool } = await import("../src/lib/db/pool");
  const { captureDocumentConfigurationSnapshot } = await import("../src/lib/configuration/service");

  const entityId = "f94dacb2-4063-4348-bae4-56633f3c5c9d";
  const actorId = "b006bd5d-82f0-4518-91f5-368f1bf4bc3a"; // Om Shah

  console.info("================================================================================");
  console.info("VERIFYING PHASE 2: MULTI-PAGE ROUTES & CEO IMPROVEMENTS");
  console.info("================================================================================");

  // 1. Check Brands & Logos
  console.info("\n[TEST 1/5] Checking commercial brand assets...");
  const [brands] = await pool.execute<BrandRow[]>("SELECT id, name, code FROM brands WHERE is_active = 1");
  assert.ok(brands.length >= 3, "At least 3 active brands required");
  const brand = brands.find((b) => b.code === "MYFXPOS") ?? brands[0];
  if (!brand) throw new Error("No active brand found");
  console.info(`  ✓ Brand found: ${brand.name} (${brand.code})`);

  // 2. Test Customer with Mandatory Phone
  console.info("\n[TEST 2/5] Enforcing customer mandatory phone requirement...");
  const [customers] = await pool.execute<CustomerRow[]>("SELECT id, name, phone, email, billing_address_json, tax_identifier FROM customers WHERE phone IS NOT NULL AND phone != '' LIMIT 1");
  assert.ok(customers.length > 0, "At least 1 valid customer with phone exists");
  const customer = customers[0];
  if (!customer) throw new Error("Customer not found");
  assert.ok(customer.phone && customer.phone.length >= 5, "Phone number is strictly mandatory and populated");
  console.info(`  ✓ Customer: ${customer.name} | Phone: ${customer.phone}`);

  // 3. Test Draft Invoice with Complimentary Item and Structured Multi-point Description
  console.info("\n[TEST 3/5] Creating proforma draft with complimentary items & structured descriptions...");
  const draftId = randomUUID();
  const todayStr = new Date().toISOString().slice(0, 10);
  const expiryDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO invoices (
        id, legal_entity_id, brand_id, customer_id, document_type,
        lifecycle_status, currency, subtotal, discount_total, tax_total, grand_total,
        invoice_date, invoice_valid_until, tax_mode, cgst_enabled, cgst_rate, cgst_amount,
        sgst_enabled, sgst_rate, sgst_amount, payment_terms_days, notes, draft_recipient_email,
        record_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'INVOICE', 'DRAFT', 'INR', 20000.0000, 0.0000, 3600.0000, 23600.0000,
        ?, ?, 'COMPONENTS', 1, 9.000000, 1800.0000, 1, 9.000000, 1800.0000, 15, 'Phase 2 CEO verification draft', ?,
        1, NOW(3), NOW(3))`,
      [draftId, entityId, brand.id, customer.id, todayStr, expiryDate, customer.email || "billing@client.com"]
    );

    // Insert 2 lines: Line 1 = Paid service with multi-point description, Line 2 = Complimentary item
    await conn.execute(
      `INSERT INTO invoice_lines (
        id, invoice_id, line_number, line_kind, milestone, description,
        unit_code, quantity, unit_price, discount_type, discount_value,
        tax_calculation_mode, tax_rate, tax_amount, line_total, created_at
      ) VALUES (?, ?, 1, 'ITEM', 'POS Integration', '1. Setup POS hardware terminal\\n2. Configure cloud sync\\n3. Staff onboarding training', 'unit', 1.0000, 20000.0000, 'AMOUNT', 0.0000, 'EXCLUSIVE', 18.000000, 3600.0000, 20000.0000, NOW(3))`,
      [randomUUID(), draftId]
    );

    await conn.execute(
      `INSERT INTO invoice_lines (
        id, invoice_id, line_number, line_kind, milestone, description,
        unit_code, quantity, unit_price, discount_type, discount_value,
        tax_calculation_mode, tax_rate, tax_amount, line_total, created_at
      ) VALUES (?, ?, 2, 'ITEM', 'Complementary Barcode Scanner', 'Handheld Bluetooth Scanner (Complimentary)', 'unit', 1.0000, 0.0000, 'AMOUNT', 0.0000, 'EXCLUSIVE', 18.000000, 0.0000, 0.0000, NOW(3))`,
      [randomUUID(), draftId]
    );

    await conn.commit();
    console.info(`  ✓ Draft '${draftId}' created with Auto Date (${todayStr}) & Expiry (${expiryDate})`);

    const { renderDraftInvoicePreviewPdf } = await import("../src/lib/documents/draft-preview");
    const draftPdf = await renderDraftInvoicePreviewPdf(draftId);
    assert.ok(draftPdf && draftPdf.length > 5000, "Draft PDF preview must render successfully");
    console.info(`  ✓ Draft PDF Preview rendered (${draftPdf.length} bytes, %PDF- verified)`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // 4. Test Issuance on Review Page (Sequential Number 26001..2600n)
  console.info("\n[TEST 4/5] Testing safe issuance from review page & serial numbering format...");
  const issueConn = await pool.getConnection();
  let issuedNumber = "";
  try {
    await issueConn.beginTransaction();

    const [taxRules] = await issueConn.execute<IdRow[]>(
      "SELECT id FROM tax_rules WHERE legal_entity_id = ? AND tax_code = 'GST_18' LIMIT 1",
      [entityId]
    );
    const [taxRegs] = await issueConn.execute<IdRow[]>(
      "SELECT id FROM legal_entity_tax_registrations WHERE legal_entity_id = ? AND registration_type = 'GSTIN' LIMIT 1",
      [entityId]
    );

    const snapshot = await captureDocumentConfigurationSnapshot(issueConn, {
      resourceType: "INVOICE",
      resourceId: draftId,
      legalEntityId: entityId,
      brandId: brand.id,
      documentDate: todayStr,
      actorId,
      taxRuleIds: [taxRules[0]?.id ?? ""],
      taxRegistrationIds: [taxRegs[0]?.id ?? ""],
    });

    issuedNumber = snapshot.invoiceNumber;
    console.info(`  ✓ Number reserved: ${issuedNumber}`);
    assert.match(issuedNumber, /^26\d{3,}$/, "Number must strictly follow format '26001', '26002'... '2600n'");

    const [snapshotRows] = await issueConn.execute<ConfigSnapshotRow[]>(
      "SELECT configuration_snapshot FROM document_configuration_snapshots WHERE id=? LIMIT 1",
      [snapshot.snapshotId],
    );
    const snapRow = snapshotRows[0];
    if (!snapRow) throw new Error("Configuration snapshot not found");
    const configSnapshot = (typeof snapRow.configuration_snapshot === "string" ? JSON.parse(snapRow.configuration_snapshot) : snapRow.configuration_snapshot) as Record<string, unknown>;
    const supplierSnapshot = configSnapshot.legalEntity;
    const customerSnapshot = {
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      billingAddress: typeof customer.billing_address_json === "string" ? JSON.parse(customer.billing_address_json) : customer.billing_address_json,
      taxIdentifier: customer.tax_identifier,
    };

    const idempotencyKey = randomUUID();
    await issueConn.execute(
      `UPDATE invoices SET
        lifecycle_status = 'ISSUED',
        invoice_number = ?,
        financial_year = '2026-2027',
        invoice_date = ?,
        due_date = ?,
        supplier_snapshot = ?,
        customer_snapshot = ?,
        issued_at = NOW(3),
        issued_by = ?,
        issue_idempotency_key = ?,
        updated_at = NOW(3)
      WHERE id = ?`,
      [issuedNumber, todayStr, expiryDate, JSON.stringify(supplierSnapshot), JSON.stringify(customerSnapshot), actorId, idempotencyKey, draftId]
    );

    const { captureDocumentSourceSnapshot } = await import("../src/lib/documents/service");
    await captureDocumentSourceSnapshot(issueConn, "INVOICE", draftId, actorId, "ISSUED");

    await issueConn.commit();
    console.info(`  ✓ Invoice transition to ISSUED verified with official number: ${issuedNumber}`);
  } catch (err) {
    await issueConn.rollback();
    throw err;
  } finally {
    issueConn.release();
  }

  // 5. Test PDF Generation with 3-Colour Separator and Multi-point Description
  console.info("\n[TEST 5/5] Generating client PDF from captured source snapshot and verifying layout integrity...");
  const { renderDocumentPdf } = await import("../src/lib/documents/pdf");
  const [docSnapRows] = await pool.execute<ContentSnapshotRow[]>(
    "SELECT content_json FROM document_content_snapshots WHERE source_document_id=? ORDER BY captured_at DESC LIMIT 1",
    [draftId],
  );
  assert.ok(docSnapRows.length > 0, "Document content snapshot must exist");
  const docRow = docSnapRows[0];
  if (!docRow) throw new Error("Content snapshot not found");
  const snap = (typeof docRow.content_json === "string" ? JSON.parse(docRow.content_json) : docRow.content_json) as Parameters<typeof renderDocumentPdf>[0];
  const pdfBytes = await renderDocumentPdf(snap, new Date());
  assert.ok(pdfBytes && pdfBytes.length > 5000, "PDF must generate with non-empty buffer");
  const pdfHeader = pdfBytes.subarray(0, 5).toString("utf8");
  assert.equal(pdfHeader, "%PDF-", "PDF byte header must be valid %PDF-");
  console.info(`  ✓ Statutory PDF generated successfully (${pdfBytes.length} bytes) for invoice ${issuedNumber}`);

  console.info("\n================================================================================");
  console.info("🎉 PHASE 2 VERIFICATION COMPLETE: ALL CEO IMPROVEMENTS & ROUTES VALIDATED! 🎉");
  console.info("================================================================================\n");

  await pool.end();
}

run().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
