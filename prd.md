# Product Requirements Document — Fx Financial

**Product:** Falchion Xeniaa Invoice Management System  
**Repository:** `Daarxsn/Fx-Financial`  
**Source of truth:** implementation on `main`, existing `docs/` specifications, migrations, tests and this file.  
**Status:** Living requirements baseline. Update it when an approved product decision changes.

## 1. Product purpose

Provide Falchion Xeniaa with a secure, multi-brand invoice and financial-document workspace. The product must make everyday billing straightforward while preserving financial correctness, legal-entity boundaries, evidence, auditability and operational safety. It is not merely CRUD for invoices and must not fabricate business, tax or issuer data to make a workflow appear complete.

## 2. Users and permissions

- **Super Administrator:** manages authorized users, configuration and access controls.
- **Finance / Operator:** works with customers, catalogue, quotations, invoices, payments, receipts, documents, reminders and reports only within granted permissions and entity scope.
- **Read-only / limited user:** sees only explicitly permitted resources and actions.

A role name alone is not authorization. Server-side permission checks and legal-entity scope are required for every protected read and mutation. Approval-sensitive actions must preserve separation of duties where configured.

## 3. Brand and legal entity model

The shipped product brands are **MyFX POS**, **FX Digitech**, and **FX Coworks**. A brand is a commercial identity, not automatically a legal entity. The actual issuer must be resolved through an explicit, approved brand-to-legal-entity mapping. Do not infer the issuer, currency, tax registration, numbering policy, bank details, terms or statutory disclosures from a logo, sample invoice or brand name.

## 4. Core capabilities

1. Authenticated access with secure local-password sessions, CSRF/origin protections and role/permission controls.
2. Company, brand, legal-entity, currency, tax, numbering and template configuration with effective dates, validation and auditable changes.
3. Customer master data and reusable item/service catalogue, with safe search, archive semantics, import/export validation and permission checks.
4. Quotations with controlled lifecycle and safe conversion to an editable invoice draft.
5. Invoices with draft editing, server-side validation, controlled numbering, issue-time financial snapshots, lifecycle history and audited correction/cancellation paths.
6. Exact-decimal calculations for quantities, prices, discounts, taxes and totals; server-calculated values are authoritative.
7. Manual payment recording and allocation, partial/full payment status, receipts and reasoned/audited reversals. **No payment gateway is in the first-release scope.**
8. Branded PDF generation from approved configuration and immutable document snapshots; private object storage, integrity checks, authorized download and history.
9. Durable email outbox with idempotency, bounded retry, delivery events and clear distinction between queued, provider-accepted and delivered states.
10. Finance-approved, versioned overdue reminder policies and authenticated scheduled processing.
11. Overview dashboards, reconciled reports, controlled CSV exports and searchable audit history.
12. Repeatable migrations, readiness checks, deployment smoke tests, backup/recovery procedures and evidence-based UAT/release gates.

## 5. Non-functional requirements

- **Security:** validate input on the server; parameterize SQL; protect secrets; use least privilege; suppress sensitive diagnostics; maintain TLS certificate verification.
- **Integrity:** transactions for atomic financial mutations; idempotency for retryable side effects; immutable issued snapshots; append-only evidence where required.
- **Availability and recovery:** bounded database connections, safe health responses, documented backup and tested restoration. Set final RPO/RTO only after owner approval.
- **Usability:** responsive desktop/tablet/mobile workflows; accessible forms, focus states, contrast, loading/empty/error states and clear financial status.
- **Maintainability:** TypeScript, documented API contracts, forward-only migrations, focused tests, deterministic lockfile-based installs and CI.
- **Privacy:** use synthetic test data; do not leak customer details, tax identifiers, financial content, session tokens or secrets into logs or exports.

## 6. Product and design constraints

- Keep the existing stack: Next.js App Router, React, TypeScript, MySQL through `mysql2`, PDFKit and S3-compatible private document storage; Vercel remains the planned web host.
- **Do not introduce Vite or rewrite the application architecture** without an explicit decision.
- Preserve the supplied brand assets and palette: Gold `#DCAF51`, Saffron Red `#931314`, Charcoal `#111111`, Platinum `#F4F4F5`, White `#FFFFFF`.
- Template preview/reference artwork is not proof of production PDF correctness.
- Keep the product's simple brand-first invoice workflow while retaining strict issuer-readiness checks.

## 7. Release acceptance

A feature is not complete merely because a route, screen, migration or test file exists. Require persistence, server-side validation, permission and entity-scope enforcement, correct failure behavior, appropriate automated coverage, CI for the exact candidate SHA and documented acceptance evidence. Business/finance/tax approval, real provider configuration, backup restoration, PDF visual review, live email/webhook/worker checks and manual accessibility/device acceptance are separate gates.

## 8. Explicit exclusions and boundaries

- No payment gateway in the initial release.
- No invented company identity, GST/tax values, rates, statutory rules, bank details, invoice numbering policy or approval evidence.
- No hard-delete or silent rewriting of records referenced by issued financial documents.
- No production release based solely on a green build or synthetic CI.
- No unapproved broadening into accounting/ERP features without a product decision.

## 9. Decision log

Record each meaningful decision with date, decision, rationale, approver and affected docs/tests. When evidence is incomplete, mark the item **unknown**, **pending**, or **blocked** rather than turning assumptions into requirements.
