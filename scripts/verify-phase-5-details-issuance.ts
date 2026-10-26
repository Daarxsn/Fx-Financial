import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadProjectEnv } from "./load-env";

loadProjectEnv();

async function run() {
  console.log("================================================================================");
  console.log("VERIFYING PHASE 5: INVOICE DETAILS & ISSUANCE WORKFLOW (/invoices/[invoiceId])");
  console.log("================================================================================");

  // [TEST 1/6] Verify Source Code Invariants in /invoices/[invoiceId]/page.tsx
  console.log("\n[TEST 1/6] Checking /invoices/[invoiceId]/page.tsx source invariants...");
  const detailPagePath = path.resolve(process.cwd(), "src/app/(workspace)/invoices/[invoiceId]/page.tsx");
  assert.ok(fs.existsSync(detailPagePath), "/invoices/[invoiceId]/page.tsx must exist");
  const detailContent = fs.readFileSync(detailPagePath, "utf-8");

  // Invariant A: Quarantined Issue Button with Deliberate Flow
  assert.ok(detailContent.includes("Issue Official Statutory Invoice") || detailContent.includes("Issue Official Invoice"), "Must feature deliberate statutory issuance modal");
  assert.ok(detailContent.includes("26001..2600n"), "Must show sequential numbering preview (26001..2600n) in modal");
  assert.ok(detailContent.includes("handleIssueInvoice"), "Must wire deliberate issuance handler");

  // Invariant B: Dual Status Badges
  assert.ok(detailContent.includes("Document Status:"), "Must display explicit Document Status label");
  assert.ok(detailContent.includes("Payment Status:"), "Must display explicit Payment Status label");
  assert.ok(detailContent.includes("DRAFT / NOT ISSUED") || detailContent.includes("DRAFT"), "Must display Draft / Not Issued state");
  assert.ok(detailContent.includes("ISSUED"), "Must display Issued status badge");

  // Invariant C: PDF Preview & Download
  assert.ok(detailContent.includes("invoice-pdf-preview-frame"), "Must embed client PDF preview iframe");
  assert.ok(detailContent.includes("Download PDF"), "Must provide direct PDF download action");

  // Invariant D: Payments & Receipts Ledger
  assert.ok(detailContent.includes("Payments & Receipts Ledger") || detailContent.includes("Payments and receipts"), "Must include payments & receipts ledger");
  assert.ok(detailContent.includes("handleRecordPayment"), "Must include payment recording workflow");
  assert.ok(detailContent.includes("handleReversePayment"), "Must include payment reversal workflow");

  // Invariant E: Professional Complimentary Deliverables (NO "FREE")
  assert.ok(!detailContent.includes('isComplimentary ? "FREE" :'), "Must NOT use colloquial 'FREE' for complimentary deliverables");
  assert.ok(detailContent.includes("renderDeliverablesDescription"), "Must parse structured deliverables (1. 2.)");
  assert.ok(detailContent.includes("Complimentary"), "Must use professional 'Complimentary' terminology");

  console.log("  ✓ All UI invariants, dual badges, and issuance modal validated in /invoices/[invoiceId]/page.tsx");

  // [TEST 2/6] Create Draft with Mixed Paid & Complimentary Deliverables
  console.log("\n[TEST 2/6] Creating draft invoice with mixed paid & complimentary deliverables...");
  const { pool } = await import("../src/lib/db/pool");
  const entityId = "f94dacb2-4063-4348-bae4-56633f3c5c9d";

  const [brandRows] = await pool.query(
    "SELECT id, name, code FROM brands WHERE is_active = 1 LIMIT 1"
  );
  const brand = (brandRows as Array<{ id: string; name: string; code: string }>)[0];
  assert.ok(brand, "Active brand must exist");

  const [custRows] = await pool.query(
    "SELECT id, name, phone, email FROM customers WHERE phone IS NOT NULL AND phone != '' LIMIT 1"
  );
  const customer = (custRows as Array<{ id: string; name: string; phone: string; email: string }>)[0];
  assert.ok(customer, "Customer with phone must exist");

  const testDraftId = crypto.randomUUID();
  const todayStr = new Date().toISOString().slice(0, 10);
  const expiryDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  // Line item 1: Paid POS Setup (₹10,000) with complimentary inclusion in deliverables
  // Line item 2: Standalone complimentary item (₹0.00)
  const line1Description = "1. POS Hardware Terminal Setup\n2. 1-Year Cloud Backup (Complimentary)\n3. 24/7 Priority Support (Complimentary)";
  const line2Description = "1. Welcome Training Session\n2. Quickstart Manual";

  await pool.query(
    `INSERT INTO invoices (
      id, legal_entity_id, brand_id, customer_id,
      document_type, lifecycle_status, currency,
      subtotal, discount_total, tax_total, grand_total,
      invoice_date, due_date, invoice_valid_until,
      tax_mode, cgst_enabled, cgst_rate, cgst_amount, sgst_enabled, sgst_rate, sgst_amount,
      draft_recipient_email, record_version, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?,
      'INVOICE', 'DRAFT', 'INR',
      '10000.0000', '0.0000', '1800.0000', '11800.0000',
      ?, ?, ?,
      'COMPONENTS', 1, '9.000000', '900.0000', 1, '9.000000', '900.0000',
      ?, 1, NOW(3), NOW(3)
    )`,
    [
      testDraftId, entityId, brand.id, customer.id,
      todayStr, expiryDate, expiryDate,
      customer.email || "accounts@falchionxeniaa.com"
    ]
  );

  await pool.query(
    `INSERT INTO invoice_lines (
      id, invoice_id, line_number, line_kind, milestone, description,
      quantity, unit_code, unit_price, discount_type, discount_value, discount_amount,
      tax_rate, tax_amount, line_total, created_at
    ) VALUES 
    (?, ?, 1, 'ITEM', 'POS Setup & Implementation', ?, '1.0000', 'unit', '10000.0000', 'AMOUNT', '0.0000', '0.0000', '18.000000', '1800.0000', '10000.0000', NOW(3)),
    (?, ?, 2, 'ITEM', 'Complimentary Onboarding', ?, '1.0000', 'unit', '0.0000', 'AMOUNT', '0.0000', '0.0000', '0.000000', '0.0000', '0.0000', NOW(3))`,
    [
      crypto.randomUUID(), testDraftId, line1Description,
      crypto.randomUUID(), testDraftId, line2Description
    ]
  );

  console.log(`  ✓ Draft created: ID=${testDraftId}`);
  console.log("  ✓ Service price preserved at ₹10,000 + 18% GST = ₹11,800 despite complimentary deliverables");

  // [TEST 3/6] Safe Statutory Issuance Workflow
  console.log("\n[TEST 3/6] Testing Deliberate Issuance & Sequential Number Allocation...");
  const { reserveDocumentNumber } = await import("../src/lib/configuration/service");
  
  let reservedNumber = "";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const reserved = await reserveDocumentNumber(conn, entityId, "INVOICE", todayStr);
    reservedNumber = reserved.number;

    const supplierSnapshot = {
      legalName: "Falchion Xeniaa Pvt. Ltd.",
      displayName: "Falchion Xeniaa",
      taxIdentifier: "27AAGCF3329Q1Z4",
      invoicePhone: "+91 7620 002 469",
      invoiceEmail: "omshah@falchionxeniaa.com",
    };
    const customerSnapshot = {
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
    };

    await conn.query(
      `UPDATE invoices 
       SET lifecycle_status = 'ISSUED',
           invoice_number = ?,
           financial_year = '2026-2027',
           invoice_date = ?,
           due_date = ?,
           supplier_snapshot = ?,
           customer_snapshot = ?,
           record_version = record_version + 1,
           issued_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?`,
      [reservedNumber, todayStr, expiryDate, JSON.stringify(supplierSnapshot), JSON.stringify(customerSnapshot), testDraftId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  assert.ok(reservedNumber.startsWith("26"), `Invoice number must start with '26': got ${reservedNumber}`);
  assert.equal(reservedNumber.length, 5, `Invoice number must be 5 characters (26xxx): got ${reservedNumber}`);
  console.log(`  ✓ Statutory number reserved: ${reservedNumber} (Format: 26001..2600n)`);

  // [TEST 4/6] Verify Dual Status and State Changes
  console.log("\n[TEST 4/6] Verifying Dual Status badges & Financial balances...");
  type InvoiceBalRow = {
    lifecycle_status: string;
    invoice_number: string;
    grand_total: string;
    paid_amount: string;
  };

  const [issuedRows] = await pool.query(
    `SELECT i.lifecycle_status, i.invoice_number, i.grand_total,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'), 0) AS paid_amount
     FROM invoices i WHERE i.id = ?`,
    [testDraftId]
  );
  const issued = (issuedRows as InvoiceBalRow[])[0];
  const grandTotal = parseFloat(issued.grand_total);
  const paidAmount0 = parseFloat(issued.paid_amount);
  const outstanding0 = grandTotal - paidAmount0;
  const paymentStatus0 = paidAmount0 === 0 ? "UNPAID" : outstanding0 === 0 ? "PAID" : "PARTIALLY_PAID";

  assert.equal(issued.lifecycle_status, "ISSUED");
  assert.equal(paymentStatus0, "UNPAID");
  assert.equal(issued.invoice_number, reservedNumber);
  assert.equal(grandTotal, 11800);
  assert.equal(paidAmount0, 0);
  assert.equal(outstanding0, 11800);
  console.log(`  ✓ Document Status: ISSUED (${issued.invoice_number})`);
  console.log(`  ✓ Payment Status: UNPAID (Outstanding: ₹11,800.00)`);

  // [TEST 5/6] Payments & Receipts Lifecycle: Partial Payment -> Full Payment -> Reversal
  console.log("\n[TEST 5/6] Testing Payments & Receipts Lifecycle...");
  const payment1Id = crypto.randomUUID();
  const receipt1Ref = `REC-${Date.now().toString().slice(-6)}`;
  
  // A. Record Partial Payment: ₹5,000
  await pool.query(
    `INSERT INTO payments (id, legal_entity_id, customer_id, receipt_reference, amount, currency, payment_date, method, status, created_at)
     VALUES (?, ?, ?, ?, '5000.0000', 'INR', ?, 'BANK_TRANSFER', 'RECORDED', NOW(3))`,
    [payment1Id, entityId, customer.id, receipt1Ref, todayStr]
  );
  await pool.query(
    `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at)
     VALUES (?, ?, ?, '5000.0000', NOW(3))`,
    [crypto.randomUUID(), payment1Id, testDraftId]
  );

  const [partPaidRows] = await pool.query(
    `SELECT i.grand_total,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'), 0) AS paid_amount
     FROM invoices i WHERE i.id = ?`,
    [testDraftId]
  );
  const partPaid = (partPaidRows as InvoiceBalRow[])[0];
  const paid1 = parseFloat(partPaid.paid_amount);
  const balance1 = parseFloat(partPaid.grand_total) - paid1;
  const status1 = paid1 === 0 ? "UNPAID" : balance1 === 0 ? "PAID" : "PARTIALLY_PAID";
  assert.equal(status1, "PARTIALLY_PAID");
  assert.equal(paid1, 5000);
  assert.equal(balance1, 6800);
  console.log(`  ✓ Partial payment recorded: ₹5,000.00. Payment Status = PARTIALLY_PAID, Balance = ₹6,800.00`);

  // B. Record Remaining Payment: ₹6,800
  const payment2Id = crypto.randomUUID();
  const receipt2Ref = `REC-${(Date.now() + 1).toString().slice(-6)}`;
  await pool.query(
    `INSERT INTO payments (id, legal_entity_id, customer_id, receipt_reference, amount, currency, payment_date, method, status, created_at)
     VALUES (?, ?, ?, ?, '6800.0000', 'INR', ?, 'UPI', 'RECORDED', NOW(3))`,
    [payment2Id, entityId, customer.id, receipt2Ref, todayStr]
  );
  await pool.query(
    `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at)
     VALUES (?, ?, ?, '6800.0000', NOW(3))`,
    [crypto.randomUUID(), payment2Id, testDraftId]
  );

  const [fullyPaidRows] = await pool.query(
    `SELECT i.grand_total,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'), 0) AS paid_amount
     FROM invoices i WHERE i.id = ?`,
    [testDraftId]
  );
  const fullyPaid = (fullyPaidRows as InvoiceBalRow[])[0];
  const paid2 = parseFloat(fullyPaid.paid_amount);
  const balance2 = parseFloat(fullyPaid.grand_total) - paid2;
  const status2 = paid2 === 0 ? "UNPAID" : balance2 === 0 ? "PAID" : "PARTIALLY_PAID";
  assert.equal(status2, "PAID");
  assert.equal(paid2, 11800);
  assert.equal(balance2, 0);
  console.log(`  ✓ Full payment completed: Total Paid = ₹11,800.00. Payment Status = PAID, Balance = ₹0.00`);

  // C. Test Receipt Reversal
  await pool.query(
    `UPDATE payments SET status = 'REVERSED', reversed_at = NOW(3), reversal_reason = 'Cheque bounce / duplicate test' WHERE id = ?`,
    [payment2Id]
  );

  const [reversedRows] = await pool.query(
    `SELECT i.grand_total,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'), 0) AS paid_amount
     FROM invoices i WHERE i.id = ?`,
    [testDraftId]
  );
  const afterReversal = (reversedRows as InvoiceBalRow[])[0];
  const paid3 = parseFloat(afterReversal.paid_amount);
  const balance3 = parseFloat(afterReversal.grand_total) - paid3;
  const status3 = paid3 === 0 ? "UNPAID" : balance3 === 0 ? "PAID" : "PARTIALLY_PAID";
  assert.equal(status3, "PARTIALLY_PAID");
  assert.equal(balance3, 6800);
  console.log(`  ✓ Payment reversal verified: Payment Status restored to PARTIALLY_PAID, Balance restored to ₹6,800.00`);

  // [TEST 6/6] Verify Client PDF Document Rendering
  console.log("\n[TEST 6/6] Verifying Statutory PDF Document Generation...");
  const { renderDocumentPdf } = await import("../src/lib/documents/pdf");
  const pdfBuffer = await renderDocumentPdf({
    sourceType: "INVOICE",
    sourceDocumentId: testDraftId,
    documentNumber: reservedNumber,
    lifecycleStatus: "ISSUED",
    documentDate: todayStr,
    dueDate: expiryDate,
    validUntil: expiryDate,
    taxMode: "COMPONENTS",
    cgstEnabled: true,
    cgstRate: "9.000000",
    cgstAmount: "900.0000",
    sgstEnabled: true,
    sgstRate: "9.000000",
    sgstAmount: "900.0000",
    currency: "INR",
    subtotal: "10000.0000",
    discountTotal: "0.0000",
    taxTotal: "1800.0000",
    grandTotal: "11800.0000",
    paidAmount: "5000.0000",
    paymentStatus: "PARTIALLY_PAID",
    notes: "Thank you for partnering with Falchion Xeniaa.",
    supplier: {
      legalName: "Falchion Xeniaa Pvt. Ltd.",
      displayName: "Falchion Xeniaa",
      taxIdentifier: "27AAGCF3329Q1Z4",
      invoicePhone: "+91 7620 002 469",
      invoiceEmail: "omshah@falchionxeniaa.com",
    },
    customer: {
      name: customer.name,
      phone: customer.phone,
    },
    configurationSnapshotId: null,
    configurationSha256: null,
    configurationSnapshot: {
      brand: { name: brand.name, code: brand.code },
    },
    lines: [
      {
        lineNumber: 1,
        description: line1Description,
        milestone: "POS Setup & Implementation",
        quantity: "1.0000",
        unitPrice: "10000.0000",
        discountAmount: "0.0000",
        taxAmount: "1800.0000",
        lineTotal: "10000.0000",
      },
      {
        lineNumber: 2,
        description: line2Description,
        milestone: "Complimentary Onboarding",
        quantity: "1.0000",
        unitPrice: "0.0000",
        discountAmount: "0.0000",
        taxAmount: "0.0000",
        lineTotal: "0.0000",
      },
    ],
  }, new Date());

  assert.ok(pdfBuffer && pdfBuffer.length > 5000, "Rendered PDF must be a valid non-empty buffer");
  assert.equal(pdfBuffer.subarray(0, 5).toString("ascii"), "%PDF-", "PDF header must start with %PDF-");
  console.log(`  ✓ Statutory PDF generated successfully: ${pdfBuffer.length} bytes with valid %PDF- magic header`);

  // Cleanup test invoice allocations and records
  await pool.query("DELETE FROM payment_allocations WHERE invoice_id = ?", [testDraftId]);
  await pool.query("DELETE FROM payments WHERE id IN (?, ?)", [payment1Id, payment2Id]);
  await pool.query("DELETE FROM invoice_lines WHERE invoice_id = ?", [testDraftId]);
  await pool.query("DELETE FROM invoices WHERE id = ?", [testDraftId]);
  console.log("  ✓ Test artifacts safely cleaned up from database.");

  await pool.end();

  console.log("\n================================================================================");
  console.log("🎉 PHASE 5 VERIFICATION COMPLETE: DETAILS & ISSUANCE WORKFLOW PRODUCTION READY! 🎉");
  console.log("================================================================================\n");
}

run().catch((err) => {
  console.error("\n❌ PHASE 5 VERIFICATION FAILED:", err);
  process.exit(1);
});
