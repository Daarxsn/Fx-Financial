# Falchion Xeniaa Invoice Management System

Internal invoice management platform built with Next.js App Router, React, TypeScript, and MySQL.

## Current status

The repository contains 31 forward-only MySQL migrations, database verification and repeatable reference seeding (27 permission definitions, seven roles, and 86 baseline role-permission mappings), local-password authentication/session security with RBAC, company/brand/legal-entity/tax/numbering/template configuration, guarded invoice/quotation lifecycles, manual payments/receipts, evidence-backed issuer policy controls, immutable financial-document content snapshots and PDFKit rendering with private S3-compatible storage and SHA-256 verification. Pack 6 adds a durable email outbox, immutable PDF attachment references/checksums, recipient confirmation, provider idempotency, bounded retries, signed delivery webhooks and append-only event history, plus finance-approved, versioned overdue-reminder policies and an authenticated scheduled worker. Email delivery history is integrated into the invoice, quotation and receipt workspaces; a dedicated reminder-policy workspace supports requests, independent approval with evidence, and audited disablement. The main-branch CI and Lockfile bootstrap passed for the final Pack 6 source/test baseline at commit [`82fbe93`](https://github.com/Daarxsn/Fx-Financial/commit/82fbe936cd3794c3ff17a49381320a8c3998ae76): the 28-migration MySQL test, seed/restore checks, OpenAPI and Pack 6 contract tests, full email/reminder API integration, lint, TypeScript, production build, PDF/storage regression checks, and 40 browser acceptance checks passed. The **code-level validation gate is green**. Production release remains gated until the deployment owner configures a real verified sender/domain, API key, signed webhook secret, cron secret, and scheduler (Vercel Pro/Enterprise for the configured five-minute cron, or an external scheduler if the Vercel plan only permits daily cron); finance must separately record actual reminder-policy approval evidence before any real reminders are activated. CI fixtures and test sender addresses are not production approval. Pack 5 visual approval of real PDFs, private-bucket retention/backup, provider-level Aiven restore evidence, approved production database grants/HTTPS configuration, and real-device/assistive-technology acceptance remain separate release gates. See the [production execution roadmap](docs/production-execution-roadmap.md), [database migration guide](docs/database-migrations.md), [Phase 00–06 implementation tracker](docs/phase-00-06-implementation-tracker.md), [current repository audit](docs/repository-audit-phase-00-06.md), and [closure gates](docs/phase-00-06-closure-gates.md).

## Pack 9 — deployment and operations

Pack 9 deployment procedures, the readiness ledger, safe environment preflight, and HTTP smoke test live in [the deployment runbook](docs/pack-9-deployment-and-operations-runbook.md) and [the Pack 9 readiness ledger](docs/pack-9-readiness-ledger.md). These distinguish CI results from required Vercel/Aiven/storage/email/backup/monitoring evidence.

Run the repeatable engineering gates before a release candidate:

```bash
npm run pack9:validate
npm run pack9:test
npm run pack9:smoke-test
npm run pack9:preflight -- --target=preview
```

The preflight requires real values from the selected deployment environment and prints no secret values. The automated synthetic tests validate rejection paths; they do not replace live Preview/Staging, provider restore, or operational release evidence.

## Architecture

- Next.js App Router (no Vite)
- React and TypeScript
- MySQL via mysql2 with TLS certificate verification required in production
- Vercel is a planned web-hosting option; production deployment is not implied by this repository
- Invoice PDFs require private object storage before production use

## Requirements

- Node.js 24 (see `.nvmrc`)
- npm supplied with the selected Node.js release
- MySQL 8 for database integration tests and migrations

## Local development

1. Clone the repository.
2. Copy `.env.example` to `.env.local` and set environment-specific values locally. Never commit `.env.local`.
3. Install the committed dependency graph and run checks:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm run dev
```

Database commands:

```bash
npm run db:migrate
npm run db:seed:reference
```

Only run migrations against a database you are authorized to change. The reference seed creates permission/role definitions but intentionally does not create users or grant permissions. See [database migration operations](docs/database-migrations.md).

## Security and contribution

Never commit credentials, `.env.local`, database dumps, customer financial data, issued invoices or production exports. Read [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), [environment conventions](docs/environments.md), and [development rules](docs/development.md) before contributing.


## Pre-Phase-07 closure — Phases 00–06

The core Phase 01–06 code, tests, audit work and exact supplied logo exports have been merged through PRs #4, #5 and #6. The compatible follow-up brand-picker/palette work and audit-branch history are also integrated into `main`. This final UI pass uses the exact supplied transparent WebP exports for the Falchion Xeniaa corporate logo and the MyFX POS, FX Digitech and FX Coworks marks. The CSS aligns to Gold `#DCAF51`, Saffron Red `#931314`, Charcoal `#111111`, Platinum `#F4F4F5` and White `#FFFFFF`, and keeps gold marks readable with charcoal backing where appropriate.

Settings retains sanitized SVG invoice-layout reconstructions as reference-only previews. Issued PDFs are generated by the active A4 renderer using the chosen brand's approved issuer/configuration snapshot and supplied logo asset; the layout includes the brand header, issuer and BILL TO blocks, line/milestone table, totals, amount in words, saved beneficiary/bank details, approved terms and signature area. The raw invoice sample sheets are deliberately not served from `public/` because they contain example business/customer/financial details.

Phase 07 customer/catalog work is in progress directly on `main`. See [the Phase 07 scope and implementation status](docs/phase-07-customer-and-catalog.md), [the Phase 01–06 tracker](docs/phase-00-06-implementation-tracker.md), [the repository audit](docs/repository-audit-phase-00-06.md), and [the closure gates](docs/phase-00-06-closure-gates.md). Formal business/finance/tax approval, a provider-level Aiven restore drill, approved production values and runtime configuration, and manual visual QA remain open until independently completed.

## Pack 10 — business UAT and controlled release

Pack 10's UAT scenarios, business test plan, evidence schema, fail-closed release checker and lock ledger are documented in [the UAT plan](docs/pack-10-business-uat-plan.md), [the canonical scenario manifest](docs/pack-10-uat-scenarios.json), [the release evidence schema](docs/pack-10-release-evidence.schema.json), and [the evidence ledger](docs/pack-10-uat-evidence-ledger.md). Pack 10 is not a production release approval: the current ledger keeps the gate blocked until actual tenant testing, exact-SHA CI and Preview proof, Pack 9 provider/recovery evidence, owner sign-offs and a formal GO decision exist.

Run source-level checks and synthetic evidence-gate tests:

```bash
npm run pack10:validate
npm run pack10:gate-test
```

The release checker inspects an evidence packet without deploying or mutating production. Supply a completed, independently reviewed packet only after UAT:

```bash
node scripts/check-pack-10-release-gate.mjs --evidence=/secure/path/pack-10-release-evidence.json --sha=<40-character-release-commit-sha>
```

## Everyday invoice flow

The invoice composer is brand-first so daily billing does not require opening Settings:

1. Explicitly choose **MyFX POS**, **FX Digitech**, or **FX Coworks**. No brand is preselected; the approved legal issuer and currency follow the selected brand mapping.
2. New invoices start with blank customer details when your role can create customers, or an unselected existing-customer chooser otherwise; the first saved customer is never silently chosen. Enter/select the recipient, invoice date and item/service lines. Invoice-specific recipients are saved with the draft, so an alternate billing address survives save and reopen.
3. Optionally add milestones and expand **Discount, tax and catalog** only when needed.
4. Choose **Issue & send invoice**. The app saves the draft, validates and issues it through the existing finance workflow, then queues the branded PDF through the durable email outbox. If issuance is blocked, the draft is kept and the reason is shown; if email queuing fails after issuance, the UI distinguishes that from a successful send.
5. Use invoice details to review the private PDF history and email delivery timeline.

Issuer identity, approved tax/registration decisions, invoice numbering, bank details and standard terms are one-time company/brand setup—not data to re-enter per invoice. These values must be reviewed and approved before production issuance. An email status of **queued** is not the same as provider acceptance or final delivery; the configured outbox worker processes the queue and updates delivery evidence.

Run the simple-workflow source contract check with `npm run invoice:simple-workflow-test`.
