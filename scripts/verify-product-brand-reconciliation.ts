import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND_LOGO_ASSETS, isFalchionXeniaaSupplierName, isProductBrandLegalEntityName } from "../src/lib/brand-assets";

assert.equal(isFalchionXeniaaSupplierName("Falchion Xeniaa Pvt Ltd"), true);
assert.equal(isFalchionXeniaaSupplierName("Falchion Xeniaa Pvt. Ltd."), true);
assert.equal(isFalchionXeniaaSupplierName("Falchion Xeniaa Private Limited"), true);
assert.equal(isFalchionXeniaaSupplierName(" FALCHION XENIAA "), true);
assert.equal(isFalchionXeniaaSupplierName("Falchion"), false, "partial names must not be accepted");
assert.equal(isFalchionXeniaaSupplierName("Falchion Xeniaa Services"), false, "similar but different names must not be accepted");
for (const label of ["MyFX POS", "FX Digitech", "FX Coworks"]) {
  assert.equal(isFalchionXeniaaSupplierName(label), false, "product brands are not legal suppliers");
}
for (const label of ["MyFX POS", "myfxpos", "FX Digitech", "FxDigitech", "FX Coworks", "FxCoworks"]) {
  assert.equal(isProductBrandLegalEntityName(label), true, label + " should be detected as a legacy product-brand entity");
}
assert.equal(isProductBrandLegalEntityName("Falchion Xeniaa Pvt Ltd"), false);
assert.deepEqual(BRAND_LOGO_ASSETS.filter(asset => asset.audience === "Product").map(asset => asset.code).sort(),
  ["COWORKS", "DIGITECH", "MYFXPOS"]);

const route = readFileSync("src/app/api/v1/legal-entities/reconcile-product-brands/route.ts", "utf8");
assert.ok(route.includes('actor.roles.includes("system_admin")'), "reconciliation must require system_admin");
assert.ok(route.includes("await conn.beginTransaction()") && route.includes("FOR UPDATE"), "reconciliation must be transactional and locked");
assert.ok(route.includes("CANONICAL_SUPPLIER_NOT_FOUND") && route.includes("CANONICAL_SUPPLIER_AMBIGUOUS"), "missing and ambiguous suppliers must fail closed");
assert.ok(route.includes("brand_config_versions") && route.includes("recordAudit"), "mapping changes must preserve version and audit evidence");
assert.ok(route.includes("effective_until = NOW(3)"), "old mappings must be end-dated rather than deleted");
assert.ok(!/DELETE\s+FROM\s+legal_entities/i.test(route), "legal entities must never be deleted by reconciliation");
assert.ok(!/UPDATE\s+invoices\s+SET\s+legal_entity_id/i.test(route), "historical invoice issuers must never be reassigned");
assert.ok(route.includes("preservedLegacyEntities"), "legacy brand-named entities must be reported for review");
assert.ok(route.includes("PRODUCT_BRAND_IDENTITY_MISMATCH") && route.includes("FUTURE_BRAND_MAPPING_EXISTS"), "unexpected brand state must fail closed");
const settingsText = readFileSync("src/app/(workspace)/settings/page.tsx", "utf8");
assert.ok(settingsText.includes("Reconcile product brands"), "repair must be available in Settings");
assert.ok(settingsText.includes("Product brands were entered as legal entities"), "incorrect setup must be explained");
const createRoute = readFileSync("src/app/api/v1/legal-entities/route.ts", "utf8");
assert.ok(createRoute.includes("isFalchionXeniaaSupplierName(input.legalName)") &&
  createRoute.includes("existingProductBrands.length === 0"),
  "initial brand bootstrap must only run for the canonical supplier and when no product-brand records exist");
console.log("PASS: reconciliation name matching, refusal paths, audit/version history, no-delete/no-invoice-move guards, and Settings workflow.");
