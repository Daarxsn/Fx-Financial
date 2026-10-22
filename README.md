# Falchion Xeniaa Invoice Management System

Internal invoice management platform built with Next.js App Router, React, TypeScript, and MySQL.

## Current status

The repository contains 25 forward-only MySQL migrations, database verification and repeatable reference seeding (24 permission definitions, seven roles, and 77 baseline role-permission mappings), local-password authentication/session security with RBAC, company/brand/legal-entity/tax/numbering/template configuration, transactionally guarded invoice/quotation lifecycles, the Pack 3 manual payment-and-receipt workflow, and Pack 4 evidence-backed policy controls. Pack 5's implementation now includes immutable financial-document content snapshots, PDFKit-based invoice/quotation/receipt rendering, private S3-compatible object storage for production, development-only filesystem storage, SHA-256 verification, generation leases/retries, append-only artifact events, protected legal-entity-scoped history/download endpoints, and PDF-history panels in all three financial workspaces. The CI contract now includes the 25-migration baseline, document rendering/storage regression checks, and authenticated API coverage for generation, explicit regeneration, download integrity and scope isolation. Pack 5 remains **validation-gated** until the current main-branch CI run is green and the generated PDFs receive manual screen/print review against issuer-approved templates. A real private bucket, retention/backup configuration and production secrets must be set by the deployment owner; no public URL or test fixture constitutes production evidence. Required real issuer/business/finance/tax decisions remain PENDING until authorized owners record actual decisions and evidence; CI fixtures are not company approval. Statutory/e-invoice integration or credit/debit-note treatment remains blocked until the required issuer-specific decisions and implementations are approved and verified. Email delivery, delivery evidence and reminders remain Pack 6. Provider-level Aiven restore evidence, approved production database grants/HTTPS configuration, and manual real-device/assistive-technology acceptance are separate go-live gates. See the [production execution roadmap](docs/production-execution-roadmap.md), [Phase 00–06 implementation tracker](docs/phase-00-06-implementation-tracker.md), [current repository audit](docs/repository-audit-phase-00-06.md), and [closure gates](docs/phase-00-06-closure-gates.md).

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

Settings shows sanitized SVG invoice-layout reconstructions guided by the supplied samples as reference-only designs. They are not pixel copies of the source invoice sheets, active template records, or issued PDFs. The raw invoice samples are deliberately not served from `public/` because they contain example business/customer/financial details.

Phase 07 customer/catalog work is in progress directly on `main`. See [the Phase 07 scope and implementation status](docs/phase-07-customer-and-catalog.md), [the Phase 01–06 tracker](docs/phase-00-06-implementation-tracker.md), [the repository audit](docs/repository-audit-phase-00-06.md), and [the closure gates](docs/phase-00-06-closure-gates.md). Formal business/finance/tax approval, a provider-level Aiven restore drill, approved production values and runtime configuration, and manual visual QA remain open until independently completed.
