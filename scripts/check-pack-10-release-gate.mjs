#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH = "docs/pack-10-uat-scenarios.json";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
const failures = [];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function httpsUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" &&
      parsed.password === "" && parsed.hostname !== "";
  } catch {
    return false;
  }
}
function requireObject(root, key, pathName = key) {
  const result = root?.[key];
  if (!isObject(result)) {
    fail(pathName + " must be an object");
    return {};
  }
  return result;
}
function requireValue(object, key, predicate, message) {
  if (!predicate(object?.[key])) fail(key + ": " + message);
}
function requireHttps(object, key, scope) {
  if (!httpsUrl(object?.[key])) fail(scope + "." + key + " must be an HTTPS evidence URL");
}
function requireDate(object, key, scope) {
  const value = object?.[key];
  if (!nonEmpty(value) || !ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    fail(scope + "." + key + " must be a valid ISO date-time");
  }
}
function checkSignoff(signoff, label, sha) {
  if (!isObject(signoff)) {
    fail("signoffs." + label + " must be an object");
    return;
  }
  if (!["approved", "not-applicable"].includes(signoff.status)) {
    fail("signoffs." + label + ".status must be approved or not-applicable");
  }
  for (const key of ["approverName", "approverRole", "scope"]) {
    if (!nonEmpty(signoff[key])) fail("signoffs." + label + "." + key + " is required");
  }
  requireDate(signoff, "approvedAt", "signoffs." + label);
  if (signoff.releaseSha !== sha) fail("signoffs." + label + ".releaseSha must match the candidate SHA");
  requireHttps(signoff, "evidenceUrl", "signoffs." + label);
  if (signoff.status === "not-applicable" && !nonEmpty(signoff.rationale)) {
    fail("signoffs." + label + " needs a written rationale for not-applicable");
  }
}
function validateEvidence(evidence, requestedSha, manifest) {
  if (!isObject(evidence)) {
    fail("Evidence packet must be a JSON object");
    return;
  }

  requireValue(evidence, "schemaVersion", (value) => value === 1, "must equal 1");
  requireValue(evidence, "repository", (value) => value === "Daarxsn/Fx-Financial", "must identify Daarxsn/Fx-Financial");
  const sha = evidence.releaseSha;
  if (!SHA_PATTERN.test(sha || "")) fail("releaseSha must be a 40-character lowercase commit SHA");
  if (requestedSha && sha !== requestedSha) fail("releaseSha does not match the requested --sha");
  if (evidence.openBlockers !== undefined && (!Array.isArray(evidence.openBlockers) || evidence.openBlockers.length !== 0)) {
    fail("openBlockers must be an empty array before release");
  } else if (evidence.openBlockers === undefined) {
    fail("openBlockers is required and must be empty");
  }

  const pack9 = requireObject(evidence, "pack9");
  requireValue(pack9, "status", (value) => value === "accepted", "Pack 9 must be accepted");
  if (pack9.releaseSha !== sha) fail("pack9.releaseSha must match releaseSha");
  requireHttps(pack9, "evidenceUrl", "pack9");

  const ci = requireObject(evidence, "ci");
  requireValue(ci, "status", (value) => value === "success", "full CI must be successful");
  if (ci.commitSha !== sha) fail("ci.commitSha must match releaseSha");
  requireHttps(ci, "runUrl", "ci");
  if (!nonEmpty(ci.runUrl) || !/^https:\/\/github[.]com\/Daarxsn\/Fx-Financial\/actions\/runs\/[0-9]+/.test(ci.runUrl)) {
    fail("ci.runUrl must point to this repository's GitHub Actions run");
  }

  const preview = requireObject(evidence, "preview");
  requireValue(preview, "status", (value) => value === "passed", "Preview acceptance must pass");
  if (preview.deployedSha !== sha) fail("preview.deployedSha must match releaseSha");
  if (preview.smokeStatus !== "passed") fail("preview.smokeStatus must be passed");
  requireHttps(preview, "url", "preview");
  requireHttps(preview, "evidenceUrl", "preview");

  const tenant = requireObject(evidence, "uatTenant");
  requireValue(tenant, "status", (value) => value === "passed", "UAT tenant must be accepted");
  for (const key of ["isolated", "syntheticDataOnly", "disposable"]) {
    if (tenant[key] !== true) fail("uatTenant." + key + " must be true");
  }
  requireHttps(tenant, "evidenceUrl", "uatTenant");

  const scenarioResults = evidence.scenarioResults;
  if (!Array.isArray(scenarioResults)) {
    fail("scenarioResults must be an array");
  } else {
    const expected = Array.isArray(manifest.scenarioIds) ? manifest.scenarioIds : [];
    const results = new Map();
    for (const item of scenarioResults) {
      if (!isObject(item) || !nonEmpty(item.id)) {
        fail("Every scenario result must have an id");
        continue;
      }
      if (results.has(item.id)) fail("Duplicate scenario result: " + item.id);
      results.set(item.id, item);
      if (item.status !== "passed") fail("Scenario " + item.id + " is not passed");
      if (!httpsUrl(item.evidenceUrl)) fail("Scenario " + item.id + " needs an HTTPS evidence URL");
      if (!nonEmpty(item.operator)) fail("Scenario " + item.id + " needs an operator");
      requireDate(item, "completedAt", "scenarioResults." + item.id);
      if (item.releaseSha !== sha) fail("Scenario " + item.id + " must match the candidate SHA");
    }
    for (const id of expected) if (!results.has(id)) fail("Missing canonical UAT scenario: " + id);
    for (const id of results.keys()) if (!expected.includes(id)) fail("Unknown UAT scenario: " + id);
  }

  const requiredBrandSettings = [
    "issuerIdentity", "legalEntityMapping", "templateAndLogo", "numbering",
    "currency", "taxRules", "paymentSettings", "statutoryDisclosure"
  ];
  const requiredBrands = ["MyFX POS", "FX Digitech", "FX Coworks"];
  if (!Array.isArray(evidence.brandApprovals)) {
    fail("brandApprovals must be an array");
  } else {
    const approvals = new Map();
    for (const item of evidence.brandApprovals) {
      if (!isObject(item) || !nonEmpty(item.brand)) {
        fail("Every brand approval must identify a brand");
        continue;
      }
      if (approvals.has(item.brand)) fail("Duplicate brand approval: " + item.brand);
      approvals.set(item.brand, item);
      if (item.status !== "approved") fail("Brand " + item.brand + " must be approved");
      if (!nonEmpty(item.reviewer)) fail("Brand " + item.brand + " needs a reviewer");
      requireDate(item, "reviewedAt", "brandApprovals." + item.brand);
      if (item.releaseSha !== sha) fail("Brand " + item.brand + " must match the candidate SHA");
      requireHttps(item, "evidenceUrl", "brandApprovals." + item.brand);
      const settings = isObject(item.settings) ? item.settings : {};
      if (!isObject(item.settings)) fail("Brand " + item.brand + " needs a settings approval object");
      for (const setting of requiredBrandSettings) {
        if (settings[setting] !== "approved") fail("Brand " + item.brand + " setting " + setting + " must be approved");
      }
    }
    for (const brand of requiredBrands) if (!approvals.has(brand)) fail("Missing brand approval: " + brand);
    for (const brand of approvals.keys()) if (!requiredBrands.includes(brand)) fail("Unknown brand approval: " + brand);
  }

  const signoffs = requireObject(evidence, "signoffs");
  for (const label of ["business", "financeAccounting", "taxLegal", "security", "operations"]) {
    checkSignoff(signoffs[label], label, sha);
  }

  const operations = requireObject(evidence, "operations");
  const backup = requireObject(operations, "backupRestore", "operations.backupRestore");
  requireValue(backup, "status", (value) => value === "passed", "backup/restore drill must pass");
  requireHttps(backup, "evidenceUrl", "operations.backupRestore");
  for (const key of ["measuredRpoHours", "measuredRtoHours", "approvedRpoHours", "approvedRtoHours"]) {
    if (typeof backup[key] !== "number" || !Number.isFinite(backup[key]) || backup[key] < 0) {
      fail("operations.backupRestore." + key + " must be a non-negative number");
    }
  }
  if (typeof backup.measuredRpoHours === "number" && typeof backup.approvedRpoHours === "number" &&
      backup.measuredRpoHours > backup.approvedRpoHours) fail("Measured RPO exceeds approved RPO");
  if (typeof backup.measuredRtoHours === "number" && typeof backup.approvedRtoHours === "number" &&
      backup.measuredRtoHours > backup.approvedRtoHours) fail("Measured RTO exceeds approved RTO");
  if (!nonEmpty(backup.targetsApprovedBy)) fail("Backup/restore RPO/RTO needs an approver");
  requireDate(backup, "targetsApprovedAt", "operations.backupRestore");
  requireHttps(backup, "targetsEvidenceUrl", "operations.backupRestore");
  for (const key of ["alertDelivery", "operatorDrill", "migrationPlan", "rollbackPlan"]) {
    const item = operations[key];
    if (!isObject(item)) {
      fail("operations." + key + " must be an object");
      continue;
    }
    if (item.status !== "passed") fail("operations." + key + " must be passed");
    requireHttps(item, "evidenceUrl", "operations." + key);
    if (!nonEmpty(item.performedBy)) fail("operations." + key + " needs performedBy");
    requireDate(item, "performedAt", "operations." + key);
  }

  const security = requireObject(evidence, "security");
  if (security.secretScanStatus !== "passed") fail("Security secret scan must pass");
  requireHttps(security, "secretScanEvidenceUrl", "security");
  if (!["passed", "accepted-exception"].includes(security.dependencyReviewStatus)) {
    fail("Dependency review must pass or have an explicitly accepted exception");
  }
  requireHttps(security, "dependencyReviewEvidenceUrl", "security");
  if (!nonEmpty(security.dependencyRiskOwner)) fail("Dependency risk owner is required");

  const change = requireObject(evidence, "productionChange");
  if (change.status !== "approved") fail("Production change must be approved");
  if (!nonEmpty(change.owner)) fail("Production change owner is required");
  requireDate(change, "windowStart", "productionChange");
  requireDate(change, "windowEnd", "productionChange");
  if (Date.parse(change.windowEnd) <= Date.parse(change.windowStart)) fail("Production change window end must be after its start");
  requireHttps(change, "evidenceUrl", "productionChange");

  const decision = requireObject(evidence, "decision");
  if (decision.status !== "go") fail("Explicit GO decision is required");
  if (!nonEmpty(decision.owner)) fail("GO decision owner is required");
  requireDate(decision, "decidedAt", "decision");
  if (decision.releaseSha !== sha) fail("GO decision must match releaseSha");
  requireHttps(decision, "evidenceUrl", "decision");
  if (!Array.isArray(evidence.openBlockers) || evidence.openBlockers.length !== 0) fail("Release has open blockers");

  return failures;
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith("--evidence=")) result.evidence = arg.slice("--evidence=".length);
    else if (arg.startsWith("--sha=")) result.sha = arg.slice("--sha=".length);
    else if (arg === "--help" || arg === "-h") result.help = true;
    else {
      console.error("Unknown argument: " + arg);
      process.exit(2);
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/check-pack-10-release-gate.mjs --evidence=/secure/path/evidence.json --sha=<40-character-commit-sha>");
    return;
  }
  if (!args.evidence || !args.sha) {
    console.error("Both --evidence and --sha are required. No deployment action is performed.");
    process.exit(2);
  }
  if (!SHA_PATTERN.test(args.sha)) {
    console.error("--sha must be a 40-character lowercase commit SHA");
    process.exit(2);
  }

  let evidence;
  let manifest;
  try {
    const resolved = path.resolve(args.evidence);
    evidence = JSON.parse(readFileSync(resolved, "utf8"));
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (error) {
    console.error("Unable to read the evidence packet or canonical scenario manifest.");
    console.error(error instanceof Error ? error.message : "Unexpected file error");
    process.exit(2);
  }

  validateEvidence(evidence, args.sha, manifest);
  if (failures.length) {
    for (const failure of failures) console.error("BLOCKED: " + failure);
    console.error("Pack 10 release gate BLOCKED: " + failures.length + " evidence issue(s).");
    process.exit(1);
  }
  console.log("PASS: Pack 10 evidence packet is structurally complete for " + args.sha + ".");
  console.log("REVIEW REQUIRED: links and approval authenticity must be independently checked; this command does not deploy or authorize infrastructure changes.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

export { validateEvidence };
