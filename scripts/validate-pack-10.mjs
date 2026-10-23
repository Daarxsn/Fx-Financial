#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const manifest = JSON.parse(read("docs/pack-10-uat-scenarios.json"));
const schema = JSON.parse(read("docs/pack-10-release-evidence.schema.json"));
const pkg = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const plan = read("docs/pack-10-business-uat-plan.md");
const ledger = read("docs/pack-10-uat-evidence-ledger.md");
const checker = read("scripts/check-pack-10-release-gate.mjs");
const tests = read("scripts/test-pack-10-release-gate.mjs");
const failures = [];
const passed = [];
function check(label, condition) {
  if (condition) {
    passed.push(label);
    console.log("PASS: " + label);
  } else {
    failures.push(label);
    console.error("FAIL: " + label);
  }
}

check("canonical UAT manifest is non-empty and has unique scenario IDs",
  Array.isArray(manifest.scenarioIds) && manifest.scenarioIds.length >= 20 &&
  new Set(manifest.scenarioIds).size === manifest.scenarioIds.length);
check("manifest includes all required role, brand, lifecycle, failure, and operations categories",
  ["ROLE-SUPER-ADMIN", "ROLE-FINANCE-OPERATOR", "ROLE-READ-ONLY",
   "BRAND-MYFX-POS", "BRAND-FX-DIGITECH", "BRAND-FX-COWORKS",
   "JOURNEY-CUSTOMER-CATALOG-QUOTE-INVOICE", "JOURNEY-INVOICE-PDF-EMAIL",
   "JOURNEY-PARTIAL-FULL-PAYMENT-RECEIPT", "FAIL-DUPLICATE-SUBMIT",
   "FAIL-DATABASE-OUTAGE", "REPORT-EXPORT-RECONCILIATION",
   "MANUAL-RESPONSIVE-ACCESSIBILITY", "PROVIDER-BACKUP-RESTORE",
   "MONITORING-ALERT-DELIVERY", "OPERATOR-ROLLBACK-DRILL"].every((id) => manifest.scenarioIds.includes(id)));
check("evidence schema has required fail-closed release fields",
  schema.required.includes("scenarioResults") && schema.required.includes("signoffs") &&
  schema.required.includes("operations") && schema.required.includes("decision") &&
  schema.properties.openBlockers?.maxItems === 0);
check("all canonical scenarios require operator, timestamp, result and exact SHA",
  JSON.stringify(schema.properties.scenarioResults).includes("operator") &&
  JSON.stringify(schema.properties.scenarioResults).includes("completedAt") &&
  JSON.stringify(schema.properties.scenarioResults).includes("releaseSha") &&
  JSON.stringify(schema.properties.scenarioResults).includes('"const": "passed"'));
check("gate checker validates release SHA, Pack 9, exact-CI SHA and Preview deployment SHA",
  checker.includes("releaseSha does not match the requested --sha") &&
  checker.includes("Pack 9 must be accepted") &&
  checker.includes("ci.commitSha must match releaseSha") &&
  checker.includes("preview.deployedSha must match releaseSha"));
check("gate checker requires all three brand approvals and setting-level approvals",
  checker.includes("Missing brand approval: ") &&
  checker.includes("requiredBrandSettings") &&
  checker.includes("statutoryDisclosure"));
check("gate checker verifies owner sign-offs, evidence URLs, and the GO decision SHA",
  checker.includes("checkSignoff") &&
  checker.includes("must be an HTTPS evidence URL") &&
  checker.includes("GO decision must match releaseSha"));
check("recovery measurements must meet approved RPO/RTO and blockers must be zero",
  checker.includes("Measured RPO exceeds approved RPO") &&
  checker.includes("Measured RTO exceeds approved RTO") &&
  checker.includes("openBlockers must be an empty array"));
check("gate checker is inspection-only and does not perform release actions",
  checker.includes("No deployment action is performed") &&
  checker.includes("does not deploy or authorize infrastructure changes"));
check("synthetic gate tests cover both accepted and blocked release packets",
  tests.includes("complete synthetic evidence packet") &&
  tests.includes("missing canonical scenario") &&
  tests.includes("backup RPO outside approved target") &&
  tests.includes("open critical blocker") &&
  tests.includes("CI SHA mismatch"));
check("Pack 10 scripts are registered as npm commands",
  pkg.scripts?.["pack10:validate"] === "node scripts/validate-pack-10.mjs" &&
  pkg.scripts?.["pack10:gate-test"] === "node scripts/test-pack-10-release-gate.mjs");
check("main-branch CI invokes Pack 10 structural validation and synthetic tests",
  workflow.includes("npm run pack10:validate") &&
  workflow.includes("npm run pack10:gate-test"));
check("business UAT plan and evidence ledger preserve external release gates",
  plan.includes("Release boundary") && plan.includes("not be marked release-locked") &&
  ledger.includes("LOCK STATUS: BLOCKED") && ledger.includes("managed backup restore"));

if (failures.length) {
  console.error("Pack 10 validation failed: " + failures.length + " check(s).");
  process.exit(1);
}
console.log("Pack 10 static validation passed: " + passed.length + " checks.");
