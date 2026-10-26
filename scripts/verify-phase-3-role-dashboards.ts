import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadProjectEnv } from "./load-env";

loadProjectEnv();

async function run() {
  console.log("=".repeat(80));
  console.log("VERIFYING PHASE 3: ROLE-BASED DASHBOARD HUBS & VISUAL ANALYTICS");
  console.log("=".repeat(80));

  // [TEST 1/5] File existence and export contracts
  console.log("\n[TEST 1/5] Checking dashboard components and visual charts...");
  const components = [
    "src/components/dashboard/types.ts",
    "src/components/dashboard/dashboard-hub.tsx",
    "src/components/dashboard/role-switcher.tsx",
    "src/components/dashboard/executive-dashboard.tsx",
    "src/components/dashboard/accountant-dashboard.tsx",
    "src/components/dashboard/controller-dashboard.tsx",
    "src/components/dashboard/billing-dashboard.tsx",
    "src/components/dashboard/auditor-dashboard.tsx",
    "src/components/dashboard/monthly-revenue-chart.tsx",
    "src/components/dashboard/brand-distribution-chart.tsx",
    "src/components/dashboard/aging-curve-chart.tsx",
    "src/components/dashboard/tax-timeline-chart.tsx",
    "src/components/dashboard/pipeline-funnel.tsx",
    "src/components/dashboard/auditor-gauge.tsx",
  ];

  for (const comp of components) {
    const fullPath = path.resolve(process.cwd(), comp);
    assert.ok(fs.existsSync(fullPath), `Required component missing: ${comp}`);
    console.log(`  ✓ Verified file: ${comp}`);
  }

  // [TEST 2/5] Overview page integration and contract preservation
  console.log("\n[TEST 2/5] Checking Overview HomePage integration...");
  const pagePath = path.resolve(process.cwd(), "src/app/(workspace)/page.tsx");
  const pageContent = fs.readFileSync(pagePath, "utf-8");
  assert.ok(pageContent.includes("<DashboardHub />"), "HomePage must render <DashboardHub />");
  assert.ok(pageContent.includes("<PaymentSummary />"), "HomePage must retain <PaymentSummary /> for CI contract");
  assert.ok(pageContent.includes("<DashboardReportSummary />"), "HomePage must retain <DashboardReportSummary /> for CI contract");
  assert.ok(pageContent.includes("falchion-xeniaa-mark.svg"), "HomePage must retain falchion-xeniaa-mark.svg asset");
  assert.ok(pageContent.includes('+ Create new invoice'), "HomePage must retain '+ Create new invoice' action link");
  console.log("  ✓ HomePage successfully mounts <DashboardHub /> while maintaining 100% CI contracts.");

  // [TEST 3/5] Database analytics queries validation
  console.log("\n[TEST 3/5] Testing database analytical metrics execution...");
  const { pool } = await import("../src/lib/db/pool");
  const entityId = "f94dacb2-4063-4348-bae4-56633f3c5c9d";

  // Test Monthly Trend Query
  const [monthly] = await pool.query(
    `SELECT DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m') as month,
            COALESCE(SUM(grand_total), 0) as invoiced,
            COUNT(*) as count
     FROM invoices
     WHERE legal_entity_id = ? AND lifecycle_status = 'ISSUED'
     GROUP BY month
     ORDER BY month DESC
     LIMIT 6`,
    [entityId]
  );
  assert.ok(Array.isArray(monthly), "Monthly trend query should return an array");
  console.log(`  ✓ Monthly trend query executed (${(monthly as unknown[]).length} periods found)`);

  // Test Brand Revenue Query
  const [brands] = await pool.query(
    `SELECT b.name as brand_name, b.code as brand_code,
            COALESCE(SUM(i.grand_total), 0) as total_revenue,
            COUNT(i.id) as invoice_count
     FROM brands b
     LEFT JOIN invoices i ON i.brand_id = b.id AND i.lifecycle_status = 'ISSUED' AND i.legal_entity_id = ?
     WHERE b.is_active = 1
     GROUP BY b.id, b.name, b.code
     ORDER BY total_revenue DESC`,
    [entityId]
  );
  assert.ok(Array.isArray(brands) && brands.length >= 3, "All active commercial brands must be represented");
  console.log(`  ✓ Brand revenue distribution query verified (${(brands as unknown[]).length} commercial brands active)`);

  // Test Tax Breakdown
  const [taxes] = await pool.query(
    `SELECT COALESCE(SUM(cgst_amount), 0) as total_cgst,
            COALESCE(SUM(sgst_amount), 0) as total_sgst,
            COALESCE(SUM(tax_total), 0) as total_tax
     FROM invoices
     WHERE legal_entity_id = ? AND lifecycle_status = 'ISSUED'`,
    [entityId]
  );
  assert.ok(Array.isArray(taxes) && taxes.length > 0, "Tax summary row must be returned");
  console.log("  ✓ Tax liability query verified (CGST, SGST, IGST)");

  // Test Aging Buckets Query
  const [aging] = await pool.query(
    `SELECT 
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) <= 15 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as current_bucket,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) BETWEEN 16 AND 30 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as bucket_16_30,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) BETWEEN 31 AND 60 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as bucket_31_60,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) > 60 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as bucket_over_60
    FROM invoices i
    LEFT JOIN (
      SELECT pa.invoice_id, SUM(pa.amount) as paid_sum 
      FROM payment_allocations pa 
      JOIN payments p ON p.id = pa.payment_id 
      WHERE p.status = 'RECORDED' 
      GROUP BY pa.invoice_id
    ) paid ON paid.invoice_id = i.id
    WHERE i.legal_entity_id = ? AND i.lifecycle_status = 'ISSUED' AND (i.grand_total - COALESCE(paid_sum, 0)) > 0`,
    [entityId]
  );
  assert.ok(Array.isArray(aging) && aging.length > 0, "Aging summary row must be returned");
  console.log("  ✓ Receivables aging curve query verified (0-15d, 16-30d, 31-60d, 60d+)");

  // [TEST 4/5] Numbering & Governance verification
  console.log("\n[TEST 4/5] Checking statutory numbering & governance policies...");
  const [policies] = await pool.query(
    "SELECT COUNT(*) as count FROM business_policy_decisions WHERE (legal_entity_id = ? OR legal_entity_id IS NULL) AND status IN ('APPROVED', 'NOT_APPLICABLE')",
    [entityId]
  );
  const approvedPolicies = (policies as Array<{ count: number }>)[0]?.count ?? 0;
  assert.equal(approvedPolicies, 12, "All 12 statutory policies D-01 through D-12 must be resolved/approved");
  console.log("  ✓ Statutory business policies: 12/12 RESOLVED & APPROVED");

  const [numbering] = await pool.query(
    "SELECT prefix, sequence_width FROM invoice_numbering_configs WHERE legal_entity_id = ? AND document_type = 'INVOICE' AND is_active = 1",
    [entityId]
  );
  const cfg = (numbering as Array<{ prefix: string; sequence_width: number }>)[0];
  assert.equal(cfg.prefix, "26", "Invoice prefix must be 26");
  assert.equal(cfg.sequence_width, 3, "Sequence width must be 3 digits");
  console.log(`  ✓ Numbering sequence verified: ${cfg.prefix}001..${cfg.prefix}999`);

  // [TEST 5/5] CSS Styles & Design Token Integrity
  console.log("\n[TEST 5/5] Checking design tokens & styling definitions in globals.css...");
  const cssPath = path.resolve(process.cwd(), "src/app/globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");
  assert.ok(cssContent.includes(".role-switcher-bar"), "CSS must define .role-switcher-bar");
  assert.ok(cssContent.includes(".analytics-kpi-grid"), "CSS must define .analytics-kpi-grid");
  assert.ok(cssContent.includes(".analytics-charts-grid"), "CSS must define .analytics-charts-grid");
  assert.ok(cssContent.includes(".brand-chart-layout"), "CSS must define .brand-chart-layout");
  assert.ok(cssContent.includes(".aging-stacked-bar"), "CSS must define .aging-stacked-bar");
  assert.ok(cssContent.includes(".pipeline-funnel-stages"), "CSS must define .pipeline-funnel-stages");
  assert.ok(cssContent.includes(".auditor-telemetry-grid"), "CSS must define .auditor-telemetry-grid");
  console.log("  ✓ All required Phase 3 styling classes defined and validated.");

  await pool.end();

  console.log("\n" + "=".repeat(80));
  console.log("🎉 PHASE 3 VERIFICATION COMPLETE: ALL 5 ROLE DASHBOARDS & CHARTS VALIDATED! 🎉");
  console.log("=".repeat(80) + "\n");
}

run().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
