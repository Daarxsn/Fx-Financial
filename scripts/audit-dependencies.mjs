import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const ADVISORY = "GHSA-vfj7-8cjw-p6xm";
const EXPIRES_AT = "2026-11-05T23:59:59Z";
const EXPECTED_HIGH_CHAIN = {
  braces: null,
  micromatch: "braces",
  "fast-glob": "micromatch",
  "@next/eslint-plugin-next": "fast-glob",
  "eslint-config-next": "@next/eslint-plugin-next",
};

function runNpm(args) {
  return spawnSync("npm", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function fail(message) {
  console.error("FAIL: " + message);
  process.exit(1);
}
function parseJson(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("npm audit did not return a JSON object");
  return JSON.parse(output.slice(start));
}

const production = runNpm(["audit", "--omit=dev", "--audit-level=high"]);
if (production.error) fail("could not run the production dependency audit: " + production.error.message);
if (production.status !== 0) {
  console.error(production.stdout);
  console.error(production.stderr);
  fail("production dependency audit reports a high/critical issue");
}
console.log("PASS: production dependency audit has no high/critical advisory (npm audit --omit=dev --audit-level=high).");

const all = runNpm(["audit", "--json"]);
if (all.error) fail("could not run full dependency audit: " + all.error.message);
if (all.status === 0) {
  console.log("PASS: full development and production dependency audit is clean; no temporary exception needed.");
  process.exit(0);
}

let report;
try {
  report = parseJson(all.stdout);
} catch (error) {
  console.error(all.stdout.slice(0, 8000));
  fail("full dependency audit failed and could not be safely parsed: " + (error instanceof Error ? error.message : "unknown error"));
}

const vulns = report.vulnerabilities ?? {};
const high = Object.entries(vulns).filter(([, value]) => ["high", "critical"].includes(value.severity));
const highNames = high.map(([name]) => name).sort();
const expectedNames = Object.keys(EXPECTED_HIGH_CHAIN).sort();
if (JSON.stringify(highNames) !== JSON.stringify(expectedNames)) {
  console.error("High/critical findings: " + highNames.join(", "));
  fail("full dependency audit contains a high/critical finding outside the exact reviewed braces toolchain advisory chain");
}
for (const [name, expectedParent] of Object.entries(EXPECTED_HIGH_CHAIN)) {
  const item = vulns[name];
  if (!item || item.severity !== "high") fail("unexpected severity or missing package in advisory chain: " + name);
  const via = Array.isArray(item.via) ? item.via : [];
  if (name === "braces") {
    const exactAdvisory = via.some(entry => entry && typeof entry === "object" &&
      (entry.source === ADVISORY || String(entry.url ?? "").includes(ADVISORY)));
    if (!exactAdvisory) fail("braces is no longer linked solely to the reviewed advisory; review the new audit output");
    if (item.fixAvailable !== false) fail("a remediation may now exist for braces; remove the exception and upgrade");
  } else if (!via.includes(expectedParent)) {
    fail("dependency path changed for " + name + "; review before renewing the exception");
  }
}

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (!manifest.devDependencies?.["eslint-config-next"]) fail("eslint-config-next moved out of devDependencies; reassess reachability");
for (const name of Object.keys(EXPECTED_HIGH_CHAIN)) {
  const entry = lock.packages?.["node_modules/" + name];
  if (!entry || entry.dev !== true) fail("vulnerable toolchain package is no longer proven development-only: " + name);
}
if (lock.packages["node_modules/braces"].version !== "3.0.3" ||
    lock.packages["node_modules/eslint-config-next"].version !== "16.4.0" ||
    lock.packages["node_modules/@next/eslint-plugin-next"].version !== "16.4.0") {
  fail("reviewed dependency versions changed; the existing exception no longer applies");
}
if (Date.now() > Date.parse(EXPIRES_AT)) fail("temporary braces exception expired; a fresh review is required");

const lower = Object.entries(vulns).filter(([, value]) => ["low", "moderate"].includes(value.severity));
console.warn("EXCEPTION: " + ADVISORY + " remains high severity in the dev-only eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces chain.");
console.warn("No patched braces release is listed in the reviewed advisory. The incompatible forced downgrade is intentionally not applied.");
console.warn("Time-boxed engineering exception expires " + EXPIRES_AT + "; exact advisory/chain/version changes or any additional high/critical finding fail this check.");
if (lower.length) console.warn("npm audit also lists lower-severity items below the blocking threshold: " + lower.map(([name,value]) => name + " (" + value.severity + ")").join(", "));
console.log("PASS: full dependency audit contains only the explicitly reviewed and time-boxed dev-only advisory chain.");
