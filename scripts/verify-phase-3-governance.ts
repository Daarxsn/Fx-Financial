import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { loadProjectEnv } from "./load-env";
import { verifiedMysqlTlsOptions } from "../src/lib/db/tls-options";

loadProjectEnv();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function databasePort(): number {
  const port = Number(requiredEnv("DATABASE_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_PORT must be a valid TCP port");
  }
  return port;
}

type PolicyRow = RowDataPacket & {
  decision_key: string;
  topic: string;
  legal_entity_id: string | null;
  status: string;
  requires_issue_gate: number;
  decision_code: string | null;
  decision_text: string | null;
  rationale: string | null;
  external_approver_name: string | null;
  external_approver_role: string | null;
  approval_reference: string | null;
  approval_date: Date | string | null;
  recorded_by: string | null;
};

type NumberingConfigRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  document_type: string;
  series_code: string;
  prefix: string;
  suffix: string;
  sequence_width: number;
  include_financial_year: number;
  financial_year_start_month: number;
  financial_year_start_day: number;
  time_zone: string;
  version_number: number;
  is_active: number;
  approval_reference: string | null;
};

type TemplateRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  template_key: string;
  display_name: string;
  template_config: unknown;
  is_active: number;
};

type TaxRegRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  registration_key: string;
  registration_type: string;
  jurisdiction: string;
  registration_number: string;
  is_primary: number;
  is_active: number;
  approval_reference: string | null;
};

type TaxRuleRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  tax_code: string;
  display_name: string;
  jurisdiction: string;
  rate: string;
  calculation_mode: string;
  is_active: number;
  approval_reference: string | null;
};

async function main(): Promise<void> {
  console.info("================================================================================");
  console.info("PHASE 3 EXECUTION & VERIFICATION: Statutory Governance, Numbering & Template Seeding");
  console.info("Target: INV-DEF-004 | Gate 3 Acceptance Validation");
  console.info("================================================================================\n");

  const pool = mysql.createPool({
    host: requiredEnv("DATABASE_HOST"),
    port: databasePort(),
    database: requiredEnv("DATABASE_NAME"),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    ssl: verifiedMysqlTlsOptions(),
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    decimalNumbers: false,
  });

  const CANONICAL_SUPPLIER_ID = "f94dacb2-4063-4348-bae4-56633f3c5c9d";

  const { readinessForEntity, reserveDocumentNumber } = await import("../src/lib/configuration/service");
  const { unresolvedInvoicePolicyDecisions } = await import("../src/lib/configuration/policy-decisions");

  try {
    // -------------------------------------------------------------------------
    // 1. Business Policy Decisions Audit (INV-DEF-004)
    // -------------------------------------------------------------------------
    console.info("[STEP 1/6] Auditing Statutory Business Policy Decisions (D-01 to D-12)...");
    const [policyRows] = await pool.query<PolicyRow[]>(
      `SELECT decision_key, topic, legal_entity_id, status, requires_issue_gate,
              decision_code, decision_text, rationale, external_approver_name,
              external_approver_role, approval_reference, approval_date, recorded_by
         FROM business_policy_decisions
        WHERE legal_entity_id = ? OR legal_entity_id IS NULL
        ORDER BY decision_key ASC`,
      [CANONICAL_SUPPLIER_ID],
    );

    const expectedKeys = [
      "D-01", "D-02", "D-03", "D-04", "D-05", "D-06",
      "D-07", "D-08", "D-09", "D-10", "D-11", "D-12",
    ];

    const policyMap = new Map(policyRows.map((r) => [r.decision_key, r]));
    for (const key of expectedKeys) {
      const p = policyMap.get(key);
      if (!p) {
        throw new Error(`Missing statutory business policy decision record: ${key}`);
      }
      if (p.status !== "APPROVED" && p.status !== "NOT_APPLICABLE") {
        throw new Error(`Policy decision ${key} is not resolved; status = ${p.status}`);
      }
      if (p.status === "APPROVED") {
        if (!p.external_approver_name || !p.approval_reference || !p.approval_date) {
          throw new Error(`Policy decision ${key} is missing required evidence fields`);
        }
      }
      console.info(`  ✓ Decision ${key} (${p.topic}): STATUS=${p.status} | Approver: ${p.external_approver_name ?? "N/A"}`);
    }

    const testConn = await pool.getConnection();
    try {
      const unresolved = await unresolvedInvoicePolicyDecisions(testConn, CANONICAL_SUPPLIER_ID);
      if (unresolved.length > 0) {
        throw new Error(`unresolvedInvoicePolicyDecisions returned ${unresolved.length} unresolved items: ${JSON.stringify(unresolved)}`);
      }
      console.info("  ✓ unresolvedInvoicePolicyDecisions() returned 0 unresolved decisions.");
    } finally {
      testConn.release();
    }

    // -------------------------------------------------------------------------
    // 2. Canonical Entity Readiness Assessment (readinessForEntity)
    // -------------------------------------------------------------------------
    console.info("\n[STEP 2/6] Evaluating Canonical Supplier Full Readiness (readinessForEntity)...");
    const readiness = await readinessForEntity(CANONICAL_SUPPLIER_ID);
    console.info(`  Readiness result for ${CANONICAL_SUPPLIER_ID}: ready=${readiness.ready}`);

    for (const check of readiness.checks) {
      if (!check.passed) {
        throw new Error(`Readiness check '${check.key}' failed: ${check.message}`);
      }
      console.info(`  ✓ Check '${check.key}': PASSED`);
    }

    if (!readiness.ready) {
      throw new Error("Canonical supplier readiness overall state is false!");
    }

    // -------------------------------------------------------------------------
    // 3. Invoice Numbering Configuration Integrity
    // -------------------------------------------------------------------------
    console.info("\n[STEP 3/6] Verifying Invoice Numbering Configuration...");
    const [numberingRows] = await pool.query<NumberingConfigRow[]>(
      `SELECT id, legal_entity_id, document_type, series_code, prefix, suffix,
              sequence_width, include_financial_year, financial_year_start_month,
              financial_year_start_day, time_zone, version_number, is_active, approval_reference
         FROM invoice_numbering_configs
        WHERE legal_entity_id = ? AND document_type = 'INVOICE' AND is_active = 1`,
      [CANONICAL_SUPPLIER_ID],
    );

    if (numberingRows.length !== 1) {
      throw new Error(`Expected exactly 1 active invoice numbering series; found ${numberingRows.length}`);
    }

    const numberingConfig = numberingRows[0];
    if (!numberingConfig) {
      throw new Error("Missing active numbering configuration row");
    }
    if (numberingConfig.prefix !== "26") {
      throw new Error(`Expected numbering prefix '26'; found '${numberingConfig.prefix}'`);
    }
    if (numberingConfig.sequence_width !== 3) {
      throw new Error(`Expected sequence width 3; found ${numberingConfig.sequence_width}`);
    }
    if (numberingConfig.include_financial_year) {
      throw new Error("Expected include_financial_year to be disabled for 26001..2600n serials");
    }
    if (numberingConfig.financial_year_start_month !== 4 || numberingConfig.financial_year_start_day !== 1) {
      throw new Error("Expected Indian standard financial year (April 1 to March 31)");
    }
    if (numberingConfig.time_zone !== "Asia/Kolkata") {
      throw new Error(`Expected time_zone 'Asia/Kolkata'; found '${numberingConfig.time_zone}'`);
    }
    if (!numberingConfig.approval_reference) {
      throw new Error("Numbering configuration is missing approval_reference");
    }
    console.info(`  ✓ Numbering series '${numberingConfig.series_code}' (prefix: '${numberingConfig.prefix}', width: ${numberingConfig.sequence_width}) approved & active.`);

    // -------------------------------------------------------------------------
    // 4. Atomic Concurrency & Sequence Reservation Validation
    // -------------------------------------------------------------------------
    console.info("\n[STEP 4/6] Testing Concurrency & Non-Colliding Sequential Numbering...");
    const todayStr = new Date().toISOString().slice(0, 10);
    const concurrentCount = 5;

    // Run 5 parallel reservations inside isolated transactions
    const reservationPromises = Array.from({ length: concurrentCount }, async (_, idx) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const reserved = await reserveDocumentNumber(conn, CANONICAL_SUPPLIER_ID, "INVOICE", todayStr);
        await conn.commit();
        return { idx, ...reserved };
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    });

    const reservationResults = await Promise.all(reservationPromises);
    const allocatedNumbers = reservationResults.map((r) => r.number);
    const sequenceValues = reservationResults.map((r) => r.sequenceValue);

    console.info(`  Reserved numbers: ${allocatedNumbers.join(", ")}`);

    // Verify all 5 numbers are strictly unique
    const uniqueNumbers = new Set(allocatedNumbers);
    if (uniqueNumbers.size !== concurrentCount) {
      throw new Error(`Concurrency test detected collisions! Expected ${concurrentCount} unique numbers, got ${uniqueNumbers.size}`);
    }

    // Verify strictly ascending sequence values
    const sortedSequences = [...sequenceValues].sort((a, b) => a - b);
    for (let i = 1; i < sortedSequences.length; i++) {
      const current = sortedSequences[i];
      const previous = sortedSequences[i - 1];
      if (current === undefined || previous === undefined || current !== previous + 1) {
        throw new Error(`Sequence gap or disorder detected in concurrency test: ${sequenceValues.join(", ")}`);
      }
    }

    // Verify format adherence (e.g. 26001, 26002 ... 2600n)
    const numberFormatRegex = /^26\d{3,}$/;
    for (const num of allocatedNumbers) {
      if (!numberFormatRegex.test(num)) {
        throw new Error(`Allocated number '${num}' does not match expected format ${numberFormatRegex}`);
      }
    }
    console.info("  ✓ All 5 concurrent reservations executed atomically without gaps, collisions, or race conditions.");

    // -------------------------------------------------------------------------
    // 5. Document Template Seeding & Layout Integrity
    // -------------------------------------------------------------------------
    console.info("\n[STEP 5/6] Verifying Document Template Seeding & Bank Configuration...");
    const [templateRows] = await pool.query<TemplateRow[]>(
      `SELECT id, legal_entity_id, template_key, display_name, template_config, is_active
         FROM invoice_document_templates
        WHERE legal_entity_id = ? AND document_type = 'INVOICE' AND is_active = 1`,
      [CANONICAL_SUPPLIER_ID],
    );

    if (templateRows.length !== 1) {
      throw new Error(`Expected exactly 1 active document template; found ${templateRows.length}`);
    }

    const template = templateRows[0];
    if (!template) {
      throw new Error("Missing active document template row");
    }
    if (template.template_key !== "STANDARD_TAX_INVOICE") {
      throw new Error(`Unexpected template_key '${template.template_key}'`);
    }

    const templateConfig = typeof template.template_config === "string"
      ? JSON.parse(template.template_config)
      : (template.template_config as Record<string, unknown>);

    if (!templateConfig.showBankDetails) {
      throw new Error("Template config showBankDetails must be true");
    }
    if (templateConfig.documentTitle !== "PROFORMA INVOICE:") {
      throw new Error(`Template documentTitle mismatch: expected 'PROFORMA INVOICE:', found '${String(templateConfig.documentTitle)}'`);
    }
    console.info(`  ✓ Document template '${template.display_name}' configured with showBankDetails=true, title='${String(templateConfig.documentTitle)}'.`);

    // -------------------------------------------------------------------------
    // 6. Statutory Tax Registrations & Rule Harmonization
    // -------------------------------------------------------------------------
    console.info("\n[STEP 6/6] Verifying Statutory Tax Registrations & Rule Harmonization...");
    const [taxRegs] = await pool.query<TaxRegRow[]>(
      `SELECT id, legal_entity_id, registration_key, registration_type, jurisdiction,
              registration_number, is_primary, is_active, approval_reference
         FROM legal_entity_tax_registrations
        WHERE legal_entity_id = ? AND is_active = 1`,
      [CANONICAL_SUPPLIER_ID],
    );

    if (taxRegs.length === 0) {
      throw new Error("Missing active statutory tax registration for canonical supplier");
    }

    const primaryGstin = taxRegs.find((r) => r.registration_type === "GSTIN" && r.is_primary);
    if (!primaryGstin) {
      throw new Error("Missing primary GSTIN registration");
    }
    if (primaryGstin.registration_number !== "27AAGCF3329Q1Z4") {
      throw new Error(`GSTIN mismatch: expected 27AAGCF3329Q1Z4, found '${primaryGstin.registration_number}'`);
    }
    if (primaryGstin.jurisdiction !== "Maharashtra") {
      throw new Error(`Jurisdiction mismatch: expected Maharashtra, found '${primaryGstin.jurisdiction}'`);
    }
    console.info(`  ✓ Primary Tax Registration: GSTIN=${primaryGstin.registration_number} (${primaryGstin.jurisdiction}) approved.`);

    const [taxRules] = await pool.query<TaxRuleRow[]>(
      `SELECT id, legal_entity_id, tax_code, display_name, jurisdiction, rate,
              calculation_mode, is_active, approval_reference
         FROM tax_rules
        WHERE legal_entity_id = ? AND is_active = 1`,
      [CANONICAL_SUPPLIER_ID],
    );

    const gst18 = taxRules.find((r) => r.tax_code === "GST_18");
    if (!gst18) {
      throw new Error("Missing active 'GST_18' tax rule");
    }
    if (Number(gst18.rate) !== 18) {
      throw new Error(`Tax rate mismatch: expected 18, found ${gst18.rate}`);
    }
    if (gst18.jurisdiction !== primaryGstin.jurisdiction) {
      throw new Error(`Tax rule jurisdiction '${gst18.jurisdiction}' does not match registration '${primaryGstin.jurisdiction}'`);
    }
    console.info(`  ✓ Tax Rule: '${gst18.tax_code}' (${gst18.rate}% ${gst18.calculation_mode}) approved & jurisdiction matched.`);

    console.info("\n================================================================================");
    console.info("🎉 PHASE 3 (STATUTORY GOVERNANCE & NUMBERING) COMPLETE & VERIFIED! 🎉");
    console.info("Acceptance Gate 3: FULLY SATISFIED. Ready to proceed to Phase 4.");
    console.info("================================================================================\n");

  } finally {
    try {
      const { pool: sharedPool } = await import("../src/lib/db/pool");
      await sharedPool.end();
    } catch {
      // Ignore if not initialized
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\n❌ PHASE 3 VERIFICATION FAILED:", err);
  process.exitCode = 1;
});
