# Product Requirements Document — Fx Financial

**Product:** Falchion Xeniaa Invoice Management System  
**Repository:** `Daarxsn/Fx-Financial`  
**Source of truth:** implementation on `main`, existing `docs/` specifications, migrations, tests and this file.  
**Status:** Living requirements baseline. Update it when an approved product decision changes.

## 1. Product purpose

Provide Falchion Xeniaa with a secure, multi-brand invoice generator that makes four everyday tasks obvious and reliable: create an invoice, preview it, send it, and manage its status/history. Keep financial correctness, legal-entity boundaries, access control and auditability, but do not let advanced financial-document features obscure this core journey. Never fabricate business, tax, issuer or email-provider data.

## 2. Users and permissions

- **Super Administrator:** manages authorized users, configuration and access controls.
- **Finance / Operator:** works with customers, catalogue, quotations, invoices, payments, receipts, documents, reminders and reports only within granted permissions and entity scope.
- **Read-only / limited user:** sees only explicitly permitted resources and actions.

A role name alone is not authorization. Server-side permission checks and legal-entity scope are required for every protected read and mutation. Approval-sensitive actions must preserve separation of duties where configured.

## 3. Brand and legal entity model

The shipped product brands are **MyFX POS**, **FX Digitech**, and **FX Coworks**. A brand is a commercial identity, not automatically a legal entity. The actual issuer must be resolved through an explicit, approved brand-to-legal-entity mapping. Do not infer the issuer, currency, tax registration, numbering policy, bank details, terms or statutory disclosures from a logo, sample invoice or brand name.

## 4. Core capabilities — Stage 1 MVP

1. **Create:** an authorized user can find the invoice workspace, start a new invoice from a visible action, select one of the three configured product brands, choose or create a customer where permitted, add line items, save and reopen a draft.
2. **Preview:** the user can preview the saved invoice before issue/send. The preview must clearly distinguish a draft screen preview from the final issued PDF; it must never imply that missing supplier/tax/numbering approvals are complete.
3. **Issue:** issuance validates approved issuer, numbering, tax and document policy; server-side decimal-safe totals are authoritative and the issued snapshot is immutable.
4. **Send:** after issuance, the user can queue an email with the correct verified PDF attachment to an explicitly confirmed recipient. The interface distinguishes queued, provider-accepted, sent and delivered states and shows actionable errors.
5. **Manage:** searchable invoice list and detail view; draft edit, preview, PDF history/download, email delivery history, outstanding/paid state and safe manual payment recording.
6. **Customer/item reuse:** keep the minimal customer and item data required to make invoice creation fast. Advanced import/export or catalog operations are not prerequisites for the core invoice journey.
7. **Access and audit:** authenticated, permission-checked and legal-entity-scoped reads/mutations; CSRF/origin protection; audit evidence for sensitive lifecycle actions.
8. **Operational foundation:** migrations, tests, error handling, readiness checks and evidence-based deployment gates needed to run the above reliably.

### Stage 1 exit criteria

- A visible workspace route and create-invoice action exist and are reachable for the intended role.
- An authorized user can create, save, reopen, edit and preview a draft without being forced into a hidden or inaccessible state.
- The issued PDF matches the saved, approved invoice snapshot; download is permission-checked and integrity-verified.
- Issue-and-send has tested success and failure paths, idempotency and visible delivery status. Live delivery is separately verified against the real configured provider.
- A user can find an invoice and understand its current lifecycle, payment and delivery state.
- Relevant automated tests pass for the exact candidate commit; manual visual/accessibility and live-provider gates are separately recorded.

### Deferred until Stage 1 is stable

Quotation workflows, reminder-policy automation, broad reporting/dashboard work, bulk import/export, advanced document families, payment gateways and accounting/ERP expansion are not allowed to block the core invoice path. Existing working code may remain in the repository, but Stage 1 navigation and implementation effort must prioritize the four core tasks.

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
