> **Phase 00–06 closure pass (2026-10-16):** PRs #4, #5 and #6 are merged to `main`. The exact supplied transparent WebP logos are in the UI; the approved brand-picker and palette-validation follow-up has also been ported directly to `main`. The consolidated `main` revision `b8297972f31ab18d87632dfa718c4ef49c70d35e` passed CI and lockfile/bootstrap ([CI](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38893456152), [bootstrap](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38893456184)). Developer-provided evidence confirms development Aiven TLS/query, migrations 001–010, reference-seed idempotency and both health endpoints. External business/finance/tax approval, provider-level recovery, production configuration and manual browser acceptance remain open; do not infer full phase sign-off.

# Phase 00–06 Implementation Tracker

> **Current-state correction (2026-10-21; preserve historical evidence below):** The older phase entries below describe the code and CI assertions at their recorded dates; their earlier migration/permission counts must not be read as current counts. The current `main` baseline is `e7a317c30124ca36815ade6080e1b4a9cf52064a`; CI [39550457133](https://github.com/Daarxsn/Fx-Financial/actions/runs/39550457133) passed. Current repository/CI counts are **18 migrations, 24 permission definitions, seven roles, and 77 baseline role-permission mappings**. The Pack 0 stabilization gate is accepted and locked for continued engineering. This does not close the separately listed business, finance/tax, provider recovery, production configuration, PDF/storage/email or manual acceptance gates.

**Phase 7 gate:** Phase 7 is now in progress directly on `main` by explicit user instruction. Continue to preserve Phase 1–6 financial/security safeguards, keep production/business/legal acceptance gates visible, and do not mark Phases 1–6 signed-off merely because Phase 7 has begun.

This tracker records verified implementation evidence. Do not mark infrastructure or application behavior complete solely because documentation or source files exist.

## Phase 00 — Foundation

- [x] Lockfile committed and CI uses `npm ci`.
- [x] Clean CI checkout installs and builds on supported Node.js 24.
- [ ] Developer to confirm the Mac worktree is synchronized with merged `main`; do not overwrite or discard local untracked authentication files while reconciling.
- [x] Gitleaks secret scan passed on the tracked repository history after full-history checkout was configured.
- [x] Environment conventions documented for local development, CI/test, staging and production.
- [x] Contribution, review, security reporting and coding standards documented.
- [x] CI and lockfile bootstrap passed for revision `2121950b4fe3c1b9130f9ad8c45813261082df2b`.
- [x] Phase 00 acceptance checklist updated with links to CI evidence.

Evidence:
- CI success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38029253509
- Lockfile bootstrap success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38029253557
- Acceptance record: `docs/phase-00-acceptance.md`

## Phase 01 — Database connectivity and infrastructure

- [x] Server-only MySQL pool uses bounded settings and production requires TLS.
- [x] Optional Aiven CA PEM configuration supports local file path or protected deployment environment value while retaining certificate verification.
- [x] Health endpoints return 200/503 and suppress raw driver errors.
- [x] Versioned migration runner uses a ledger and SHA-256 checksums.
- [x] Repeatable reference seed creates role/permission definitions only; it creates no users and does not assign grants.
- [x] `npm run db:verify` implements a strict `SELECT 1` plus active TLS cipher check with verified certificates.
- [x] CI applied migrations 001/002 to a fresh MySQL 8 instance and safely reran the migration command.
- [x] CI seeded twice and verified the expected 2 migrations, 22 permission definitions and 7 role definitions.
- [x] CI tested a deliberate failed connection without printing raw network/credential diagnostics.
- [x] CI logical dump restored into a separate disposable database with matching base-table count and migration ledger.
- [x] Runtime health endpoint returned 200 for a healthy database and generic 503 for an unavailable database, without raw diagnostics.
- [x] Backup, recovery and least-privilege access policy documented; provider pricing comparison reviewed from current official list-price pages.
- [x] **Live completion gate:** developer ran `npm run db:verify` against the configured Aiven service; `SELECT 1` succeeded, MySQL reported an active TLS cipher, and certificate validation remained enabled (`rejectUnauthorized=true`).
- [ ] Before production: verify actual Aiven plan backup retention and complete a provider-managed restore drill; approve business RPO/RTO targets and final provider spend ceiling.

Evidence:
- Live verification (developer-provided output, 2026-10-10): `PASS: SELECT 1 succeeded and MySQL reports an active TLS cipher.` and `Certificate verification was enabled (rejectUnauthorized=true).`
- CI success for commit `1f5aa08189c4bde09ac0d2a32e142a0c577ae6e5`: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38030068615
- Lockfile/build workflow success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38030068593
- Verification command and backup/access policy: `docs/phase-01-database-infrastructure.md`, `docs/database-migrations.md`, `docs/database-backup-and-access.md`
- Public list-price comparison: `docs/provider-cost-review-2026-10.md`

**Sign-off rule:** Phase 01's specified completion gate has passed and the phase is recorded as complete. The provider-level restore drill, approval of business RPO/RTO targets, and final budget decision remain pre-production safeguards.

## Phase 02 — Product requirements and business rules

- [x] Comprehensive requirements baseline drafted in `docs/phase-02-business-rules.md`: domain boundaries; invoice/quotation lifecycle; independent state dimensions; transactional issue gate; numbering and financial-year policy; currency/discount/rounding; tax and statutory-document requirements; terms/payments/allocations/reversals; cancellation/corrections; roles/RBAC and separation of duties; PDFs/email/reminders; reports/exports; audit/security; acceptance criteria.
- [x] Explicit rule that POS, Digitech and Coworks are brand/business-line labels only until the business confirms mappings; no brand is assumed to be a legal entity or GST registration.
- [x] Proposed defaults are labelled as proposals; technical INR schema default is not treated as approved business policy.
- [x] Traceability matrix added in `docs/phase-02-feature-traceability.md`, with requirement IDs BR-001–BR-096, observable acceptance criteria, verification methods and owner/dependency.
- [x] Focused decision and approval packet added at `docs/phase-02-signoff-packet.md`; it collects 12 policy decisions, required evidence, approver roles and sign-off statements.
- [x] Public product evidence reviewed and kept separate from legal/tax evidence; official CBIC/GST references linked in the requirements document.
- [x] Unresolved business, finance, tax/legal and security decisions captured in the approval register with fail-safe behavior.
- [ ] **Formal completion gate:** authorized business owner approves requirements revision 1.0.
- [ ] Finance/accounting owner approves financial policies and tax-rule requirements within their remit; tax/legal review completed where required.
- [ ] After policy sign-off, approved actual entity mappings, numbering, currency, tax and approval configuration are provided before any production issuance.
- [ ] Runtime implementation and automated tests for these requirements are verified in Phases 03–06 and applicable later delivery work; documentation alone is not runtime evidence.

Evidence:
- Requirements: `docs/phase-02-business-rules.md`
- Feature traceability and acceptance criteria: `docs/phase-02-feature-traceability.md`
- Supporting schema/design baseline: `database/migrations/001_initial_schema.sql`, `database/migrations/002_identity_catalog_workflows.sql`, `docs/phase-03-schema-api-design.md`, `docs/phase-05-authentication-rbac.md`, `docs/phase-06-company-brand-legal-entity.md`

**Sign-off rule:** The requirements and traceability artifacts are complete as a reviewable baseline. Phase 02 is not formally signed off until an authorized business owner and the relevant finance/accounting approver record acceptance. No actual legal entity, tax registration/rate, approval threshold, bank detail or entity-to-brand mapping may be inferred.

## Phase 03 — System architecture and data modelling

**Design completion gate: COMPLETE.** Reviewed schema, ERD, migration/retention plan and API specifications are committed; the latest code revision's CI and lockfile workflows passed.

- [x] Core migration set documented and verified: 001 initial schema; 002 identity/catalog/workflows/configuration; 003 issue snapshots, adjustment numbering, payment reversal and typed approval references.
- [x] MySQL 8 schema reviewed for users, roles, permissions, legal entities, brands/mappings, customers, catalog, tax rules, invoices/lines/snapshots, quotations, payments/allocations/reversals, reminders, approvals, audit events, document/email metadata and schema_migrations.
- [x] Relationships/cardinalities, foreign keys, unique constraints, checks, query indexes, transactional-only invariants and delete/update rules reviewed.
- [x] Immutable issue-time snapshot, canonical hash/version metadata and decimal-safe financial representation specified.
- [x] Relationship diagram committed in `docs/phase-03-relationship-diagram.md`.
- [x] Migration ordering, production preflight, historical-data backfill, cutover, recovery/forward repair and retention plan committed in `docs/phase-03-migration-and-retention-plan.md`.
- [x] OpenAPI 3.1 contract covers current and planned API resources, request/response schemas, common errors, validation requirements, pagination, idempotency and explicit implementation status.
- [x] CI structural contract validation checks YAML syntax, local references, operation IDs, path parameters and implemented/planned labels.
- [x] Shared API response/error envelope includes request ID and no-store response headers; implemented customer/catalog routes use documented camelCase fields and normalized pagination.
- [x] CI contract tests exercise signed-session auth and customer/catalog create/list response shapes, pagination, request IDs, decimal-string price serialization and validation errors.
- [x] CI passed on commit `11171018c58657804b769709121da7f2f9c6d0a5`: all 3 migrations and idempotent rerun, role/permission seed idempotence, safe failure behavior, logical dump/restore, health success/failure, OpenAPI validation, implemented API contract tests, lint, TypeScript and production build.
- [x] Lockfile bootstrap/install/lint/typecheck/build workflow passed on the same revision.
- [x] **Phase 03 completion gate:** architecture, reviewed schema, relationship diagram, migration plan and API specifications committed and CI-validated.

Evidence:
- CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38033993752
- Lockfile workflow: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38033993771
- Main design/acceptance: `docs/phase-03-schema-api-design.md`
- ERD/schema review: `docs/phase-03-relationship-diagram.md`
- Migration/retention plan: `docs/phase-03-migration-and-retention-plan.md`
- API contract/validator: `docs/openapi.yaml`, `scripts/validate-openapi.mjs`
- Implemented master-data API contract test: `scripts/verify-master-data-api.mjs`

### Separate implementation and production prerequisites

- [ ] Inspect the actual Aiven schema/data before applying migration 003; backfill or explicitly disposition historical issued invoices without issue snapshots and legacy approvals without typed targets through a reviewed, audited process.
- [ ] Enforce and verify that the production runtime database role cannot UPDATE/DELETE rows in `invoice_issue_snapshots`.
- [ ] Implement and integration-test planned invoice, quotation, payment/allocation/reversal, approval, legal-entity/brand/tax, document, email, reminder, reporting/export and audit endpoints before describing them as live.
- [ ] Extend API/security tests to cover these future routes, entity-scoped authorization, concurrency/idempotency, snapshot integrity and aggregate payment limits as the routes are implemented.
- [ ] Obtain Phase 02 business/finance/tax approval and populate actual legal-entity, tax, numbering, currency and approval configuration before enabling issuance.

These are explicit runtime/production gates, not missing design deliverables. Phase 03's stated design completion gate is complete; this sign-off does not claim migration 003 has been applied to Aiven, legacy rows/grants have been reconciled, or planned endpoints are implemented.

## Phase 04 — Design system and application shell
- [x] PR #4 established the approved palette and SVG invoice-layout reference designs; PR #6 proposes exact supplied WebPs for Falchion Xeniaa, MyFX POS, FX Digitech and Coworks with corrected logo sizing/styles.
- [ ] Visual acceptance still requires a manual desktop/tablet/mobile browser review after this branch is deployed locally; font network delivery and the final logo contrast/size require that review.

**Foundation completion gate: COMPLETE.** Shared visual language, responsive application shell, reusable UI states and code-level accessibility/responsiveness checks are committed and CI-validated.

- [x] Central design tokens for light/dark surfaces, typography, spacing, borders, shadows, focus and semantic status colors.
- [x] Shared Geist typography and typed SVG icon set.
- [x] Responsive shell with primary navigation, active route indication, context top bar, environment label, breadcrumbs and content page layouts.
- [x] Working light/dark toggle with preference persistence and fallback if browser storage is unavailable.
- [x] Mobile navigation drawer, scrim, Escape-to-close, keyboard focus handling, background-scroll lock and resize-to-desktop behavior.
- [x] Reusable controls and feedback: Button/IconButton, Card, status badge, labelled text/select/textarea inputs, field errors, alerts, toast, loading, empty and error states.
- [x] Accessible confirmation dialog with initial focus, Escape handling, focus trap/return and busy state.
- [x] Semantic DataTable with horizontal overflow treatment and integrated loading/empty/error states; reusable bounded pagination controls.
- [x] Root route loading/error/not-found experiences and skip-to-main-content accessibility link.
- [x] Overview and module foundation pages contain no fabricated finance totals or fake activity; planned APIs are not presented as active.
- [x] UI foundation validator added to CI for theme tokens, semantic navigation, keyboard support, focus visibility, responsive breakpoints, reduced-motion support, reusable form/table/feedback primitives and route-level states.
- [x] CI + lockfile workflows passed on the recorded UI revision: OpenAPI and existing database/API integration checks, UI foundation validation, lint, TypeScript and production build.

Evidence:
- CI success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38050370293
- Lockfile/build success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38050370244
- Design-system specification: `docs/phase-04-ui-design-system.md`
- Tokens/responsive styles: `src/app/globals.css`
- Application shell: `src/components/app-shell.tsx`
- Reusable controls/feedback/data primitives: `src/components/ui.tsx`
- Icon set: `src/components/icon.tsx`
- Code-level foundation validator: `scripts/validate-ui-foundation.mjs`

### Separate data/workflow release gates

- [x] Customer/catalog list, create, detail, version-checked update, reference-aware soft-archive, customer linked-document views, CSV safeguards and validation tests are implemented on `main`; CI and lockfile/bootstrap passed at `2d8d680f8bff827c70cc73ac302c7ba48d9f8369` ([CI](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/39001874484), [bootstrap](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/39001874467)). Manual responsive/accessibility review and applying Phase 7 migrations to local Aiven remain open.
- [ ] Implement and test invoice, quotation, payment/allocation/reversal, approval, document, email, reminder, reporting/export and full audit workflows before showing those actions as available.
- [ ] Connect authenticated user identity, notifications, global search and permission-aware action visibility when those capabilities are implemented.
- [ ] Perform a manual visual smoke review on desktop, tablet and narrow mobile browser widths before production release. This review has not been performed in this pass.

The Phase 04 **UI foundation** is complete; these separate workflow and release-QA gates do not change the foundation sign-off.
## Phase 05 — Authentication and access control

**Acceptance gate: COMPLETE for authentication, RBAC and all currently implemented protected surfaces.** The latest full CI and lockfile workflows both passed on code revision `36af6321f4584726acc7226775c4d6343bd7aac1`.

- [x] Migration 004 adds password hashes, revocable database sessions, single-use invitations, rate-limit buckets and security-event records.
- [x] Scrypt password hashing/verification and a 12–128 character password policy; raw passwords are never persisted.
- [x] Opaque session secret generated on successful login; only its hash is stored in MySQL. The session cookie is HttpOnly, SameSite=Lax and Secure in production; the raw session token is not returned in JSON or stored in web storage.
- [x] Eight-hour absolute and 30-minute idle expiry; session validation checks revocation, expiry, account status and live role/permission/entity-scope assignments.
- [x] Login, logout, current-user endpoint, invitation activation and self-service revoke-all implemented; logout/privilege changes revoke server-side sessions.
- [x] Cookie-authenticated mutations verify same-origin/Referer, Fetch Metadata and double-submit CSRF token; tests reject missing/wrong CSRF tokens and cross-origin unsafe requests.
- [x] Server-side workspace route layout validates the session and redirects anonymous/revoked users before protected workspace content renders. The proxy is only an early navigation filter; database-backed layout and API checks remain authoritative.
- [x] Role and permission enforcement on existing protected routes; distinct system administrator, finance administrator, invoice creator, invoice issuer, payment recorder, approver and auditor/read-only role templates.
- [x] User invitations, activation, user directory and status/role/scope changes require authorization; privilege changes revoke sessions, self-administration is denied, system-admin assignment is restricted and last-active-admin demotion/suspension is prevented.
- [x] One-time first-admin bootstrap requires explicit confirmation and private environment values; it creates no committed/default credentials.
- [x] Rate limits on normalized email, invitation tokens and invitation creation; IP throttling is used only with explicitly trusted proxy headers. Rate-limit buckets use keyed digests.
- [x] Authentication security events store fixed event types/outcomes with keyed HMAC hashes for subject/source IP/user-agent; raw credentials, session/CSRF/invitation tokens and raw provider errors are not logged.
- [x] CI negative tests verify unauthenticated API denial, anonymous page redirects, forged client-claim denial, missing/wrong/cross-origin CSRF rejection, read-only role denial, user-admin denial, finance-to-admin escalation denial, suspended-account denial, single-use invitation behavior, self-admin change denial, session revocation after role/status/entity-scope change, logout/revoke-all, absolute/idle expiry and 429 rate-limit behavior.
- [x] Client navigation shows a session-verification state rather than workspace children while `/api/v1/auth/me` is pending, and redirects to sign-in when the session check fails.
- [x] Existing protected master-data contract tests continue to cover actual login, customer/catalog create/list, response/request IDs, pagination, input validation and exact-decimal serialization.
- [x] Latest full CI passed MySQL 8 migrations 001–004, migration/seed idempotency, logical restore, health success/failure, OpenAPI validation, negative auth/API suite, UI foundation checks, lint, TypeScript and production build.
- [x] **Phase 05 completion gate: PASSED** for the implemented authentication/RBAC foundation and current protected routes.

Evidence:
- CI success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38072384541
- Lockfile/bootstrap success: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38072384583
- Requirements and setup: `docs/phase-05-authentication-rbac.md`
- Auth utilities: `src/lib/auth/session.ts`, `authorize.ts`, `csrf.ts`, `password.ts`, `rate-limit.ts`, `security-events.ts`
- Navigation guard and server validation: `src/proxy.ts`, `src/app/(workspace)/layout.tsx`
- Auth/admin routes: `src/app/api/v1/auth/**`, `src/app/api/v1/users/**`
- Negative test suite: `scripts/verify-master-data-api.mjs`, invoked by `npm run auth:security-test`
- First-admin bootstrap: `scripts/bootstrap-admin.ts`

### Separate production activation and future-feature gates

- [x] Developer-provided evidence confirms migrations 001–010 and the reference role-template seed were applied and safely rerun against the intended development Aiven database; verified TLS/query and both health endpoints passed.
- [ ] Before production, complete a provider-managed Aiven restore drill into an isolated target, review the production schema/data and least-privilege runtime grants, then apply/verify any approved pending production migration. CI against disposable MySQL is not an Aiven managed-backup restore drill.
- [ ] Set a high-entropy `SESSION_SECRET` and the exact public HTTPS `APP_ORIGIN` in the server environment before enabling production sign-in.
- [ ] Keep `TRUST_PROXY_HEADERS` unset unless the deployment ingress strips inbound forwarded headers, writes trusted values and blocks direct application access. IP rate-limiting and source-IP logging require this explicit setup.
- [ ] Run `npm run auth:bootstrap-admin` once against the selected target with private environment variables; assign no unapproved users or legal-entity scopes.
- [ ] Implement and add scoped negative authorization tests for future invoice, quotation, payment, approval, PDF/document, email, reminder, reporting/export and audit-search handlers before exposing them.
- [ ] Add SSO/MFA/password recovery/automated invitation delivery only if company policy requires them; they are not represented as implemented.

The gate is complete for the implemented local-password/session/RBAC foundation and currently exposed protected surfaces. Production activation and planned finance APIs remain explicitly separate.
## Phase 05B — Authorization matrix hardening

- [x] Exact CI assertion for the 22 permission keys and all seven baseline role-to-permission mappings; catches missing, excess, or reassigned grants.
- [x] API contract tests check each authenticated role's effective permission profile.
- [x] Role-by-role allow/deny checks across every implemented customer, catalog and user-directory route, including proof that `system_admin` is not an implicit finance-data superuser.
- [x] Anonymous denial checked for customer, catalog and user-directory reads; existing CSRF and account/privilege lifecycle negative tests retained.
- [x] Scope and future-endpoint boundaries documented; no claim that planned invoice, payment, document/download or export routes are already protected.
- [x] **Acceptance gate:** full CI, authorization/API contract tests, OpenAPI validation, lint, TypeScript and production build passed for commit `be0d8fdee22bc8a2076a33a3761db0222baa64ec`.
- [x] Lockfile/bootstrap workflow passed on the same commit.

Evidence:
- Full CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38354956754
- Lockfile/bootstrap: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38354956749
- Regression suite: `scripts/verify-master-data-api.mjs`, invoked by `npm run auth:security-test`.
- Detailed scope and route matrix: `docs/phase-05b-authorization.md`.

## Phase 06A — Company, Legal Entity & Brand Configuration
- [x] PR #4 integrated SVG logo/reference layout artwork; PR #6 proposes exact supplied corporate/MyFX/Digitech/Coworks WebP logos. Invoice reference layouts remain reconstructed/not active, and no brand-to-legal-entity mapping is assumed.
- [ ] Actual business-approved legal entity values, brand mapping, fonts/hosting choice, active templates and private logo storage remain operator/business sign-offs; sample references are not live PDFs.

- [x] Separate legal entities, commercial brands, and business units in the data model; brand/entity mappings are explicit.
- [x] Add registered and separate billing addresses plus company identity, invoice contacts, locale, currency, timezone, logo reference, terms, and footer fields.
- [x] Add scoped entity/brand/business-unit list and detail APIs, create/update, and activation state handling.
- [x] Validate request payloads, required fields, timezones, addresses, duplicate mappings, and relationship compatibility server-side.
- [x] Restrict bank detail writes to finance configuration approvers; normal responses expose only configured status and the last four account digits.
- [x] Record change reason and safe before/after state in audit events; append version snapshots on configuration edits.
- [x] Preserve old brand/business-unit mappings as effective-dated history instead of deleting them.
- [x] Add CI acceptance coverage for bank masking, finance-only bank changes, version/audit history, mapping-history retention and legal-entity scope isolation.
- [x] PR #6 merged directly to `main`; the unique audit-branch history was then integrated through merge commit `b8297972f31ab18d87632dfa718c4ef49c70d35e` after porting the compatible brand picker, palette validation and overview mark while preserving supplied WebP assets. CI and lockfile/bootstrap passed on that revision: [CI](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38893456152), [bootstrap](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38893456184). Manual browser sign-off remains outstanding.
- [ ] Business owner confirms actual legal identities, bank values, and brand/entity relationships; production setup must not use CI/sample fixtures.

## Phase 06B — Tax, Invoice Numbering & Document Configuration

- [x] Effective-dated approved tax registrations and tax rules are validated against the document date; duplicate overlapping active tax codes, numbering series and templates are rejected.
- [x] Number reservation uses a parent-entity lock and an independent entity/document-type/financial-year counter inside the caller transaction.
- [x] Invoice/credit-note/debit-note issue endpoint checks permission and legal-entity scope, validates draft/customer/line tax references, selects approved effective numbering and templates, and records issuance, audit and snapshot in one transaction.
- [x] Canonical configuration snapshot includes legal-entity/brand version references, approved tax registration/rules, numbering series/allocation and the selected brand-specific or entity-wide template.
- [x] Database triggers reject snapshot updates and deletes; same-key issue retries return the original result, while conflicting keys are rejected.
- [x] MySQL integration tests cover twelve concurrent allocations, financial-year boundaries, tax/registration effective periods, brand-specific template preference, snapshot hash and preservation after configuration edits.
- [x] API contract tests confirm unconfigured tax setup blocks issue and out-of-scope invoices are concealed.
- [x] End-to-end API tests issue synthetic invoice and debit-note documents, verify their snapshot IDs/hashes and selected tax/template/numbering references, checks same-key replay and rejects a conflicting key.
- [x] Full CI acceptance passed on `f0b56ce5416ff89eb053b34615339d65a0ff47b0`, including the ten-migration MySQL run, logical dump/restore, security/API contracts, Phase 6B integration suite, OpenAPI, UI validation, lint, TypeScript and production build.
- [x] Lockfile/bootstrap workflow passed for the same commit.
- [x] Follow-up Phase 6A/6B regression coverage passed on `main` at commit `192afc13f4948c4c963f9f958da10eee183e196e`: tax-registration effective-period revisions, jurisdiction-scoped primary registration, brand/business-unit/legal-entity activation dependencies, jurisdiction-matched tax/default-code readiness, unsupported-currency issuance denial, timezone-aware readiness defaults, and safe template preview. Full CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38851520923. Lockfile/bootstrap: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38851520745.
- [ ] Finance/tax owners approve actual registration details, rates, numbering policy, templates and legal-entity/brand relationships before production issuance.

Evidence:
- Full CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38542228014
- Lockfile/bootstrap: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38542227977
- Migration 009: `database/migrations/009_phase_6b_invoice_tax_bindings.sql`.
- Migration 010: `database/migrations/010_phase_6b_snapshot_trigger_restore.sql`.
- Issue endpoint: `src/app/api/v1/invoices/[invoiceId]/issue/route.ts`.
- Configuration services: `src/lib/configuration/service.ts`.
- MySQL integration: `scripts/verify-phase-6b-configuration.ts`.
- Security/API regression suite: `scripts/verify-master-data-api.mjs`.
- OpenAPI contract: `docs/openapi.yaml`.

**Production boundary:** all technical CI acceptance checks listed above passed on disposable MySQL. Live database migration, finance/tax approvals, and production rollout remain controlled deployment steps.

## Evidence notes

- The GitHub Actions workflows prove dependency installation, lint, TypeScript, secret scanning and production build for the specific successful revision; they do not prove database connectivity or that migrations were applied.
- The database migrations and seed script have been applied and tested against disposable MySQL 8 in CI; the live Aiven TLS verification gate has since passed. Provider-level backup/restore verification remains outstanding.
- Local Mac status cannot be observed by GitHub Actions or this remote repository audit. Verify with `git status -sb`, `git rev-parse HEAD`, and `git rev-parse origin/main`.

**Sign-off rule:** Phase 00's repository foundation is signed off based on the developer-confirmed clean/synchronized worktree and passing CI/lockfile workflows. This tracker/acceptance update triggers another CI run. Phase 01 remains in progress until its database integration and recovery tests have evidence.


## Phase 08 — Invoice Engine & Financial Calculations

**Implementation status:** Core invoice draft engine, API, workspace, and calculation regression suite are implemented directly on `main`. The clean implementation revision `25f40dbedb3400505a9132e48878ecedf7f13721` passed CI and lockfile/bootstrap:
- CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/39005607553
- Lockfile/bootstrap: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/39005607523

### Acceptance evidence

- [x] Exact-decimal, fixed-point calculation engine uses `BigInt` and four-decimal monetary units; calculation policy is documented in `docs/phase-08-invoice-engine.md`.
- [x] ROUND_HALF_UP rounding is explicit for line extensions, discounts and tax. Tests include half-way cases at the fourth decimal place.
- [x] Exclusive and inclusive pricing are resolved from approved, effective-dated tax rules. Clients submit tax codes, not authoritative rates or calculation modes.
- [x] Fixed and percentage discounts, item/service lines and additional charge lines feed server-calculated subtotal, discount total, taxable value, tax total and grand total.
- [x] Draft invoice create/list/detail/update APIs validate entity scope, currency, dates, due dates, active customer/catalog references, line bounds and optimistic record versions.
- [x] Duplicate create submissions use an idempotency key and a payload fingerprint; identical replay returns the original draft while reusing the key for a different payload is rejected.
- [x] Outstanding balance is calculated using exact decimal subtraction from recorded payment allocations.
- [x] Issuance recalculates line and header totals using persisted line inputs and current approved rule configuration before preserving the issue-time configuration snapshot. Existing issued documents remain immutable through the draft API.
- [x] MySQL 8 integration tests verify tax-inclusive/exclusive calculation, additional charges, date validation, duplicate submissions, stale updates, issue-time recalculation, payment balance and API total parity.
- [x] Calculation unit tests cover half-up precision, discount bounds, tax rate bounds, invalid quantity, dates and outstanding balance.
- [x] OpenAPI, secret scan, MySQL migrations/seeding/restore, authorization/API tests, Phase 6B snapshot tests, UI foundation checks, lint, TypeScript and production build passed in the linked CI run.
- [ ] Manual browser acceptance at desktop and mobile widths, including keyboard operation and finance-user acceptance, still needs an operator review.
- [ ] Apply migrations 013–015 to the configured Aiven development/testing database and verify there. This pass verified all 15 migrations against the disposable MySQL 8 CI service; it did not apply them to the live Aiven instance.
- [ ] Finance/tax owners must approve the actual tax-rule assignments and production issuance configuration. Currency conversion remains disabled until an FX policy is approved.

Evidence/code:
- Calculation engine: `src/lib/finance/invoice-calculation.ts`
- Draft validation and persistence: `src/lib/finance/invoice-draft-service.ts`, `src/lib/validation/invoice.ts`
- API: `src/app/api/v1/invoices/route.ts`, `src/app/api/v1/invoices/[invoiceId]/route.ts`, `src/app/api/v1/invoices/[invoiceId]/issue/route.ts`
- Draft options: `src/app/api/v1/invoices/draft-options/route.ts`
- UI: `src/components/invoice-workspace.tsx`
- Calculation regression suite: `scripts/verify-invoice-calculations.ts`
- MySQL/API regression suite: `scripts/verify-master-data-api.mjs`
- Schema changes: migrations 013–015
- API contract: `docs/openapi.yaml`
