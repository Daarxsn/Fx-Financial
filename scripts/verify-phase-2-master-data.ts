import { existsSync } from "node:fs";
import { join } from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { loadProjectEnv } from "./load-env";
import { verifiedMysqlTlsOptions } from "../src/lib/db/tls-options";
import { isFalchionXeniaaSupplierName, isProductBrandLegalEntityName } from "../src/lib/brand-assets";

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

type EntityRow = RowDataPacket & {
  id: string;
  legal_name: string;
  display_name: string;
  is_active: number;
  tax_identifier: string | null;
  invoice_phone: string | null;
  invoice_email: string | null;
  address_json: unknown;
  tax_setup_status: string;
};

type BrandRow = RowDataPacket & {
  id: string;
  name: string;
  code: string;
  logo_reference: string | null;
  is_active: number;
};

type MappingRow = RowDataPacket & {
  brand_id: string;
  brand_name: string;
  brand_code: string;
  legal_entity_id: string;
  entity_legal_name: string;
  entity_display_name: string;
  is_default: number;
  effective_from: Date;
  effective_until: Date | null;
  mapping_count: number;
};

type OrphanCountRow = RowDataPacket & {
  orphan_count: number;
};

async function main(): Promise<void> {
  console.info("================================================================================");
  console.info("PHASE 2 EXECUTION & VERIFICATION: Master Data Consolidation & Brand Architecture");
  console.info("Target: INV-DEF-002, INV-DEF-003, INV-DEF-008 | Gate 2 Acceptance Validation");
  console.info("================================================================================\n");

  const conn = await mysql.createConnection({
    host: requiredEnv("DATABASE_HOST"),
    port: databasePort(),
    database: requiredEnv("DATABASE_NAME"),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    ssl: verifiedMysqlTlsOptions(),
    connectTimeout: 10000,
    decimalNumbers: false,
  });

  try {
    const CANONICAL_SUPPLIER_ID = "f94dacb2-4063-4348-bae4-56633f3c5c9d";

    // -------------------------------------------------------------------------
    // 1. Single Canonical Supplier Verification (INV-DEF-003, INV-DEF-008)
    // -------------------------------------------------------------------------
    console.info("[STEP 1/6] Verifying Canonical Supplier Architecture...");
    const [entities] = await conn.query<EntityRow[]>(
      "SELECT id, legal_name, display_name, is_active, tax_identifier, invoice_phone, invoice_email, address_json, tax_setup_status FROM legal_entities",
    );

    const activeEntities = entities.filter((e) => Boolean(e.is_active));
    console.info(`  Total legal entities in system: ${entities.length} (Active: ${activeEntities.length})`);

    if (activeEntities.length !== 1) {
      throw new Error(`Expected exactly 1 active canonical supplier; found ${activeEntities.length}`);
    }

    const canonical = activeEntities[0];
    if (!canonical || canonical.id !== CANONICAL_SUPPLIER_ID) {
      throw new Error(`Active entity ID mismatch: expected ${CANONICAL_SUPPLIER_ID}, found ${canonical?.id}`);
    }

    if (!isFalchionXeniaaSupplierName(canonical.legal_name)) {
      throw new Error(`Canonical legal name '${canonical.legal_name}' is not recognized as Falchion Xeniaa supplier`);
    }

    if (isProductBrandLegalEntityName(canonical.display_name)) {
      throw new Error(`Canonical display name '${canonical.display_name}' must NOT use a product brand name`);
    }

    // Verify address typo fix (INV-DEF-010)
    let addr: Record<string, unknown> = {};
    if (typeof canonical.address_json === "string") {
      addr = JSON.parse(canonical.address_json) as Record<string, unknown>;
    } else if (canonical.address_json && typeof canonical.address_json === "object") {
      addr = canonical.address_json as Record<string, unknown>;
    }

    if (String(addr.state ?? "").toLowerCase() === "maharastra") {
      throw new Error("Address state contains legacy typo 'Maharastra'");
    }
    console.info(`  ✓ Canonical Legal Supplier: ${canonical.legal_name} (${canonical.display_name})`);
    console.info(`  ✓ State in Address: ${String(addr.state)} (Typo check PASS)`);
    console.info(`  ✓ GSTIN: ${canonical.tax_identifier ?? "N/A"}`);
    console.info(`  ✓ Tax Setup Status: ${canonical.tax_setup_status}`);

    // Verify duplicate entities are deactivated
    const inactiveDuplicates = entities.filter((e) => !e.is_active);
    console.info(`  ✓ ${inactiveDuplicates.length} legacy/duplicate entities safely deactivated in database.`);

    // -------------------------------------------------------------------------
    // 2. Product Brands Verification
    // -------------------------------------------------------------------------
    console.info("\n[STEP 2/6] Verifying Commercial Product Brands...");
    const [brands] = await conn.query<BrandRow[]>(
      "SELECT id, name, code, logo_reference, is_active FROM brands ORDER BY code ASC",
    );
    console.info(`  Found ${brands.length} product brands registered.`);

    const EXPECTED_BRANDS = [
      { code: "COWORKS", name: "FX Coworks" },
      { code: "DIGITECH", name: "FX Digitech" },
      { code: "MYFXPOS", name: "MyFX POS" },
    ];

    for (const exp of EXPECTED_BRANDS) {
      const b = brands.find((brand) => brand.code === exp.code);
      if (!b) throw new Error(`Missing expected brand: ${exp.code}`);
      if (!b.is_active) throw new Error(`Brand ${exp.code} is inactive`);
      if (b.name !== exp.name) throw new Error(`Brand name mismatch: expected ${exp.name}, found ${b.name}`);

      // Verify logo asset on disk
      if (b.logo_reference) {
        const logoDiskPath = join(process.cwd(), "public", b.logo_reference.replace(/^\//, ""));
        if (!existsSync(logoDiskPath)) {
          console.warn(`  ⚠ Brand logo not found on disk at: ${logoDiskPath}`);
        } else {
          console.info(`  ✓ Brand: ${b.name} [Code: ${b.code}] -> Logo verified on disk`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. Brand-to-Supplier Mapping Integrity
    // -------------------------------------------------------------------------
    console.info("\n[STEP 3/6] Verifying Brand-to-Supplier Relationships in brand_legal_entities...");
    const [mappings] = await conn.query<MappingRow[]>(
      `SELECT ble.brand_id, b.name AS brand_name, b.code AS brand_code,
              ble.legal_entity_id, le.legal_name AS entity_legal_name, le.display_name AS entity_display_name,
              ble.is_default, ble.effective_from, ble.effective_until,
              COUNT(*) OVER (PARTITION BY ble.brand_id) AS mapping_count
         FROM brand_legal_entities ble
         JOIN brands b ON b.id = ble.brand_id
         JOIN legal_entities le ON le.id = ble.legal_entity_id
        WHERE ble.effective_from <= NOW(3)
          AND (ble.effective_until IS NULL OR ble.effective_until > NOW(3))
        ORDER BY b.code ASC`,
    );

    if (mappings.length !== 3) {
      throw new Error(`Expected exactly 3 active brand mappings, found ${mappings.length}`);
    }

    for (const m of mappings) {
      if (m.legal_entity_id !== CANONICAL_SUPPLIER_ID) {
        throw new Error(`Brand ${m.brand_name} mapped to non-canonical entity ${m.legal_entity_id}`);
      }
      if (!m.is_default) {
        throw new Error(`Brand mapping for ${m.brand_name} is not flagged as is_default`);
      }
      console.info(`  ✓ Brand '${m.brand_name}' -> Supplier '${m.entity_legal_name}' (Default: YES, Effective: ${m.effective_from.toISOString().slice(0, 10)})`);
    }

    // -------------------------------------------------------------------------
    // 4. Ledger Cleanliness: Zero Orphaned Financial Records (INV-DEF-008)
    // -------------------------------------------------------------------------
    console.info("\n[STEP 4/6] Verifying Ledger Cleanliness (Zero Orphaned Records)...");

    const [orphanPayments] = await conn.query<OrphanCountRow[]>(
      "SELECT COUNT(*) AS orphan_count FROM payments WHERE legal_entity_id != ?",
      [CANONICAL_SUPPLIER_ID],
    );
    const countPayments = Number(orphanPayments[0]?.orphan_count ?? 0);
    if (countPayments > 0) {
      throw new Error(`Found ${countPayments} payments attached to non-canonical/inactive legal entities`);
    }
    console.info("  ✓ Payments table: 0 orphaned or non-canonical payment records.");

    const [orphanInvoices] = await conn.query<OrphanCountRow[]>(
      "SELECT COUNT(*) AS orphan_count FROM invoices WHERE legal_entity_id != ?",
      [CANONICAL_SUPPLIER_ID],
    );
    const countInvoices = Number(orphanInvoices[0]?.orphan_count ?? 0);
    if (countInvoices > 0) {
      throw new Error(`Found ${countInvoices} invoices attached to non-canonical/inactive legal entities`);
    }
    console.info("  ✓ Invoices table: 0 orphaned or non-canonical invoice records.");

    const [orphanQuotations] = await conn.query<OrphanCountRow[]>(
      "SELECT COUNT(*) AS orphan_count FROM quotations WHERE legal_entity_id != ?",
      [CANONICAL_SUPPLIER_ID],
    );
    const countQuotations = Number(orphanQuotations[0]?.orphan_count ?? 0);
    if (countQuotations > 0) {
      throw new Error(`Found ${countQuotations} quotations attached to non-canonical/inactive legal entities`);
    }
    console.info("  ✓ Quotations table: 0 orphaned or non-canonical quotation records.");

    // -------------------------------------------------------------------------
    // 5. Brand Reconciliation Safety Check (INV-DEF-003)
    // -------------------------------------------------------------------------
    console.info("\n[STEP 5/6] Simulating Brand Reconciliation Safety Gates...");
    const canonicalCandidates = activeEntities.filter(
      (entity) =>
        isFalchionXeniaaSupplierName(entity.legal_name) ||
        isFalchionXeniaaSupplierName(entity.display_name),
    );

    if (canonicalCandidates.length !== 1) {
      throw new Error(
        `CANONICAL_SUPPLIER_AMBIGUOUS or NOT_FOUND would trigger: found ${canonicalCandidates.length} candidate(s)`,
      );
    }
    console.info("  ✓ Canonical supplier unambiguously resolved: 1 matching active candidate.");
    console.info("  ✓ CANONICAL_SUPPLIER_AMBIGUOUS deadlock permanently resolved.");

    // -------------------------------------------------------------------------
    // 6. UI Draft Options & Gate 2 Exit Criteria (INV-DEF-002)
    // -------------------------------------------------------------------------
    console.info("\n[STEP 6/6] Verifying UI Draft Options & Gate 2 Exit Criteria...");
    
    // Simulate GET /api/v1/invoices/draft-options logic:
    const [draftOptionRows] = await conn.query<MappingRow[]>(
      `SELECT b.id AS brand_id, b.name AS brand_name, b.code AS brand_code,
              e.id AS legal_entity_id, e.legal_name AS entity_legal_name, e.display_name AS entity_display_name,
              ble.is_default, ble.effective_from, ble.effective_until,
              COUNT(*) OVER (PARTITION BY b.id) AS mapping_count
         FROM brands b
         JOIN brand_legal_entities ble ON ble.brand_id = b.id
         JOIN legal_entities e ON e.id = ble.legal_entity_id
        WHERE b.is_active = TRUE AND e.is_active = TRUE
          AND ble.legal_entity_id = ?
          AND ble.effective_from <= NOW(3) AND (ble.effective_until IS NULL OR ble.effective_until > NOW(3))
        ORDER BY b.name ASC`,
      [CANONICAL_SUPPLIER_ID],
    );

    const uiBrandOptions = draftOptionRows.map((b) => ({
      name: b.brand_name,
      code: b.brand_code,
      entityName: b.entity_legal_name,
      issuerIdentityReady:
        !isProductBrandLegalEntityName(b.entity_legal_name) &&
        !isProductBrandLegalEntityName(b.entity_display_name),
      canAutoMap:
        (Boolean(b.is_default) || Number(b.mapping_count) === 1) &&
        !isProductBrandLegalEntityName(b.entity_legal_name) &&
        !isProductBrandLegalEntityName(b.entity_display_name),
    }));

    for (const opt of uiBrandOptions) {
      if (!opt.canAutoMap) {
        throw new Error(`Brand ${opt.name} has canAutoMap = false in UI draft-options!`);
      }
      if (!opt.issuerIdentityReady) {
        throw new Error(`Brand ${opt.name} has issuerIdentityReady = false!`);
      }
      console.info(`  ✓ UI Option: '${opt.name}' -> canAutoMap: TRUE | issuerIdentityReady: TRUE`);
    }

    console.info("\n================================================================================");
    console.info("🎉 PHASE 2 (MASTER DATA & BRAND CONSOLIDATION) COMPLETE & VERIFIED! 🎉");
    console.info("Acceptance Gate 2: FULLY SATISFIED. Ready to proceed to Phase 3.");
    console.info("================================================================================\n");

  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\n❌ PHASE 2 VERIFICATION FAILED:", err);
  process.exitCode = 1;
});
