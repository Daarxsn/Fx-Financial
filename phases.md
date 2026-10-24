# Phases and Delivery Gates — Fx Financial

This is the high-level execution map. The detailed `docs/phase-*`, Pack runbooks, evidence ledgers and actual CI results remain authoritative for each slice. Update this file when a phase's scope or evidence changes; never mark a phase complete from code presence alone.

## Phase 00 — Foundation and engineering controls
**Intent:** deterministic install/build, repository standards, CI, secret scanning, environment conventions and repeatable developer workflow.  
**Evidence:** lockfile, CI, lint/typecheck/build, security/contribution docs.  
**Status:** foundation established; keep checks active for every change.

## Phase 01 — Database and infrastructure
**Intent:** MySQL connectivity, verified TLS, health endpoints, forward-only checksummed migrations, safe reference seed and restore mechanics.  
**Evidence:** disposable MySQL migration/seed/restore tests plus separately recorded live non-production TLS checks.  
**Open production gates:** provider backup retention and restore drill, approved RPO/RTO, runtime grants and spend ceiling.

## Phase 02 — Business rules and approvals
**Intent:** document lifecycle, numbering, tax, currency, rounding, payment/correction policy, permissions and issuer rules.  
**Evidence:** explicit business/finance/tax decisions, approver identity/date and versioned sign-off.  
**Gate:** unknown or unapproved legal/financial configuration must block issuance.

## Phase 03 — Authentication and authorization
**Intent:** secure login/session handling, CSRF/origin protections, RBAC and scoped protected APIs.  
**Evidence:** positive and negative endpoint tests, safe error behavior and audit records.  
**Gate:** prove denied as well as allowed operations, including cross-entity attempts.

## Phase 04 — Core experience and responsive UI
**Intent:** consistent application shell, settings, brand selection and responsive workflows with accessible states.  
**Evidence:** automated browser tests plus manual desktop/tablet/mobile and light/dark/accessibility review.  
**Gate:** code-level UI checks do not replace human visual acceptance.

## Phase 05 — Financial documents and PDFs
**Intent:** quotation/invoice/receipt lifecycle, immutable snapshots, branded PDFKit rendering, private storage, checksum and authorized document history/download.  
**Evidence:** lifecycle and PDF/storage regression tests, manual PDF screen/print inspection and private-bucket policy/retention/backup evidence.  
**Gate:** reference mockups are not production template approval.

## Phase 06 — Configuration, email and reminders
**Intent:** effective-dated company/brand/legal-entity/tax/numbering/template configuration, durable outbox, signed delivery webhooks, retry-safe email and finance-approved reminder policies/worker.  
**Evidence:** API/integration contracts, approval records, real verified sender/domain, provider credentials, webhook verification and scheduler invocation evidence.  
**Gate:** no real reminders until finance approval is recorded; queued mail is not delivery.

## Phase 07 — Customer and item/service catalogue
**Intent:** reusable customer/catalogue records, secure CRUD/search, safe CSV import/export and draft integration.  
**Known implementation scope:** migration-backed master data, validation, duplicate/malformed/oversized CSV rejection, formula-safe export/import, responsive browser workflows and exact catalogue price text.  
**Status:** in progress on `main`; the Phase 07 document reports that migrations 011–012 and the workflows still require independent verification against the configured Aiven development/testing database and manual browser/accessibility acceptance. Re-check that document and current CI before changing status.  
**Gate:** archived master data must remain available for historical documents; edits never rewrite issued snapshots.

## Pack 7 — API/security hardening
**Intent:** security and contract regression coverage for the next implementation slice.  
**Gate:** inspect `npm run pack7:validate` and `npm run pack7:api-test` on the exact SHA; don't infer completion from this index.

## Pack 8 — Query and security hardening
**Intent:** infrastructure/query-plan and security checks, dependency audit and bounded query behavior.  
**Gate:** run relevant Pack 8 validators and inspect failures; no broad unbounded exports/search.

## Pack 9 — Deployment and operations
**Intent:** safe environment preflight, readiness ledger, deployment smoke tests, provider integrations, backup/recovery and operational handover.  
**Gate:** actual Vercel/hosting, MySQL, private storage, verified email sender/webhooks, cron/scheduler, monitoring and provider restore evidence. Synthetic tests are not provider evidence.

## Pack 10 — Business UAT and controlled release
**Intent:** isolated synthetic UAT, role/entity-scope matrix, three-brand issuer checks, lifecycle/payment/PDF/email/report scenarios, evidence packet and fail-closed release decision.  
**Gate:** exact candidate SHA, required scenarios and owner sign-offs must be recorded; a skipped, blocked or failed test is not a pass. Pack 10 does not override open Pack 9 gates.

## Every slice: definition of done

- Requirement and acceptance criteria are clear.
- Implementation follows `architecture.md` and `rules.md`.
- Relevant positive, negative, failure and retry tests are added.
- Lint, typecheck, relevant tests and production build/CI results are recorded.
- Security, financial integrity and entity scope are reviewed.
- Docs/phase ledger are updated with evidence and unresolved questions.
- Diff is reviewed and committed directly to `main`.
- External/business/production gates remain open until actual evidence exists.
