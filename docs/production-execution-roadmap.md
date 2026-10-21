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

#### Pack 0 lock record — 2026-10-21

**Disposition: PACK 0 ACCEPTED AND BASELINE LOCKED for continued engineering.** This lock applies to the stabilization baseline only; it is not a production go-live approval for the invoice product.

- [x] **0.1 Baseline verified:** `main` is `e7a317c30124ca36815ade6080e1b4a9cf52064a`; CI run [39550457133](https://github.com/Daarxsn/Fx-Financial/actions/runs/39550457133) completed successfully against that exact SHA.
- [x] **0.2 Money/payment code review:** exact-decimal quotation subtraction uses the shared fixed-point helper; the payment route uses scaled-integer arithmetic, authorization/scope checks, CSRF protection, row locking, transactional writes, outstanding-balance validation and idempotency.
- [x] **0.3 Regression verification:** the successful CI run completed MySQL 8 migration/seed/repeatability and dump/restore checks, safe health failure checks, OpenAPI validation, auth/authorization/API integration tests (including the new payment API regressions), Phase 6B snapshot checks, calculation tests, UI validation, lint, TypeScript, production build and Playwright browser acceptance.
- [x] **0.4 Current-state documentation reconciled:** README, this roadmap, Phase 08, the implementation tracker, the dated repository audit and closure gates now distinguish current repository facts from earlier historical snapshots.
- [x] **0.5 Single progress record established:** this section is the Pack 0 source of truth and records the accepted commit, CI evidence and unresolved non-Pack-0 gates.

**Baseline lock rule:** Pack 1 may start from this commit. Do not amend this accepted baseline in place; any later fix must be a new, tested commit on `main`. Reopen Pack 0 if CI fails, money arithmetic changes, database migration/seed invariants regress, authorization/idempotency safety regresses, or a critical defect is found.

**Still open before production go-live (not Pack 0 blockers):** formal business/finance/tax sign-off; production legal-entity/tax/numbering configuration; Aiven/provider-level backup restore drill and approved RPO/RTO; production secrets, HTTPS origin and database grants; manual desktop/mobile and accessibility acceptance; and completion/approval of PDF/private storage, email, payment reversals/receipts/reconciliation, reminders, reporting and operational monitoring. These are not marked complete by a green CI run.

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

**Pack 1 current-state evidence (2026-10-21):** The current main CI run [39551159277](https://github.com/Daarxsn/Fx-Financial/actions/runs/39551159277) passed on `ef0522c2a334fb2c0f48bfd9efb97d85285dfffc`. It includes the Phase 7 customer/catalog UI foundation tests, API/authentication/master-data integration suite, lint, TypeScript, production build, and Playwright acceptance. This establishes automated CI evidence, not completion of the remaining manual/provider gates below. Do not mark Pack 1 locked until migrations 011–012 are verified against the intended Aiven development/test database and the manual browser/accessibility checklist is recorded. Production launch additionally requires the listed finance/tax/business decisions and production operations gates.

### Pack 2 — Invoice + quotation lifecycle (two-part acceptance)

**Goal:** establish one reliable, auditable path from invoice draft to controlled issuance and from quotation draft through customer decision to a linked invoice draft.

#### Part A — Invoice lifecycle

- Re-audited invoice list, draft create/edit, detail and issue handlers against the secured API contract and the actual workspace.
- Hardened cross-draft issuance idempotency under concurrency: the advisory uniqueness check no longer performs a missing-key gap-lock read; the database unique constraint remains authoritative, and a proven conflicting key is reconciled to a safe 409 response.
- Extended real-browser acceptance through draft creation, edit/recalculation and issuance; verified authoritative totals, official numbering and exactly one integrity-hashed issue-configuration snapshot.
- Existing MySQL/API regressions continue to cover four-place exact-decimal calculations, idempotent retry/conflict, stale-version rejection, server-side issue recalculation, issue-time customer snapshot display, catalog-edit immutability, multi-invoice number allocation and snapshot count.

**Part A evidence:** completed CI baseline commit f9c2a307549b6e1873b64c1020ec09dd68ad8deb; [full successful CI run 39567709020](https://github.com/Daarxsn/Fx-Financial/actions/runs/39567709020).

#### Part B — Quotation lifecycle

- Verified draft create/edit/list/detail with idempotency and optimistic record versions; stale writes and stale transitions are rejected.
- Verified DRAFT → SENT → ACCEPTED → CONVERTED through real protected API transitions and the actual browser workspace.
- Sending requires an active scoped legal entity/customer, at least one line and valid entity timezone. It reserves the approved quotation number and records immutable configuration, issuer/supplier and customer snapshots. The UI accurately states that this transition does not send an email or generate a PDF.
- Expiry is evaluated against the legal entity timezone. Invalid timezone configuration fails closed; expired quotes are not accepted or converted.
- Conversion revalidates current entity/customer/currency/tax configuration, recalculates through the shared exact-decimal invoice engine, links the source quotation, creates one editable invoice draft, and never issues it automatically.
- Existing integration tests cover conversion retry races (one invoice draft), same-key replay, different-key conflict, record-version checks, unchanged totals, audit events and invalid-timezone fail-closed behavior.
- Quotation status/conversion feedback now remains visible after the detail state is refreshed.

**Part B evidence:** the same complete CI run verified the MySQL-backed API suite, OpenAPI, lint, TypeScript, production build, and Playwright browser acceptance.

#### Pack 2 final acceptance record — 2026-10-21

- [x] Part A — invoice lifecycle and issuance hardening.
- [x] Part B — quotation lifecycle and linked invoice-draft conversion.
- [x] Exact-decimal calculations and idempotency/concurrency regression coverage.
- [x] API integration, immutability, snapshot and scope/authentication checks.
- [x] Invoice workspace browser create/edit/issue flow and database snapshot/number verification.
- [x] Quotation workspace browser create/send/accept/convert flow; database verification confirms a CONVERTED quotation linked to one editable DRAFT invoice.
- [x] Browser acceptance at desktop (1365px), tablet (768px) and mobile (390px); no horizontal overflow and no uncaught browser JavaScript errors.
- [x] Full CI passed on functional baseline f9c2a307549b6e1873b64c1020ec09dd68ad8deb: [CI 39567709020](https://github.com/Daarxsn/Fx-Financial/actions/runs/39567709020).

**Engineering disposition:** Pack 2 is accepted and locked for continued engineering on main. The final lock record/quality cleanup commit must also retain green CI. A later change to issue, snapshot, quotation-transition, conversion or money-calculation behavior reopens the affected acceptance gate until the relevant tests and full CI pass.

**Important release boundary:** this lock means the software slice is integrated and tested; it is not a claim that the whole product has production go-live approval. Finance/legal policy for invoice cancellation/correction must be approved before implementing those actions. Business/tax sign-off, the configured Aiven development verification and provider-level restore drill, production secrets/database grants/HTTPS configuration, and manual real-device/assistive-technology acceptance remain separate pre-production gates. PDF/private-storage and outbound email delivery remain later product work, not an implied Pack 2 capability.

**Gate 2:** Invoice and quotation workflows are accepted for engineering progression. Pack 3 may build on this locked baseline after the final lock-record commit's CI is green. A draft is not an issued document; quotation conversion is not automatic issuance.

### Pack 3 — Manual payments and receipts

**Goal:** a usable, auditable, reconciled manual payment workflow. This pack records payment events; it does not claim bank settlement or gateway processing.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 3.1 | Certify invoice-linked payment and standalone receipt APIs. | Input validation, invoice/entity scope, permission, CSRF, idempotency and audit contract tests pass. |
| 3.2 | Exercise rejected submissions and authorization boundaries. | Missing idempotency key, impossible date, invalid method, invalid amounts, draft invoice, missing permission, out-of-scope entity and currency mismatch are rejected without creating ledger rows. |
| 3.3 | Prove retry and concurrency safety. | Same-key/same-payload replays; conflicting reuse returns 409; different-key concurrent payment attempts cannot aggregate-overpay; concurrent reversal attempts create one reversal event only. |
| 3.4 | Certify payment list/detail, allocation history and balances. | Exact-decimal invoice balances reconcile to recorded allocations; multiple partial allocations remain visible in receipt history. |
| 3.5 | Certify reversal semantics. | A reason is mandatory; only a recorded receipt in scope may be reversed with permission; source allocations remain immutable/auditable; the reversal event is retained and audited; linked invoice balances are restored. |
| 3.6 | Deliver the payment and invoice workspace flows. | Browser acceptance records a standalone receipt, allocates selected partial amounts, views history, reverses with a reason, and records a fully allocated invoice payment; no premature success feedback. |
| 3.7 | Preserve receipt identity and immutable source information. | Every receipt has its own generated reference and record-time customer/legal-entity snapshots; a receipt is not represented as a new invoice. |
| 3.8 | Reconcile invoice and receipt balances for users with payment-read permission. | Overview displays per-legal-entity, per-currency issued invoice totals, allocated amounts, outstanding balances, recorded receipt totals, receipt allocations, unallocated balances, reversed receipt count and an explicit overpayment discrepancy indicator. |
| 3.9 | Validate responsiveness, accessibility foundation and integration. | Responsive checks at desktop (1365 px), tablet (768 px) and mobile (390 px); OpenAPI, migration/restore, API, lint, TypeScript, production build and browser acceptance pass. |
| 3.10 | Keep future delivery work out of the accepted slice. | No payment gateway, bank settlement feed, PDF rendering/private delivery or email delivery is implied; PDF rendering remains Pack 5. |

#### Pack 3 Part A — Ledger, API and reversal integrity

- Certified the invoice-linked payment endpoints and standalone receipt API, scoped payment options, and payment list/detail endpoints.
- Receipt amounts and invoice totals use four-decimal exact money handling. Server-side entity/customer scope and permission checks are enforced, including rejecting a submitted currency that differs from the legal entity's configured currency.
- Idempotency behavior covers same-request replay, conflicting same-key payloads, missing keys, and concurrent different-key attempts against one outstanding balance.
- Allocation records remain in the ledger after reversal. A reversal requires a reason, is permission/scope gated, updates invoice balances from recorded allocations, stores a unique reversal event, emits an audit event, and safely handles simultaneous reversal requests.

#### Pack 3 Part B — Workspace and reconciliation

- Overview now links to Payments. The Payments workspace supports standalone receipt capture, partial invoice allocation, receipt detail/history, and reasoned reversal; invoice detail supports payment recording/history and server-validated outstanding limits.
- Receipt references and record-time customer/legal-entity snapshots are persisted and shown in receipt detail. Successful UI feedback is shown only after the refreshed state is available.
- Overview exposes a no-store, permission-scoped receivables summary grouped by legal entity and currency. It is derived from issued invoices and recorded allocations, excludes reversed receipts from active balances, separates recorded/allocation/unallocated receipt totals, and surfaces overpaid invoice discrepancies rather than offsetting them against other invoices.
- Database-backed acceptance compares summary values against invoice and receipt list APIs using exact decimal sums. Browser acceptance checks the Overview snapshot and responsive layout.

**Pack 3 final acceptance record — 2026-10-21**

- [x] Part A — invoice-linked payments, standalone receipts, exact-decimal validation and configured-currency enforcement.
- [x] Idempotent replay/conflict behavior, explicit failed-submit cases and no-write-on-rejection assertions.
- [x] Partial and repeated allocations, over-allocation/overpayment protection, concurrent payment and reversal race tests.
- [x] Permission- and legal-entity-scoped receipt APIs, reversal reason/authorization, immutable allocation history and reversal/audit event checks.
- [x] Part B — Payments workspace, invoice payment panel, receipt detail/history and reasoned reversal workflow.
- [x] Overview receivables snapshot grouped by legal entity and currency, with API totals reconciled to invoice and receipt lists.
- [x] Browser acceptance across invoice payment, standalone receipt, allocation and reversal workflows; overview responsive checks at 1365 px, 768 px and 390 px.
- [x] MySQL migration/seed/failure-safety/restore, health endpoints, OpenAPI, API integration, UI foundation, authorization, invoice/quotation checks, lint, TypeScript, production build and Playwright browser acceptance passed on commit 2e70d546919efc148440bf75bb24dc029a7e8425: [CI 39592429295](https://github.com/Daarxsn/Fx-Financial/actions/runs/39592429295).

**Engineering disposition:** Pack 3 is accepted and locked on main. Pack 4 may start from this baseline. A change to payment recording, allocation, reversal, permission/scope, snapshots or reconciliation reopens the affected acceptance gate until the relevant tests and full CI pass.

**Release boundary:** this lock is an engineering acceptance for Pack 3, not whole-product production go-live approval. Manual receipts do not establish bank settlement. Payment-gateway integration, bank matching, PDF rendering/private storage and email delivery remain out of scope (PDF rendering is Pack 5). Business/finance/tax sign-off, provider-level Aiven restore evidence, approved production secrets/database grants/HTTPS configuration, and manual real-device/assistive-technology acceptance remain separate pre-production gates.

**Gate 3:** Pack 3 accepted. Pack 4 may proceed; Pack 4 remains responsible for approvals and issued-document correction policy, and does not inherit implied gateway, PDF or email capabilities.

### Pack 4 — Approvals and issued-document correction policy

**Goal:** make approvals and issued-document corrections explicit, auditable and safe without inventing the company's accounting, tax or statutory decisions. Pack 4 is an engineering control layer, not a substitute for the actual named business/finance/tax owners' sign-off.

| Chunk | Work | Acceptance evidence |
|---|---|---|
| 4.1 | Add a global and legal-entity scoped decision register for issuer mapping, numbering, financial year, currency, calculation/tax treatment, payments, correction policy, separation of duties and statutory applicability. | Required decisions start PENDING; every resolved outcome records the actual decision, rationale, approver name/role, date and evidence reference. |
| 4.2 | Gate invoice issuance on required global and issuer-specific decisions as well as the existing technical configuration readiness checks. | Pending, blocked, missing or unresolved policy rows return `POLICY_APPROVAL_REQUIRED` before sequence reservation or configuration snapshot creation. |
| 4.3 | Preserve append-only decision history and audit every policy outcome. | Both API and policy workspace expose prior outcomes and evidence references; history changes do not rewrite previous events. |
| 4.4 | Implement issued-invoice cancellation/correction request creation with reason, scope checks, CSRF, idempotency and immutable source snapshots. | Re-request/replay/conflicting-key behavior is covered; only one pending correction request per invoice exists; source invoice remains ISSUED while a request awaits review. |
| 4.5 | Add independent review and separation of duties. | Requester cannot approve their own request; reviewer decisions require rationale and scope/permission checks; request history and audit events persist. |
| 4.6 | Implement cancellation only under an explicitly approved, narrowly-scoped policy. | Requires approved payment and separation-of-duties policy, an approved `CANCEL_UNPAID_ONLY` correction mode, and zero active recorded allocations; source number/record is preserved, lifecycle changes to CANCELLED with actor/reason and audit trail. |
| 4.7 | Refuse unimplemented statutory correction/submission actions rather than fabricating documents. | Credit/debit-note requests can be recorded/rejected but execution is blocked until issuer-specific note treatment is approved and implemented. A generic D-11 APPROVED result is rejected while electronic/statutory submission is not implemented. |
| 4.8 | Deliver policy-decision, correction-request and review screens. | Invoice detail can submit a correction request; Approvals shows a scoped review queue; policy decisions show pending/resolved status and history/evidence details. |
| 4.9 | Validate against isolated MySQL and browser fixtures. | Negative issuance, no-write-on-failure, correction idempotency, one-pending guard, self-review denial, paid-invoice cancellation refusal, unimplemented note refusal, audit/history, lint, type-check, build and Playwright pass. |

#### Part A — Evidence-backed policy and issuance guard

- Migration 022 adds the global and issuer-specific policy registry, append-only policy event table, and correction-request schema. Migration 023 adds a database-level unique pending-request guard per invoice. No real decision is seeded as approved.
- D-01/D-05/D-08/D-09/D-10 are global issuance gates. D-02/D-03/D-04/D-06/D-07/D-11 are legal-entity-specific gates. New legal entities receive issuer-specific PENDING rows inside their creation transaction; existing issuers receive PENDING rows through migration 022.
- Policy writes require finance configuration authorization, CSRF and an explicit rationale. APPROVED/NOT_APPLICABLE require decision text, external approver name/role, approval date and an evidence reference. Every change emits an append-only decision-history event and an audit event.
- Issuance locks and checks the required global and issuer rows before number allocation and snapshot creation. Missing or pending decisions fail closed.
- **Statutory boundary:** this product does not implement electronic invoice/statutory submission. D-11 cannot be marked APPROVED until the integration and verification exist. The owner may record NOT_APPLICABLE with evidence only if the actual issuer is genuinely not subject to that requirement; otherwise keep it PENDING/BLOCKED.

#### Part B — Issued-document correction and independent review

- An issued invoice can receive a CANCEL/CREDIT_NOTE/DEBIT_NOTE correction request with a business reason. Idempotency protects request retries; a conflicting key or second pending request is rejected. The original number, totals, configuration snapshot and issue data remain unchanged while review is pending.
- Correction review requires `invoices:cancel`, `approvals:decide`, finance-configuration approver authorization, entity scope, CSRF and an independent reviewer. The requester cannot approve their own request. REQUESTED/REJECTED/EXECUTED events and corresponding audit events are retained.
- Direct cancellation executes only when D-08, D-09 and D-10 are explicitly approved, D-09 selects `CANCEL_UNPAID_ONLY`, the source is still an issued invoice, and there are no active recorded allocations. The original invoice record and number are preserved; its lifecycle moves to CANCELLED with reviewer/actor and reason recorded.
- Credit/debit notes are **not** falsely marked executed. Their correction requests can be recorded for independent review, but approval returns `CORRECTION_TREATMENT_BLOCKED` until issuer-specific tax, numbering, template, source linkage and statutory treatment is implemented; the source invoice remains unchanged.
- The generic invoice issue endpoint now rejects new draft `CREDIT_NOTE` and `DEBIT_NOTE` records with `CORRECTION_TREATMENT_BLOCKED` before number reservation or issue-snapshot capture. Configuring note numbering/templates does not authorize a legal correction. A matching idempotent retry of a legacy already-issued note remains a safe replay; it does not create a new note or bypass the original correction flow.
- The Policy decisions screen now displays current status plus append-only prior decisions and their evidence references. The Approvals queue exposes request history and maker-checker actions. Browser checks cover request creation without source mutation, queue visibility and policy workspace access.

**Pack 4 final engineering acceptance record — 2026-10-21**

- [x] Part A — global and issuer-scoped policy register; all real decisions begin unresolved/pending.
- [x] Invoice issue gate blocks pending/missing required decisions before official number reservation and configuration snapshot creation.
- [x] Evidence requirements, finance authorization, issuer-scope requirements, decision history and audit events.
- [x] D-11 statutory/e-invoice boundary fails closed: no generic approval can imply an integration that does not exist.
- [x] Part B — correction request, idempotency/conflict, one-pending guard, scoped queue, review reason, separation of duties and immutable request events.
- [x] Cancellation guards enforce the approved unpaid-only path and zero active recorded allocations; original record/number is preserved and cancellation is audited.
- [x] Credit/debit-note execution stays blocked until real issuer policy and source-linked implementation exist; rejection is available without mutating the source.
- [x] Generic issue endpoint rejects new draft credit/debit notes before sequence allocation/snapshot creation; API regression tests verify the draft state, invoice number, issue idempotency key and snapshot remain untouched. Matching idempotent replays for already-issued historical documents remain supported.
- [x] MySQL 8 migration/seed/failure-safety/restore, secret scan, health behavior, OpenAPI, API integration, Phase 6B numbering/snapshot, calculation, responsive/accessibility foundation, customer/catalog, invoice/quotation, lint, TypeScript, production build and Playwright passed on code commit `7d4d0f1b73aa0266895b82d39c48a74061c8379c`: [CI 39602823628](https://github.com/Daarxsn/Fx-Financial/actions/runs/39602823628).

**Engineering disposition:** Pack 4's controls and workflows are accepted and locked on `main`; Pack 5 can start from this baseline. Policy changes, issuance readiness logic, correction execution, permissions or document-state behavior reopen the relevant acceptance gate until the tests and complete CI pass.

**Release boundary:** this is an engineering lock, not a declaration that Falchion's business, finance or tax owners have signed off. On a real migrated database, required policy rows remain PENDING and issuance will return `POLICY_APPROVAL_REQUIRED` until the actual authorized owners record their decision and secure evidence reference. A CI fixture is never company sign-off. If e-invoicing/statutory submission is required for a real issuer, issuance remains blocked until that integration is implemented and verified. Credit/debit-note execution likewise remains unavailable until issuer-specific treatment is approved and implemented. Pack 5 PDF generation/private storage does not resolve those policy or statutory gates. Aiven provider-level restore evidence, production secrets/database grants/HTTPS, and manual real-device/assistive-technology acceptance remain separate pre-production gates.

**Gate 4:** Pack 4 engineering accepted. Pack 5 may proceed, with production issuance intentionally blocked for any issuer whose required real approval/policy evidence is unresolved.

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
