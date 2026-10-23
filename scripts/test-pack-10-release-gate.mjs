#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(await (await import("node:fs/promises")).readFile("docs/pack-10-uat-scenarios.json", "utf8"));
const checkerPath = "scripts/check-pack-10-release-gate.mjs";
const sha = "a".repeat(40);
const stamp = "2026-10-23T09:00:00.000Z";
const evidenceUrl = (name) => "https://evidence.example.invalid/pack-10/" + name;
const brandSettings = {
  issuerIdentity: "approved",
  legalEntityMapping: "approved",
  templateAndLogo: "approved",
  numbering: "approved",
  currency: "approved",
  taxRules: "approved",
  paymentSettings: "approved",
  statutoryDisclosure: "approved"
};

function makePacket() {
  const signoff = (role) => ({
    status: "approved",
    approverName: "Synthetic " + role + " Reviewer",
    approverRole: role,
    approvedAt: stamp,
    releaseSha: sha,
    scope: "Synthetic test evidence only; not an actual sign-off.",
    evidenceUrl: evidenceUrl("signoff-" + role)
  });
  const operational = (name) => ({
    status: "passed",
    evidenceUrl: evidenceUrl(name),
    performedBy: "Synthetic Operator",
    performedAt: stamp
  });
  return {
    schemaVersion: 1,
    repository: "Daarxsn/Fx-Financial",
    releaseSha: sha,
    pack9: { status: "accepted", releaseSha: sha, evidenceUrl: evidenceUrl("pack-9") },
    ci: { status: "success", commitSha: sha, runUrl: "https://github.com/Daarxsn/Fx-Financial/actions/runs/123456789" },
    preview: { status: "passed", deployedSha: sha, url: "https://preview.example.invalid", smokeStatus: "passed", evidenceUrl: evidenceUrl("preview-smoke") },
    uatTenant: { status: "passed", isolated: true, syntheticDataOnly: true, disposable: true, evidenceUrl: evidenceUrl("uat-tenant") },
    scenarioResults: manifest.scenarioIds.map((id) => ({
      id,
      status: "passed",
      evidenceUrl: evidenceUrl("scenario-" + id),
      operator: "Synthetic Operator",
      completedAt: stamp,
      releaseSha: sha
    })),
    brandApprovals: ["MyFX POS", "FX Digitech", "FX Coworks"].map((brand) => ({
      brand,
      status: "approved",
      reviewer: "Synthetic Brand Reviewer",
      reviewedAt: stamp,
      releaseSha: sha,
      evidenceUrl: evidenceUrl("brand-" + encodeURIComponent(brand)),
      settings: { ...brandSettings }
    })),
    signoffs: {
      business: signoff("business"),
      financeAccounting: signoff("financeAccounting"),
      taxLegal: signoff("taxLegal"),
      security: signoff("security"),
      operations: signoff("operations")
    },
    operations: {
      backupRestore: {
        status: "passed",
        evidenceUrl: evidenceUrl("restore"),
        measuredRpoHours: 1,
        measuredRtoHours: 2,
        approvedRpoHours: 24,
        approvedRtoHours: 4,
        targetsApprovedBy: "Synthetic Recovery Owner",
        targetsApprovedAt: stamp,
        targetsEvidenceUrl: evidenceUrl("approved-rpo-rto")
      },
      alertDelivery: operational("alert-delivery"),
      operatorDrill: operational("operator-drill"),
      migrationPlan: operational("migration-plan"),
      rollbackPlan: operational("rollback-plan")
    },
    security: {
      secretScanStatus: "passed",
      secretScanEvidenceUrl: evidenceUrl("secret-scan"),
      dependencyReviewStatus: "passed",
      dependencyReviewEvidenceUrl: evidenceUrl("dependency-review"),
      dependencyRiskOwner: "Synthetic Risk Owner"
    },
    productionChange: {
      status: "approved",
      owner: "Synthetic Change Owner",
      windowStart: "2026-10-24T10:00:00.000Z",
      windowEnd: "2026-10-24T11:00:00.000Z",
      evidenceUrl: evidenceUrl("change-window")
    },
    decision: {
      status: "go",
      owner: "Synthetic Release Decision Maker",
      decidedAt: stamp,
      releaseSha: sha,
      evidenceUrl: evidenceUrl("go-no-go")
    },
    openBlockers: []
  };
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "pack-10-gate-test-"));
const evidencePath = path.join(tempDir, "evidence.json");
function run(packet, candidateSha = sha) {
  writeFileSync(evidencePath, JSON.stringify(packet, null, 2), { mode: 0o600 });
  return spawnSync(process.execPath, [checkerPath, "--evidence=" + evidencePath, "--sha=" + candidateSha], {
    encoding: "utf8",
    timeout: 10000,
    env: { PATH: process.env.PATH ?? "", HOME: os.tmpdir() }
  });
}
const labelPasses = [];
function expectPass(label, packet) {
  const result = run(packet);
  assert.equal(result.status, 0, label + " should pass: " + (result.stdout || "") + (result.stderr || ""));
  assert.match(result.stdout, /structurally complete/);
  labelPasses.push(label);
}
function expectBlocked(label, mutate, expected) {
  const packet = makePacket();
  mutate(packet);
  const result = run(packet);
  const output = (result.stdout || "") + (result.stderr || "");
  assert.equal(result.status, 1, label + " should block: " + output);
  if (expected) assert.match(output, expected, label + " should report the intended blocker");
  labelPasses.push(label);
}

expectPass("complete synthetic evidence packet", makePacket());

const mismatch = run(makePacket(), "b".repeat(40));
assert.equal(mismatch.status, 1);
assert.match((mismatch.stdout || "") + (mismatch.stderr || ""), /does not match the requested --sha/);
labelPasses.push("CLI candidate SHA mismatch");

expectBlocked("missing canonical scenario", (p) => { p.scenarioResults.pop(); }, /Missing canonical UAT scenario/);
expectBlocked("duplicate scenario ID", (p) => { p.scenarioResults.push({ ...p.scenarioResults[0] }); }, /Duplicate scenario result/);
expectBlocked("scenario not passed", (p) => { p.scenarioResults[0].status = "blocked"; }, /is not passed/);
expectBlocked("scenario from a different SHA", (p) => { p.scenarioResults[0].releaseSha = "b".repeat(40); }, /must match the candidate SHA/);
expectBlocked("missing scenario operator", (p) => { delete p.scenarioResults[0].operator; }, /needs an operator/);
expectBlocked("insecure scenario evidence URL", (p) => { p.scenarioResults[0].evidenceUrl = "http://evidence.example.invalid/item"; }, /HTTPS evidence URL/);
expectBlocked("Pack 9 remains pending", (p) => { p.pack9.status = "pending"; }, /Pack 9 must be accepted/);
expectBlocked("Preview deployed SHA differs", (p) => { p.preview.deployedSha = "b".repeat(40); }, /preview.deployedSha must match/);
expectBlocked("missing brand approval", (p) => { p.brandApprovals = p.brandApprovals.filter((b) => b.brand !== "FX Coworks"); }, /Missing brand approval/);
expectBlocked("brand tax rule is unapproved", (p) => { p.brandApprovals[0].settings.taxRules = "pending"; }, /taxRules must be approved/);
expectBlocked("sign-off SHA mismatch", (p) => { p.signoffs.financeAccounting.releaseSha = "b".repeat(40); }, /signoffs.financeAccounting.releaseSha/);
expectBlocked("not-applicable sign-off without rationale", (p) => { p.signoffs.taxLegal.status = "not-applicable"; }, /needs a written rationale/);
expectBlocked("backup RPO outside approved target", (p) => { p.operations.backupRestore.measuredRpoHours = 25; }, /Measured RPO exceeds approved RPO/);
expectBlocked("backup RTO outside approved target", (p) => { p.operations.backupRestore.measuredRtoHours = 5; }, /Measured RTO exceeds approved RTO/);
expectBlocked("open critical blocker", (p) => { p.openBlockers.push("Synthetic unresolved blocker"); }, /openBlockers must be an empty array/);
expectBlocked("invalid production change window", (p) => { p.productionChange.windowEnd = p.productionChange.windowStart; }, /window end must be after/);
expectBlocked("GO decision SHA mismatch", (p) => { p.decision.releaseSha = "b".repeat(40); }, /GO decision must match/);
expectBlocked("dependency exception missing owner", (p) => { p.security.dependencyReviewStatus = "accepted-exception"; p.security.dependencyRiskOwner = ""; }, /Dependency risk owner is required/);
expectBlocked("CI SHA mismatch", (p) => { p.ci.commitSha = "b".repeat(40); }, /ci.commitSha must match/);

const missingArgs = spawnSync(process.execPath, [checkerPath], { encoding: "utf8", timeout: 10000 });
assert.equal(missingArgs.status, 2);
assert.match((missingArgs.stdout || "") + (missingArgs.stderr || ""), /Both --evidence and --sha are required/);
labelPasses.push("missing CLI arguments fail with usage error");

const malformedSha = spawnSync(process.execPath, [checkerPath, "--evidence=" + evidencePath, "--sha=not-a-sha"], { encoding: "utf8", timeout: 10000 });
assert.equal(malformedSha.status, 2);
assert.match((malformedSha.stdout || "") + (malformedSha.stderr || ""), /40-character lowercase commit SHA/);
labelPasses.push("malformed release SHA fails with usage error");

rmSync(tempDir, { recursive: true, force: true });
console.log("Pack 10 gate tests passed: " + labelPasses.length + " acceptance cases.");
for (const label of labelPasses) console.log("PASS: " + label);
