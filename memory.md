# Project Memory and Decision Ledger — Fx Financial

This file is a compact, durable handover for future implementation sessions. It is not a substitute for source code, tests, phase trackers or evidence ledgers. Verify facts against the current `main` before relying on version-sensitive details.

## Stable project facts

- Repository: `Daarxsn/Fx-Financial`; the owner requires all work directly on `main`, with no new branches.
- Product: Falchion Xeniaa Invoice Management System.
- Stack: Next.js App Router, React, TypeScript, MySQL through `mysql2`, PDFKit and private S3-compatible storage; Node.js 24. Vercel is a planned host.
- Do not use Vite or perform an architecture rewrite without explicit approval.
- Brand choices: MyFX POS, FX Digitech, FX Coworks. Brand identity and legal entity are distinct.
- Palette: `#DCAF51`, `#931314`, `#111111`, `#F4F4F5`, `#FFFFFF`; supplied transparent WebP logos are the intended assets.
- The first release uses manually recorded payments, not a payment gateway.
- Issued financial snapshots are immutable; calculations are server-authoritative and decimal-safe.
- Production readiness requires actual provider/business evidence, not only successful source-level tests.

## Important current-state pointers

Always read the latest version of these before planning work:
- `README.md` — current product overview, setup and high-level status.
- `docs/production-execution-roadmap.md` — execution policy and production path.
- `docs/phase-00-06-implementation-tracker.md` and `docs/phase-00-06-closure-gates.md` — historical phases and closure evidence.
- `docs/phase-07-customer-and-catalog.md` — customer/catalogue scope and current open checks.
- `docs/repository-audit-phase-00-06.md` — dated audit; historical counts must not be treated as current.
- `docs/pack-9-deployment-and-operations-runbook.md` and Pack 9 readiness ledger — provider/deployment requirements.
- `docs/pack-10-business-uat-plan.md`, scenario manifest, evidence schema and ledger — controlled UAT/release requirements.
- `docs/database-migrations.md`, `docs/development.md`, `SECURITY.md`, `CONTRIBUTING.md`.

## Known decisions and non-negotiable boundaries

1. Work on `main` only; never create a branch.
2. Keep existing architecture and add small tested vertical slices.
3. Never invent issuer identity, tax rates/registrations, bank details, numbering rules, statutory disclosures, payment terms or approval evidence.
4. Unknown/unapproved configuration blocks issuance and reminders.
5. Do not mutate issued snapshots or silently delete referenced master data.
6. Use forward-only migrations; do not edit a migration already applied to a shared DB.
7. Preserve TLS verification and least-privilege database access.
8. Keep PDFs private; customer and financial data must not enter logs or public assets.
9. Email queue state is not final delivery.
10. A green build/CI is not proof of provider recovery, production setup, manual visual acceptance or business sign-off.

## Status discipline

Use these distinct terms:
- **Implemented:** source behavior exists.
- **Automated-tested:** a named test passed at a recorded revision.
- **Environment-verified:** a named check ran against a named non-production/production target.
- **Approved:** a responsible business/finance/security owner explicitly signed off.
- **Released:** the controlled release process approved and deployed the exact SHA.

Never collapse these statuses into a generic “done.”

## Session handover template

At the end of a meaningful work session, record:
- Date and exact starting/ending commit SHA.
- Goal and files changed.
- Decisions made and rationale.
- Commands/tests run and their results.
- External systems/environments actually verified.
- Remaining blockers, evidence needed and responsible owner.
- Next smallest safe step.

Do not store credentials, session cookies, customer records or full invoice contents in this file.
