import { execSync } from "node:child_process";
import { loadProjectEnv } from "./load-env";

loadProjectEnv();

function runCommand(name: string, command: string) {
  const start = Date.now();
  console.info(`\n[RUNNING] ${name}...`);
  try {
    const output = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.info(`  ✓ ${name}: PASS (${duration}s)`);
    return output;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}: FAILED\n`, errorMsg);
    throw new Error(`Pipeline stage failed: ${name}`);
  }
}

async function main(): Promise<void> {
  console.info("================================================================================");
  console.info("PHASE 8: MASTER PRODUCTION READINESS & VERIFICATION PIPELINE");
  console.info("Target: Full Regression Suite, Security Audit, Telemetry & Release Board GO");
  console.info("================================================================================");

  const stages = [
    {
      name: "Stage 1: TypeScript Compiler Check (tsc --noEmit)",
      command: "npm run typecheck",
    },
    {
      name: "Stage 2: ESLint Code Quality & Conventions (eslint .)",
      command: "npm run lint",
    },
    {
      name: "Stage 3: UI Foundation, WCAG Accessibility & Design Tokens",
      command: "node scripts/validate-ui-foundation.mjs",
    },
    {
      name: "Stage 4: Pack 7 Reporting, Audit Ledger & Financial Contracts",
      command: "node scripts/validate-pack-7.mjs",
    },
    {
      name: "Stage 5: Pack 8 Static Security & Route Protection (118/118 Checks)",
      command: "node scripts/validate-pack-8-security.mjs",
    },
    {
      name: "Stage 6: Dependency Security & Vulnerability Advisory Audit",
      command: "node scripts/audit-dependencies.mjs",
    },
    {
      name: "Stage 7: Pack 9 Infrastructure & Deployment Preflight Scenarios",
      command: "node scripts/validate-pack-9-infrastructure.mjs && node scripts/test-pack-9-readiness.mjs",
    },
    {
      name: "Stage 8: Pack 10 Release Gate & UAT Manifest Acceptance",
      command: "node scripts/validate-pack-10.mjs && node scripts/test-pack-10-release-gate.mjs",
    },
    {
      name: "Stage 9: Workflow Contract & Single-Page PDF Alignment",
      command: "node scripts/verify-simple-invoice-workflow.mjs",
    },
    {
      name: "Stage 10: All CEO Improvements & Role Dashboard Hubs (Phases 2-6)",
      command: "npm run ceo:verify-all",
    },
    {
      name: "Stage 11: 16-Step Lifecycle, 50-Worker Concurrency & Security Gate",
      command: "npm run phase6:verify",
    },
    {
      name: "Stage 12: Production Cutover, Synthetic Health & Release Board Sign-Off",
      command: "npm run phase7:verify",
    },
  ];

  const startTime = Date.now();
  let passedCount = 0;

  for (const stage of stages) {
    runCommand(stage.name, stage.command);
    passedCount++;
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.info("\n================================================================================");
  console.info(`🎉 MASTER PRODUCTION PIPELINE VERIFICATION PASSED: ${passedCount}/${stages.length} STAGES CLEAN (${totalDuration}s) 🎉`);
  console.info("================================================================================");
  console.info("Status: 100% UNANIMOUS GO FOR PRODUCTION DEPLOYMENT & OPERATION");
  console.info("All Forensic Audit Defects (INV-DEF-001 through INV-DEF-011) Remediated.");
  console.info("All CEO Revamp Pillars (Multi-page Routes, Role Dashboards, Complimentary Items) Operational.");
  console.info("================================================================================\n");
}

main().catch((err) => {
  console.error("\n❌ PHASE 8 PRODUCTION PIPELINE FAILED:", err);
  process.exitCode = 1;
});
