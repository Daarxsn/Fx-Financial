# FX Invoice Generator — Production Execution Roadmap

**Repository:** `Daarxsn/Fx-Financial`  
**Execution branch:** `main` only  
**Prepared:** 2026-10-20  
**Purpose:** Finish the existing product in small, testable, production-oriented chunks without replacing working architecture or pretending that unapproved business settings are ready.

## 1. Product outcome: what “complete” means

The target is a cohesive invoice and financial-document platform for Falchion Xeniaa, not just invoice CRUD.

The finished product must support:

- Three commercial brand identities/templates: **MyFX POS**, **FX Digitech**, and **FX Coworks**. A brand is not automatically a legal billing entity. The actual brand-to-legal-entity mapping must come from approved company records.
- Reusable customers and billable item/service catalogue.
- Draft, edit, validate, issue, view, search, and controlled correction/cancellation of financial documents.
- Server-authoritative decimal-safe calculations, approved/effective-dated tax rules, controlled numbering, and immutable issue-time snapshots.
- Quotations, lifecycle/status tracking, and safe conversion to an invoice draft.
- Manually recorded payments, allocations, partial/full payment status, receipts, and reasoned/audited reversals. No payment gateway in the first release.
- Correct branded invoice/quotation/receipt PDFs, private file storage, authorized download, and document history.
- Customer email delivery, visible delivery status, retry-safe delivery, and overdue reminders.
- Overview dashboards, reconciled reports, controlled bulk export, and searchable audit history.
- Strict authentication, role/permission and legal-entity scope enforcement; reliable migrations, recovery, deployment, monitoring, and business acceptance.
- Stack retained: Next.js App Router, React, TypeScript, MySQL through `mysql2`, and Vercel as the planned web host. No Vite migration or architecture rewrite.

**Launch principle:** technical completion and business/legal approval are separate gates. The application may be code-complete while issuance remains blocked until a real issuer, tax rules, numbering, templates, and required statutory treatment are approved.

## 2. Execution rules

1. Work directly on `main`. Do not create branches or parallel PRs.
2. Start from the latest `main`; never overwrite newer commits with stale content. Refetch the current file and SHA before any file update.
3. Prefer one small, reviewable commit per coherent vertical slice (endpoint + tests, or UI + tests). Do not commit an API without its tests just to show progress.
4. Because newer pushes can cancel older CI runs, avoid stacking commits while the required CI is still running unless fixing a known CI blocker. After a commit, wait for its CI result before treating the slice as done.
5. Every slice ends with: lint, TypeScript, relevant automated tests, production build/CI, and a short evidence note. Use the fastest focused test locally first, then the complete CI gate.
6. Use migrations only for genuine schema changes. Migrations are forward-only; never edit a migration already applied to any shared database.
7. Never use production credentials for CI/local testing; never print, commit, or paste secrets. Do not disable TLS certificate verification to work around a database connection error.
8. Do not populate real legal name, GST/tax details, bank data, invoice settings, payment terms, or statutory applicability from visual samples or guesses. Keep readiness false when required values are unknown.
9. Do not run migrations/seeds or destructive changes against production without explicit approval, a verified backup/restore plan, and a reviewed change procedure.
10. Keep customer-visible errors safe; do not log raw financial/customer PII, credentials, SQL diagnostics, or session secrets.
11. Do not mark a feature “complete” just because a route or page exists. It needs persistence, permission checks, failure/loading/empty states, end-to-end tests, and a clear acceptance result.
12. Update this roadmap and the relevant phase tracker as each gate passes. Record blockers honestly with an owner and evidence needed.

## 3. Verified starting position

Pack 0 starting baseline checked on 2026-10-21:

- Starting `main`: `921dcf71c2d5b1847abbabfcdb8c57920614832e` — `docs: refresh pack 2 issuance regression baseline`.
- Baseline CI run [39394867060](https://github.com/Daarxsn/Fx-Financial/actions/runs/39394867060) completed **successfully** against that exact SHA.
- CI steps verified MySQL 8 migration/seed repeatability and dump/restore, safe health failures, OpenAPI, authentication/authorization/API contracts, Phase 6B snapshots, exact-decimal invoice calculations, UI checks, lint, TypeScript, production build, and Playwright browser acceptance.
- Current schema contains 18 forward-only migrations. The CI baseline asserts 24 permission definitions, seven roles, and 77 role-permission mappings.
- Exact-decimal quotation taxable-value subtraction is implemented by `subtractMoney`, with a high-value `DECIMAL(19,4)` regression test.
- The manual payment-recording endpoint exists and uses exact scaled-integer arithmetic, invoice row locking, scoped authorization, CSRF protection, transaction boundaries, and idempotency. Its pre-Pack-0 integration coverage relied on direct SQL for balance setup rather than exercising the endpoint; this pack adds direct API tests for retries, conflicting keys, overpayments, zero values, history, and exact balances.

### Core already present (still subject to current regression checks)

- Next.js/React/TypeScript app, MySQL migrations/reference seed, health checks, OpenAPI and CI.
- Local-password/session authentication, RBAC, CSRF/origin safeguards, rate-limits/security events, and entity-scoped access checks.
- Company/brand/legal-entity/tax/numbering/template settings foundation and issue-time snapshots/configuration-readiness checks.
- Customer and item/service catalogue CRUD, archive, search/pagination and CSV import/export.
- Invoice draft/create/edit/list/detail, server-calculated amounts, controlled issue path, idempotency and optimistic concurrency.
- Quotation workflow and conversion foundation exists on `main`; its remaining workflow and UI/API coverage must be re-audited rather than assumed complete.
- The invoice payment-recording API is present in the green baseline CI. Pack 0 adds direct endpoint integration coverage; payment reversals, receipts, payment workspace UI, reconciliation, and business acceptance remain open.
- Scaled-integer/`BigInt` money calculations are established. The exact-decimal quotation-list fix and high-value regression test are covered by the green baseline CI.

### Not yet production-complete

- Confirmed, independently passing CI for the latest changes.
- Manual real-browser/customer/catalog/invoice/quotation acceptance and responsive/accessibility review.
- Formal business/finance/tax policy approvals recorded in `docs/phase-02-signoff-packet.md`.
- Configured MySQL/Aiven proof for the current migrations and latest end-to-end changes; provider-level backup restore drill.
- Complete payment allocation/reversal/receipt path and UI.
- Approved issue correction/cancellation/credit/debit-note behavior.
- Real PDF generation, private object storage, integrity history and permissioned document delivery.
- Durable email outbox, email delivery, reminders/jobs, reports/export completion, production hosting/monitoring and operational runbooks.
- Production UAT and explicit go-live approval.

**Documentation warning:** older audit/tracker documents may retain historically accurate counts from earlier revisions. For current-state reporting, use the current migration tree and CI baseline: 18 migrations, 24 permission definitions, seven roles, and 77 baseline role-permission mappings. Do not rewrite historical records; add dated corrections where current-state wording is stale.

## 4. Definition of done for every chunk

A chunk is accepted only when all applicable statements below are true:

- [ ] The change implements one clearly bounded behavior.
- [ ] Server-side authentication, permission, legal-entity scope, validation, and no-store behavior are correct where relevant.
- [ ] Money uses exact decimal strings/BigInt logic—never floating-point arithmetic for accounting calculations.
- [ ] Multi-step writes are atomic, idempotent where appropriate, and safe under duplicate/concurrent requests.
- [ ] Audit evidence exists for consequential financial or administrative actions.
- [ ] API contract/OpenAPI, UI, and automated tests agree.
- [ ] Loading, empty, validation, success, failure, unauthorized, and stale/conflict states are handled.
- [ ] The relevant regression test, `npm run lint`, `npm run typecheck`, and `npm run build` pass locally/CI as applicable.
- [ ] Required CI run is green on the commit being accepted.
- [ ] No unknown business facts were invented and no secret or real customer data was committed.
- [ ] The commit SHA, test evidence, and any remaining operator/business blocker are noted in the tracker.

## 5. Small-chunk execution sequence

### Pack 0 — Stabilize the baseline before adding more features

**Goal:** prove the newest code is safe and restore a reliable cadence. No new feature work until this pack passes.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 0.1 | Check latest `main` SHA and latest CI run. Inspect failed/cancelled/in-progress status and rerun/fix on `main` as appropriate. | The latest current SHA has one completed green CI run; no claim relies on cancelled runs. |
| 0.2 | Review the two exact-decimal quotation commits and current invoice-payment route diff. Confirm the money regex, decimal helper, idempotency behavior, transaction and authorization are correct. | Code review notes plus focused regression coverage. |
| 0.3 | Run the payment route through lint, TypeScript, build and all CI integration tests. Fix any route/test defects before extending it. | Green CI on the payment route commit. |
| 0.4 | Reconcile stale README/phase docs with the real current repository: migrations, permission count, seed count, last completed features, and pending phases. Do not rewrite historical records; add dated corrections/current-status notes. | Documentation counts agree with the current migrations, seed and CI workflow. |
| 0.5 | Establish one single progress checklist in this roadmap with commit SHA, CI link, automated tests, and remaining manual/provider gates. | One source of truth for remaining work; no contradictory “complete” labels. |

**Gate 0:** The newest main commit has green CI, exact-decimal regression passes, and the roadmap reflects current code. Do not build further layers over a failing baseline.

### Pack 1 — Close customer/catalog to acceptance quality

**Goal:** finish the existing master-data slice before layering more financial features on it.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 1.1 | Audit customer and item/service APIs for every list/create/read/update/archive/import/export route, validation, permissions and entity policy. | Route-to-permission matrix and negative authorization tests pass. |
| 1.2 | Test exact-decimal item prices, unusual lengths, currency consistency, invalid values, duplicate codes, stale versions and concurrent updates. | API tests show clean validation/conflict behavior; no float money regressions. |
| 1.3 | Test CSV validate/commit modes, duplicate warning/confirmation, row-level errors, size limits and all-or-nothing commits. | Good, malformed, duplicate, oversized and unauthorized import tests pass. |
| 1.4 | Finish customer and catalog UI states: empty, loading, validation, API failure, archive confirmation, pagination and no-results. | UI tests verify state transitions and no accidental hard delete. |
| 1.5 | Perform a manual keyboard/screen-reader-label/contrast/light-dark review at desktop, tablet and mobile widths. Repair only demonstrated defects. | Recorded manual acceptance checklist with defects resolved or owner-tagged. |
| 1.6 | Against the dedicated development Aiven database, verify TLS, migration ledger, seeded permissions, customer/catalog CRUD and import/export without changing production. | Redacted evidence only; no raw credentials or customer rows. |

**Gate 1:** Customer/catalog workflows are accepted, scoped and reliable. Historical invoice/quotation references survive archive and edits.

### Pack 2 — Lock invoice + quotation workflows before payments depend on them

**Goal:** one consistent, auditable path from draft to legally approved issue.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 2.1 | Re-audit invoice list/create/detail/update/issue and quotation create/update/list/detail/status/conversion endpoints against OpenAPI and actual workspace UI. | Implemented-vs-planned route checklist; no assumed completeness. |
| 2.2 | Add/repair lifecycle tests: create, edit draft, validation errors, optimistic-lock conflict, idempotent retry and issue retry. | API and integration tests cover success, duplicates and conflicts. |
| 2.3 | Confirm issued invoices contain complete immutable snapshots of issuer, customer, line labels/units/prices, tax mode/rule, totals, terms, due date, selected brand/template and numbering evidence. | Snapshot tests prove edits to customer/catalog/entity settings cannot mutate issued history. |
| 2.4 | Stress concurrent invoice issuance and number allocation for one entity/series/year. | No duplicate official numbers; transaction rollback leaves no partial issue. |
| 2.5 | Test quotation conversion for correct source linkage, approved customer/entity context, fresh server recalculation, currency/tax revalidation, idempotency and repeat attempts. | One source quotation cannot silently create duplicates; converted draft remains editable until issue. |
| 2.6 | Repair invoice/quotation UI errors, keyboard access, stale-state handling and responsive detail views; include role-restricted users. | Browser run verifies normal and forbidden transitions. |
| 2.7 | Implement any identified cancellation/correction requirement only after the finance/tax decision gate in Pack 4 is supplied. Until then, keep unsupported actions blocked. | No issue-number reuse or silent rewrite of issued data. |

**Gate 2:** Invoice and quotation flows are functionally coherent and tested. A draft is not an issued document, and conversion is not an automatic issue.

### Pack 3 — Finish manual payments and receipts

**Goal:** a fully usable, reconciled manual payment workflow without a gateway.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 3.1 | Complete static review and CI certification of `POST/GET /api/v1/invoices/{invoiceId}/payments`; fix any gaps. | Exact-decimal validation, invoice/entity scope, permission, CSRF, idempotency and audit tests pass. |
| 3.2 | Add integration tests to record a payment against an issued invoice: valid, invalid date/amount/method, draft/cancelled invoice, unauthorized user, cross-entity request and missing key. | Expected HTTP/result contract and unchanged data after rejection. |
| 3.3 | Test same-key/same-payload replay and same-key/different-payload conflict; send concurrent payment attempts that together would exceed balance. | Exactly-once behavior and no overpayment under race. |
| 3.4 | Add/review payment list/detail query and allocation history; make balances derive from valid, recorded allocations with exact decimals. | Invoice balance, customer balance and payment history reconcile. |
| 3.5 | Implement payment reversal API: reason required, only recorded payments reversible, authorization/scope checked, linked invoices locked safely, allocation retained, reverse event audited, duplicate reversal rejected. | Reversal never deletes ledger history; balance returns accurately. |
| 3.6 | Add reversal tests including concurrent attempts, already-reversed payments, invalid reason, scope denial and linked invoice balance recalculation. | Race/security/reconciliation regression suite passes. |
| 3.7 | Build invoice payment UI: record payment form, method/reference/date/notes, amount validation, current outstanding limit, pending/success/error/conflict states. | Real browser can record an accepted payment; failures never show false success. |
| 3.8 | Add payment history, allocation amount/date/reference/status and permission-gated reversal UI with explicit confirmation/reason. | History updates after record/reversal; controls disappear or reject for unauthorized roles. |
| 3.9 | Add printable receipt source data and receipt record semantics; receipt gets its own immutable reference and does not masquerade as a new invoice. | Receipt totals/status exactly match the recorded payment and allocation. PDF rendering follows Pack 5. |
| 3.10 | Reconcile invoice totals, payment allocations, reversals and outstanding balance across list, detail, dashboard inputs and API. | Integration reconciliation tests cover unpaid, partial, fully paid and reversed states. |

**Gate 3:** A user can record a manual payment, see its allocation and updated balance, reverse it with a reason if authorized, and audit the full history. No gateway is required.

### Pack 4 — Approvals and issued-document correction policy

**Goal:** prevent the app from inventing the company's accounting/legal rules.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 4.1 | Complete the decision rows in `docs/phase-02-signoff-packet.md`: actual issuer mapping, financial year/numbering, currency, rounding, tax/discounts, terms, payments/overpayment, corrections, permissions, statutory/e-invoice scope, templates and communications. | Named authorized decision-makers, dates and evidence references; unresolved rows stay blocked. |
| 4.2 | Map MyFX POS, FX Digitech and FX Coworks to the actual approved legal entity/entities and effective dates. | Configuration includes only evidenced mappings; brand is not assumed to be an issuer. |
| 4.3 | Add tests using finance-approved worked examples for tax-inclusive/exclusive, discount order, half-up rounding, charges and due dates. | Approved expected values match server and UI; rejected/unapproved rules cannot be selected. |
| 4.4 | Based on approved policy, implement explicit cancellation/correction flow: reason, authorized action, payment-state guard, original preserved, linked document, audit trail and approved numbering treatment. | Issued invoice never gets silently edited or deleted. |
| 4.5 | If required by approved policy, implement credit/debit-note flows with original-document linkage and tax/total treatment. | Separate sequence/lifecycle as approved; no made-up legal assumptions. |
| 4.6 | Determine e-invoice/statutory submission applicability for each actual issuer. Implement the integration only if required and sufficiently specified; otherwise record the approved not-applicable outcome. | No claim of electronic submission/IRN exists without verified external confirmation. |
| 4.7 | Add a readiness gate that blocks issuing if required legal entity, approved tax rule, numbering, template, currency or statutory prerequisites are absent. | Negative readiness tests prove unknown configuration cannot issue. |

**Gate 4:** All critical accounting and issuer decisions are signed or explicitly documented as blocked/not-applicable with rationale. Real issuance remains disabled where required approval is missing.

### Pack 5 — Real document generation and private history

**Goal:** actual branded PDFs, not static sample SVGs or preview-only artwork.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 5.1 | Select a server-compatible PDF renderer and a private object-storage provider based on deployment compatibility, costs, backup/retention, encryption and access control. Record the choice before implementation. | Provider/renderer decision and operational configuration requirements documented. |
| 5.2 | Define document-record metadata: source document/version, immutable snapshot identifier, object key, MIME type, size, checksum, creation time/actor, generation status and error status. Add forward-only migration only if needed. | Migration and repository model tests pass; bucket/object URLs are not public. |
| 5.3 | Build a deterministic PDF renderer from the stored issued snapshot. Use approved brand/entity template configuration; never rebuild an historical PDF from mutable customer/catalog data. | Same snapshot renders consistent document content, number, tax, total and issuer. |
| 5.4 | Implement invoice PDF generation and private object storage upload; verify successful upload before marking document ready. | Failed generation/upload yields safe visible retry state and no false success. |
| 5.5 | Implement quotation PDF and payment receipt PDF with correct lifecycle/status labels. | All document types display correct amount/status and the correct identity/template. |
| 5.6 | Implement document history and permission-checked download/preview endpoints. Use short-lived signed URLs only if approved and ensure keys are not guessable. | Unauthenticated, expired, cross-entity and wrong-permission requests cannot fetch files. |
| 5.7 | Add checksums, regenerate/retry rules, duplicate suppression, deletion/retention policy and audit history. | File replacement or re-render does not silently erase original issued evidence. |
| 5.8 | Add PDF visual regression tests for long names, wrapping, multiple pages, large totals, decimals, empty optional fields and all three brands. | Approved visual baselines pass and sensitive sample content is not embedded. |
| 5.9 | Manually inspect real generated invoice, quotation and receipt PDFs on screen and print layout; validate links/fonts/page breaks. | Finance/business reviewer accepts visual output. |

**Gate 5:** Real private PDFs and document history work for issued invoices, quotations and receipts; historical content is snapshot-derived and downloads are access-controlled.

### Pack 6 — Email sending, delivery evidence, and reminders

**Goal:** reliable outbound communications without duplicate emails or leaked attachments.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 6.1 | Select and configure an email provider with verified sender/domain, secret handling and delivery-event support. Do not commit credentials. | Sandbox/provider health and sender validation documented. |
| 6.2 | Add a durable email outbox with delivery job ID, recipient, document/source ID, attachment checksum, status, attempt count, next retry, provider message ID and sanitized error category. | Migration/model/API tests pass; writes are durable across process restarts. |
| 6.3 | Implement permission-checked “send invoice/quotation/receipt” action with recipient confirmation, correct PDF attachment and idempotency. | No duplicate send on refresh/retry; recipient is visible before send. |
| 6.4 | Implement retry/backoff and terminal-failure states; process provider webhook/events only after validating authenticity. | Timeouts and provider failures cannot silently show “sent”; repeated events are idempotent. |
| 6.5 | Add customer email delivery timeline and manual retry control to the UI. | Authorized users can inspect outcome without seeing credentials or raw provider payloads. |
| 6.6 | Add overdue reminder policy/configuration only after finance approval; implement a durable scheduler/queue, not in-process timers. | Due-date/time-zone handling is defined, testable and auditable. |
| 6.7 | Re-check payment/outstanding/cancelled state immediately before reminder send and prevent duplicate reminders for the same policy window. | Paid/reversed/cancelled documents are handled according to policy; retry is idempotent. |
| 6.8 | Test email templates for three brands, PDFs, long names, safe links, unsubscribe/contact requirements where applicable and no internal notes. | Provider sandbox plus template tests pass. |

**Gate 6:** Email send, status, retries and approved overdue reminders are durable, idempotent and traceable.

### Pack 7 — Dashboard, reports, audit and exports

**Goal:** business-readable data that reconciles to persisted financial records.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 7.1 | Define finance-approved metric definitions: issued value, paid amount, outstanding, overdue, quotations won/expired, reversals, date basis, currency and treatment of cancelled/credit/debit documents. | Metric glossary approved and linked to the decision packet. |
| 7.2 | Implement bounded, entity-scoped dashboard queries; aggregate using exact DB decimals and handle time zone/date range explicitly. | Dashboard numbers reconcile to known seeded integration fixtures. |
| 7.3 | Implement invoice/quotation/customer/payment reports with filters, stable sort order and pagination. | Combined filters and permission/scope cases covered. |
| 7.4 | Implement bulk exports with approved fields, row limits, access checks, audit event and safe filenames/content types. | Cross-entity export denied; export values reconcile to report queries. |
| 7.5 | Implement CSV spreadsheet-injection protections for user-controlled cells and safe handling of formula-leading values. | Export security tests pass without changing legitimate stored financial values. |
| 7.6 | Add searchable audit views for issue, correction, payment, reversal, file access where required, settings, exports and email sending. | Read access itself is permission-scoped; events are append-only and PII-minimized. |
| 7.7 | Reconcile reports/exports against invoice/payment data for unpaid, partial, paid, reversed, corrected and cancelled cases. | Automated reconciliation suite passes. |
| 7.8 | Finish dashboard/reporting states and large-data performance checks. | Empty/no-match/error/loading states work; query limits/indexes are validated. |

**Gate 7:** Dashboard, reports and exports are accurate, permissioned and traceable to source records.

### Pack 8 — Security, correctness and reliability hardening

**Goal:** attack and failure testing across complete workflows, not just happy-path feature tests.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 8.1 | Build/refresh an endpoint permission matrix for all invoice, quotation, payment, document, email, report/export and configuration routes. | Every route has positive and negative permission/scope tests. |
| 8.2 | Run cross-entity IDOR tests by substituting valid IDs from a different entity across all APIs and downloads. | No data leakage through body, counts, error details, files or audit searches. |
| 8.3 | Test CSRF/origin, session expiry/revocation, role/scope change, rate limits, malformed input and oversized requests. | Auth/security suite is green; failure messages contain no internal diagnostics. |
| 8.4 | Test concurrency/idempotency for issue, numbering, draft edits, quote conversion, payment record/reversal, PDF/email retries and scheduled reminders. | No duplicate financial records/documents/notifications or stale overwrites. |
| 8.5 | Test decimal precision and edge values throughout API/UI/PDF/report/export, including very large DECIMAL values and fourth-place rounding. | Same amount is preserved across the complete document lifecycle. |
| 8.6 | Review SQL joins, indexes, transactions, lock ordering, pagination bounds and query performance against realistic row volumes. | No unbounded list queries; no known deadlock loops; slow queries identified and addressed. |
| 8.7 | Review all dependencies, npm audit output, secret-scanning history and environment exposure; address reachable vulnerabilities or document accepted exception/risk owner. | Current scan is recorded; no known critical/high actionable runtime issue is silently ignored. |
| 8.8 | Add/verify security headers, production error handling, log redaction, private-file policy, retention, and audit-event integrity. | Security checks and a release-specific threat checklist pass. |
| 8.9 | Run a brutal read-only end-to-end audit of every feature and build a defect ledger; do not mix audit-only work with fixes. | Findings have severity, repro, impact, owner, fix commit and retest evidence. |
| 8.10 | Fix every blocker/high-risk finding one focused slice at a time; rerun targeted and full suites after each logical fix. | No unresolved release-blocking finding. |

**Gate 8:** No known critical/high-risk defect remains without an explicit, authorized release exception; no unauthorized path can read or mutate finance data or files.

### Pack 9 — CI/CD and production infrastructure

**Goal:** reproducible release and recoverable service, not only a successful build.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 9.1 | Confirm CI runs install, secret scan, MySQL migrations/seed/restore tests, contract/auth tests, calculations, UI validation, lint, types and production build. Add missing later-phase tests to CI. | Fresh CI run passes from a clean checkout. |
| 9.2 | Add browser-based smoke/E2E checks for login, setup readiness, customer/catalog, quotation, invoice issue, payment, PDF access and permissions. | Critical path runs on clean disposable MySQL fixtures; no production data required. |
| 9.3 | Verify Vercel framework/build settings, Node version, root directory, install/build commands, environment scope and domain configuration. | Preview deployment builds from the exact main commit. |
| 9.4 | Define and validate secrets/env variables: `DATABASE_*`, verified TLS CA source, `SESSION_SECRET`, exact HTTPS `APP_ORIGIN`, storage credentials, email credentials and webhook secrets. | Production secret checklist passes without exposing values; separate environment scopes. |
| 9.5 | Create separate, least-privilege DB identities for runtime, migration, backup/restore and read-only audit where the provider supports it. Rotate any credential exposed in chat/logs/history via the provider's approved process. | Runtime cannot perform schema DDL unless explicitly authorized; old rotated credential fails; no secret appears in repo. |
| 9.6 | Confirm Aiven/DB availability plan, allowed networks, TLS certificate validation, connection limits/timeouts, backups and retention. | `npm run db:verify` passes against the intended non-production target with TLS enabled and cert validation intact. |
| 9.7 | Perform provider-level backup restore into a separate isolated database/service, compare migration/data invariants, and record RPO/RTO. | Successful restore drill and approved recovery targets documented. |
| 9.8 | Review/approve production migration sequence, backup point, expected locks/downtime, post-migration verification and recovery actions. | Written change record; no migration edited after application. |
| 9.9 | Apply the reviewed migration plan to production only with explicit change approval and verified backup. | Production schema matches expected checksums/counts; smoke tests pass. |
| 9.10 | Deploy to Vercel, verify HTTPS/domain/security headers, database connectivity, storage, email, sessions and health endpoints. | Production smoke tests pass with approved real config; no test data or credentials exposed. |
| 9.11 | Add structured redacted logs, error monitoring, availability alerts, provider quota/cost alerting and job/outbox backlog monitoring. | Triggered test alerts arrive to the assigned operator. |
| 9.12 | Add deploy/rollback, migration recovery, access incident, email/storage outage and database restoration runbooks. | A second operator can execute each runbook in a drill. |

**Gate 9:** Production-like preview passes end-to-end checks, database/storage/email are configured securely, and recovery/rollback procedures are rehearsed. Production promotion requires explicit approval.

### Pack 10 — Business UAT and controlled release

**Goal:** prove the actual business workflows before the launch decision.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 10.1 | Prepare a non-production UAT tenant using only approved representative test data; do not copy live customer financial data unnecessarily. | Test data is documented, isolated and safely disposable. |
| 10.2 | Run role-specific workflows for Super Administrator, finance/operator and read-only/limited users. | Allowed tasks succeed; prohibited tasks are denied. |
| 10.3 | Test each brand configuration against its **approved** legal entity, document layout, logo, numbering, currency, tax and payment settings. | All required readiness checks pass; unapproved brand/entity combinations cannot issue. |
| 10.4 | Execute full journeys: customer/catalog → quotation → conversion → invoice draft → review/issue → PDF → email → partial payment → full payment → receipt → reversal/correction as policy permits → reporting/export. | Every transition reconciles to database/audit/document history. |
| 10.5 | Test representative failures: duplicate submit, network timeout, PDF failure, email failure, stale edit, invalid tax config, access denial, payment overrun and DB outage. | Clear recovery paths; no false success or corrupted financial state. |
| 10.6 | Business, finance/accounting, tax/legal (where required), security and operations owners sign their own acceptance areas. | Written sign-offs with owner, date, scope and evidence. |
| 10.7 | Run final release audit, confirm no secrets or temporary fixtures, verify all CI runs for release SHA, and produce release notes/known limitations. | Green evidence packet on exact release SHA. |
| 10.8 | Obtain an explicit go/no-go decision and execute a controlled rollout with operator coverage, smoke tests and rollback trigger. | Named decision-maker and reversible launch procedure. |

**Gate 10:** Release is approved only after the complete critical path, policy approvals, security checks, recovery proof and operator/business acceptance are recorded.

## 6. Critical blockers that cannot be “coded around”

These may run in parallel with safe UI/API engineering but must be closed before the affected production capability is enabled:

1. **Business/finance/tax sign-off:** legal issuer identities, brand mapping, actual tax registrations/rules, numbering, financial year, currency, calculation/rounding examples, payment/correction policy, template fields and statutory/e-invoice applicability.
2. **Infrastructure/provider readiness:** production domain, Vercel environment, verified DB TLS, properly scoped credentials, private object storage, email sender, backup retention and a tested restore.
3. **Manual acceptance:** actual browser checks on desktop/tablet/mobile, keyboard/accessibility and PDF output.
4. **Operational ownership:** alert recipients, monthly spend ceiling, RPO/RTO, incident response and release/rollback authority.

A code commit or CI pass does not replace any of these approvals. Where a fact is unknown, keep the related production action disabled and clearly reported as blocked.

## 7. Fast execution method and commit batching

To move quickly without building defects into the next phase:

- Work in the listed order. Do not start PDF/email/report features until invoice snapshots, document identity and payment balances are stable.
- Finish one small vertical slice at a time: **implementation → automated regression test → focused check → commit on main → full CI → update tracker**.
- Keep commits small, but do not split one feature into several pushes that cause CI cancellation. Pair endpoint + regression tests; pair UI + UI tests; make documentation corrections their own commit when independent.
- If CI fails, the next work item is to identify the failing job, reproduce the smallest relevant failure, make the smallest fix, then rerun CI. No unrelated feature work during that repair.
- Use automated disposable-MySQL tests for repeatable behavior; use the configured Aiven development environment for separate integration proof; use production only under the approved release process.
- Keep a single defect ledger with severity: **P0** data loss/unauthorized finance access/invalid issue; **P1** broken issue, amount, payment, PDF or delivery path; **P2** significant workflow/UX impairment; **P3** non-blocking polish.
- Do not sacrifice authorization, decimal correctness, transactionality, privacy, migrations, test evidence or restore readiness for speed. Defer optional polish instead.

## 8. Immediate next actions (updated 2026-10-20)

**Latest verified engineering baseline:** `0026defdf6da109a8379e945b7c3a144ba8d07d6`. The full CI run [39394369865](https://github.com/Daarxsn/Fx-Financial/actions/runs/39394369865) passed, including MySQL-backed authorization/invoice/quotation integration tests, Phase 6B configuration and snapshot checks, exact-decimal calculation tests, lint, TypeScript, production build and Playwright browser acceptance.

**Pack 2 regression fixes verified on this baseline:** issued invoice list and detail use the issue-time customer name snapshot instead of a later mutable customer record; quotation conversion fails closed when an entity timezone is invalid; concurrent same-key invoice issue requests are verified to return one original result and one replay with the same allocated number and snapshot hash; reusing the consumed issue key on a different draft is rejected without issuing the second invoice, advancing the sequence, or creating a snapshot.

Perform in this order:

1. Close the remaining Pack 1 operator gates: verify migrations 011–012, idempotent migration rerun, and customer/catalog CRUD plus CSV import/export against the dedicated Aiven development/testing database with verified TLS. Separately complete manual desktop/tablet/mobile, light/dark, keyboard, screen-reader and contrast review. Do not substitute CI MySQL for these checks.
2. Continue Pack 2 with targeted checks for quotation send/accept/expire/convert journeys, issue-time snapshots, stale edits, and conflict/idempotency handling across routes and real workspace flows. Implement only evidenced gaps. Keep invoice cancellation/correction blocked until the approved finance/legal policy is explicit.
3. Finish the manual payment workflow in Pack 3: expand payment recording integration coverage, implement reasoned reversal while preserving allocation history and audit evidence, then add payment UI/history and receipt source records. Require green CI before expanding further.
4. Close the finance/business/tax decisions in Pack 4. Keep issue/correction paths blocked where actual issuer, tax, numbering, terms or statutory settings are not approved.
5. Build deterministic snapshot-derived PDFs and private storage, then email/outbox/reminders, reporting/exports, hardening, deployment, recovery verification and UAT in the listed dependency order.

**Current completion rule:** Pack 1 is automated-tested in CI, but not operationally closed until the configured Aiven and manual acceptance evidence is captured. Pack 2 has passed these automated lifecycle regression gates but remains open for broader workflow and operator acceptance. Do not call the product production-ready until every required pack gate is either passed or has an explicitly approved exception, and all legal/finance/runtime gates relevant to actual issuing are signed and evidenced.
