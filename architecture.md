# Architecture — Fx Financial

## 1. Architecture principles

- Extend the existing implementation; do not redesign from scratch.
- Keep security, financial calculations and business invariants on the server.
- Treat database migrations, API contracts, tests and operational evidence as part of the architecture.
- Fail closed when issuer, tax, numbering, permissions, storage or approval requirements are unresolved.
- Separate a brand's visual identity from the legal entity responsible for issuing a document.

## 2. Confirmed technology baseline

- Next.js App Router, React 19 and TypeScript.
- Node.js 24; npm lockfile and `npm ci`.
- MySQL 8 accessed through `mysql2`; server-only connection pool and TLS certificate verification.
- Versioned, forward-only SQL migrations and a migration ledger with checksums.
- Local-password authentication/session security, RBAC and scoped API authorization.
- Zod validation, OpenAPI validation/contract checks and server-authoritative financial calculations.
- PDFKit rendering; S3-compatible private object storage for issued-document artifacts.
- Durable email outbox, provider integration, signed webhooks, retry/idempotency controls and authenticated scheduled worker.
- Vercel is a planned host, not proof that a production project or its provider configuration is ready.

Verify exact package versions and the actual current migration chain from `package.json`, lockfile, `db/`, scripts and CI before making implementation decisions. Documentation counts can become stale.

## 3. Logical layers

1. **Presentation:** App Router pages and client components for settings, customer/catalogue workspaces, quotation/invoice/receipt workflows, document history, delivery history, reminder policies and reporting.
2. **Route/API boundary:** route handlers parse and validate input, establish authenticated context, apply CSRF/origin checks to mutations, enforce permission/entity scope, and return safe response contracts.
3. **Domain services:** lifecycle transitions, issuer-readiness checks, decimal-safe calculations, numbering, immutable snapshots, payment allocation, PDF/document handling, email orchestration, reminders and reporting.
4. **Persistence:** server-only MySQL access, parameterized queries, transactions, row locking where concurrent financial changes require it, migrations and audit/event records.
5. **External adapters:** private S3-compatible object storage, email provider/webhooks, scheduled worker and hosting/runtime configuration.
6. **Verification/operations:** unit and integration scripts, disposable MySQL, browser acceptance, OpenAPI checks, security audits, readiness preflight, smoke tests, UAT evidence and release gates.

Keep module boundaries aligned with the code that actually exists. Do not introduce a new framework or duplicate domain logic in UI components.

## 4. Financial document lifecycle and consistency

- A draft may be edited under the relevant permission and lifecycle rules.
- Issuance must validate the selected brand's approved legal issuer, effective configuration, numbering, tax and required fields before committing.
- Perform calculations on the server using exact decimal/scaled-integer arithmetic; never trust client totals.
- Commit numbering, lifecycle transition and immutable issuer/customer/line/tax/total snapshots atomically where the current model requires it.
- A later customer/catalogue/configuration edit must not rewrite an issued document.
- Corrections, cancellations, reversals and retries must use explicit, audited paths; never silently mutate history.
- Payment allocation must lock or otherwise safely coordinate invoice balance updates and reject zero, invalid or over-balance allocations according to the documented contract.
- Email queueing is not delivery. Surface queued, accepted, delivered, bounced/failed and retry states only when supported by recorded evidence.

## 5. Data and migrations

- Migrations are forward-only. Never edit a migration that may have been applied to a shared database; create a new migration for a schema change.
- Keep migration ledger/checksum behavior intact.
- Seed only reference data deliberately defined as safe. Reference seeding must not silently create users or grant privileges.
- Use exact database decimal types for financial values and explicit currency boundaries.
- Archive customers/catalogue records referenced by financial history rather than deleting them.
- Use transactions and constraints for invariants where practical; use application checks and tests for cross-record policies.
- Keep production runtime database grants narrower than migration/administrative grants.

## 6. Authentication and authorization

Every protected API must enforce authentication, permission and legal-entity scope server-side. For mutations, retain CSRF/origin protections and idempotency controls where applicable. Never assume a hidden UI control is an access-control boundary. Error responses must not reveal SQL, driver, provider, credential or sensitive customer details.

## 7. Documents and storage

Generate PDFs from persisted, immutable document snapshots and approved issuer configuration. Store production documents in a private bucket; validate authorization before serving downloads. Preserve content checksums and immutable attachment references where implemented. Never publish raw sample sheets containing customer or financial details. Validate storage retention, access policy and backups independently.

## 8. Email and scheduled work

Use the durable outbox rather than sending untracked email inside a user request. Enforce provider idempotency, bounded retry, signed webhook verification, append-only event history and worker authentication. Reminder policies require explicit finance approval evidence and versioning. Verify the hosting plan supports the configured cadence; otherwise use an approved external scheduler. Never mark reminders active because code exists.

## 9. Verification and operational boundaries

A successful local build proves neither database/provider reachability nor production readiness. Validate exact candidate SHA in CI, use isolated synthetic data for UAT, run safe deployment smoke tests, and record separate evidence for live database TLS/grants, managed backup restoration, private storage, email/webhooks, scheduler execution, visual PDF quality, accessibility and business approvals.

## 10. Architecture change protocol

Before a material change: inspect the existing implementation and tests, state the problem, identify impacted layers/data/API contracts, propose the smallest compatible change, add migration/rollback considerations, implement tests, run relevant gates, review the diff, update this file and related phase docs, then commit directly to `main` as required by the project owner.
