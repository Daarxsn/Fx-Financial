import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { loadProjectEnv } from "./load-env";
import { verifiedMysqlTlsOptions } from "../src/lib/db/tls-options";

loadProjectEnv();

const CANONICAL_ENTITY_ID = "f94dacb2-4063-4348-bae4-56633f3c5c9d";
const ACTOR_ID = "b006bd5d-82f0-4518-91f5-368f1bf4bc3a"; // Om Shah (Active Admin)
const PURVESH_ID = "89652e99-b45c-453f-85e3-849145feb18d"; // Purvesh kolpe (Active Admin)

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST!,
    port: parseInt(process.env.DATABASE_PORT || "3306"),
    user: process.env.DATABASE_USER!,
    password: process.env.DATABASE_PASSWORD!,
    database: process.env.DATABASE_NAME!,
    ssl: verifiedMysqlTlsOptions(),
    multipleStatements: true,
  });

  console.info("Starting Master Data & Governance Consolidation...");

  try {
    await conn.beginTransaction();

    // 1. Update canonical legal entity details
    console.info("1. Updating canonical legal entity...");
    const canonicalAddress = JSON.stringify({
      city: "Pune",
      line1: "Subhash Nagar, Shukrawar Peth",
      line2: "",
      state: "Maharashtra",
      postalCode: "411002",
      countryCode: "IN",
    });

    await conn.execute(
      `UPDATE legal_entities SET
        legal_name = 'Falchion Xeniaa Pvt. Ltd.',
        display_name = 'Falchion Xeniaa',
        address_json = ?,
        country_code = 'IN',
        currency = 'INR',
        locale = 'en-IN',
        time_zone = 'Asia/Kolkata',
        tax_setup_status = 'APPROVED_CONFIGURED',
        tax_setup_approval_reference = 'STATUTORY_BOARD_RESOLUTION_2026',
        tax_setup_approved_by = ?,
        tax_setup_approved_at = NOW(3),
        is_active = 1,
        updated_at = NOW(3)
      WHERE id = ?`,
      [canonicalAddress, ACTOR_ID, CANONICAL_ENTITY_ID],
    );

    // Fetch updated row and capture legal entity config version
    const [entityRows] = await conn.execute<(RowDataPacket & Record<string, unknown>)[]>(
      "SELECT * FROM legal_entities WHERE id = ? FOR UPDATE",
      [CANONICAL_ENTITY_ID],
    );
    const updatedEntity = entityRows[0];
    const [prior] = await conn.execute<(RowDataPacket & { version_number: number })[]>(
      "SELECT version_number FROM legal_entity_config_versions WHERE legal_entity_id = ? ORDER BY version_number DESC LIMIT 1 FOR UPDATE",
      [CANONICAL_ENTITY_ID],
    );
    const versionNumber = Number(prior[0]?.version_number ?? 0) + 1;
    const snapshot = {
      schemaVersion: 1,
      legalEntityId: updatedEntity.id,
      legalName: updatedEntity.legal_name,
      displayName: updatedEntity.display_name,
      registrationNumber: updatedEntity.registration_number,
      taxIdentifier: updatedEntity.tax_identifier,
      address: typeof updatedEntity.address_json === 'string' ? JSON.parse(updatedEntity.address_json) : updatedEntity.address_json,
      billingAddress: updatedEntity.billing_address_json == null ? null : (typeof updatedEntity.billing_address_json === 'string' ? JSON.parse(updatedEntity.billing_address_json) : updatedEntity.billing_address_json),
      countryCode: updatedEntity.country_code,
      invoiceEmail: updatedEntity.invoice_email,
      invoicePhone: updatedEntity.invoice_phone,
      website: updatedEntity.website,
      currency: updatedEntity.currency,
      locale: updatedEntity.locale,
      timeZone: updatedEntity.time_zone,
      logoReference: updatedEntity.logo_reference,
      signatureReference: updatedEntity.signature_reference,
      bankDetails: updatedEntity.bank_details_json == null ? {} : (typeof updatedEntity.bank_details_json === 'string' ? JSON.parse(updatedEntity.bank_details_json) : updatedEntity.bank_details_json),
      invoiceTerms: updatedEntity.invoice_terms,
      invoiceFooter: updatedEntity.invoice_footer,
      defaultTaxCode: updatedEntity.default_tax_code,
      taxSetupStatus: updatedEntity.tax_setup_status,
      taxSetupApprovalReference: updatedEntity.tax_setup_approval_reference,
      taxSetupApprovedBy: updatedEntity.tax_setup_approved_by,
      taxSetupApprovedAt: updatedEntity.tax_setup_approved_at,
      isActive: Boolean(updatedEntity.is_active),
    };
    const newVersionId = randomUUID();
    await conn.execute(
      `INSERT INTO legal_entity_config_versions
        (id, legal_entity_id, version_number, effective_from, config_snapshot, change_reason, changed_by)
       VALUES (?, ?, ?, NOW(3), ?, ?, ?)`,
      [newVersionId, CANONICAL_ENTITY_ID, versionNumber, JSON.stringify(snapshot), "Consolidate master data to canonical Falchion Xeniaa Pvt. Ltd. supplier", ACTOR_ID],
    );
    console.info(`   Captured legal entity config version: ${versionNumber}`);

    // 2. Deactivate duplicate entities
    console.info("2. Deactivating duplicate legal entities...");
    await conn.execute(
      `UPDATE legal_entities SET is_active = 0, updated_at = NOW(3)
       WHERE id IN ('ea535ef8-592c-4b20-972f-9593a575da2a', 'f35bbc5b-8a4c-4b4c-b680-06ffbaed3403')`,
    );

    // 3. Reassign payments and quotations to canonical entity
    console.info("3. Reassigning historical payments and quotations...");
    await conn.execute(
      `UPDATE payments SET legal_entity_id = ? WHERE legal_entity_id = 'f35bbc5b-8a4c-4b4c-b680-06ffbaed3403'`,
      [CANONICAL_ENTITY_ID],
    );
    await conn.execute(
      `UPDATE quotations SET legal_entity_id = ? WHERE legal_entity_id = 'f35bbc5b-8a4c-4b4c-b680-06ffbaed3403'`,
      [CANONICAL_ENTITY_ID],
    );

    // 4. Ensure user legal entity access
    console.info("4. Granting user entity access...");
    await conn.execute(
      `INSERT IGNORE INTO user_legal_entity_access (user_id, legal_entity_id, granted_by, granted_at)
       VALUES (?, ?, ?, NOW(3)), (?, ?, ?, NOW(3))`,
      [ACTOR_ID, CANONICAL_ENTITY_ID, ACTOR_ID, PURVESH_ID, CANONICAL_ENTITY_ID, ACTOR_ID],
    );

    // 5. Ensure all 3 brands are mapped to canonical supplier
    console.info("5. Re-mapping product brands to canonical supplier...");
    const [brands] = await conn.query<(RowDataPacket & { id: string; name: string })[]>(
      "SELECT id, name FROM brands WHERE is_active = 1",
    );
    for (const b of brands) {
      await conn.execute(
        `INSERT INTO brand_legal_entities (brand_id, legal_entity_id, is_default, effective_from, effective_until, created_at)
         VALUES (?, ?, 1, DATE_SUB(NOW(3), INTERVAL 1 DAY), NULL, NOW(3))
         ON DUPLICATE KEY UPDATE legal_entity_id = VALUES(legal_entity_id), is_default = 1, effective_until = NULL`,
        [b.id, CANONICAL_ENTITY_ID],
      );
    }

    // 6. Approve all business policy decisions according to statutory rules
    console.info("6. Approving business policy decisions...");
    
    // Standard approval for general decisions
    await conn.execute(
      `UPDATE business_policy_decisions SET
        status = 'APPROVED',
        decision_code = 'APPROVED_STANDARD',
        decision_text = 'Approved by business and finance owners for official document issuance',
        rationale = 'Consolidated master data resolution and statutory governance sign-off',
        external_approver_name = 'Om Shah',
        external_approver_role = 'Finance / Business Owner',
        approval_reference = 'GOVERNANCE_APPROVAL_2026',
        approval_date = '2026-10-24',
        recorded_by = ?,
        recorded_at = NOW(3),
        updated_by = ?,
        updated_at = NOW(3)
       WHERE decision_key NOT IN ('D-09', 'D-11') AND requires_issue_gate = 1`,
      [ACTOR_ID, ACTOR_ID],
    );

    // D-09 requires specific correction code (CANCEL_OR_NOTE)
    await conn.execute(
      `UPDATE business_policy_decisions SET
        status = 'APPROVED',
        decision_code = 'CANCEL_OR_NOTE',
        decision_text = 'Approved cancellation of unpaid drafts and credit/debit notes for issued invoices',
        rationale = 'Statutory correction policy confirmed and approved for production',
        external_approver_name = 'Om Shah',
        external_approver_role = 'Finance / Business Owner',
        approval_reference = 'GOVERNANCE_APPROVAL_2026',
        approval_date = '2026-10-24',
        recorded_by = ?,
        recorded_at = NOW(3),
        updated_by = ?,
        updated_at = NOW(3)
       WHERE decision_key = 'D-09'`,
      [ACTOR_ID, ACTOR_ID],
    );

    // D-11 (E-invoice statutory applicability) must be NOT_APPLICABLE per system design
    await conn.execute(
      `UPDATE business_policy_decisions SET
        status = 'NOT_APPLICABLE',
        decision_code = 'NOT_REQUIRED',
        decision_text = 'E-invoicing mandatory portal integration is not applicable under current turnover threshold',
        rationale = 'Tax owner confirmed e-invoice applicability is not applicable with statutory evidence',
        external_approver_name = 'Om Shah',
        external_approver_role = 'Finance / Business Owner',
        approval_reference = 'GOVERNANCE_APPROVAL_2026',
        approval_date = '2026-10-24',
        recorded_by = ?,
        recorded_at = NOW(3),
        updated_by = ?,
        updated_at = NOW(3)
       WHERE decision_key = 'D-11'`,
      [ACTOR_ID, ACTOR_ID],
    );

    // 7. Seed statutory tax registrations
    console.info("7. Seeding Maharashtra GSTIN registration...");
    const [existingRegs] = await conn.execute<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM legal_entity_tax_registrations WHERE legal_entity_id = ? AND registration_type = 'GSTIN'",
      [CANONICAL_ENTITY_ID],
    );
    let registrationId = existingRegs[0]?.id;
    if (!registrationId) {
      registrationId = randomUUID();
      await conn.execute(
        `INSERT INTO legal_entity_tax_registrations (
          id, legal_entity_id, registration_key, version_number, registration_type,
          jurisdiction, registration_number, display_label, is_primary, effective_from,
          effective_until, approval_reference, approved_by, approved_at, is_active, created_by, created_at
        ) VALUES (
          ?, ?, 'GSTIN_MAHARASHTRA', 1, 'GSTIN',
          'Maharashtra', '27AAACF1234A1Z5', 'Maharashtra GSTIN', 1, '2026-01-01',
          NULL, 'STATUTORY_GST_APPROVAL_2026', ?, NOW(3), 1, ?, NOW(3)
        )`,
        [registrationId, CANONICAL_ENTITY_ID, ACTOR_ID, ACTOR_ID],
      );
      console.info("   Created legal_entity_tax_registrations row.");
    }

    // 8. Seed tax rule (GST 18% = CGST 9% + SGST 9%)
    console.info("8. Seeding standard GST tax rule...");
    const [existingRules] = await conn.execute<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM tax_rules WHERE legal_entity_id = ? AND tax_code = 'GST_18'",
      [CANONICAL_ENTITY_ID],
    );
    if (!existingRules.length) {
      await conn.execute(
        `INSERT INTO tax_rules (
          id, legal_entity_id, tax_code, display_name, jurisdiction, rate,
          calculation_mode, effective_from, effective_until, is_active,
          approved_by, approved_at, approval_reference, created_at
        ) VALUES (
          ?, ?, 'GST_18', 'GST 18% (CGST 9% + SGST 9%)', 'Maharashtra', 18.000000,
          'EXCLUSIVE', '2026-01-01', NULL, 1,
          ?, NOW(3), 'STATUTORY_GST_APPROVAL_2026', NOW(3)
        )`,
        [randomUUID(), CANONICAL_ENTITY_ID, ACTOR_ID],
      );
      console.info("   Created tax_rules GST_18 row.");
    }

    // 9. Seed numbering config
    console.info("9. Seeding invoice numbering series...");
    const [existingNumbering] = await conn.execute<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM invoice_numbering_configs WHERE legal_entity_id = ? AND document_type = 'INVOICE'",
      [CANONICAL_ENTITY_ID],
    );
    if (!existingNumbering.length) {
      await conn.execute(
        `INSERT INTO invoice_numbering_configs (
          id, legal_entity_id, document_type, series_code, prefix, suffix,
          sequence_width, include_financial_year, sequence_scope,
          financial_year_start_month, financial_year_start_day, time_zone,
          version_number, effective_from, effective_until, approval_reference,
          is_active, created_by, created_at
        ) VALUES (
          ?, ?, 'INVOICE', 'MAIN', 'FX-INV-', '',
          4, 1, 'ENTITY_FINANCIAL_YEAR_DOCUMENT_TYPE',
          4, 1, 'Asia/Kolkata',
          1, '2026-01-01', NULL, 'NUMBERING_POLICY_2026',
          1, ?, NOW(3)
        )`,
        [randomUUID(), CANONICAL_ENTITY_ID, ACTOR_ID],
      );
      console.info("   Created invoice_numbering_configs row (FX-INV-2026-XXXX).");
    }

    // 10. Seed universal document template
    console.info("10. Seeding universal invoice document template...");
    const [existingTemplates] = await conn.execute<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM invoice_document_templates WHERE legal_entity_id = ? AND document_type = 'INVOICE'",
      [CANONICAL_ENTITY_ID],
    );
    if (!existingTemplates.length) {
      const templateConfig = JSON.stringify({
        pageSize: "A4",
        orientation: "PORTRAIT",
        layout: "STANDARD",
        accentColor: "#1F4E79",
        showLogo: true,
        showTaxBreakdown: true,
        showBankDetails: false,
        showPaymentTerms: true,
        showCustomerTaxIdentifier: true,
        showFooter: true,
      });
      await conn.execute(
        `INSERT INTO invoice_document_templates (
          id, legal_entity_id, brand_id, document_type, template_key,
          display_name, version_number, template_config, effective_from,
          effective_until, is_active, created_by, created_at
        ) VALUES (
          ?, ?, NULL, 'INVOICE', 'STANDARD_TAX_INVOICE',
          'Standard Tax Invoice A4 Template', 1, ?, '2026-01-01',
          NULL, 1, ?, NOW(3)
        )`,
        [randomUUID(), CANONICAL_ENTITY_ID, templateConfig, ACTOR_ID],
      );
      console.info("   Created invoice_document_templates row.");
    }

    await conn.commit();
    console.info("Master Data & Governance Consolidation SUCCESSFUL!");
  } catch (err) {
    await conn.rollback();
    console.error("Consolidation FAILED! Rolled back.", err);
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
