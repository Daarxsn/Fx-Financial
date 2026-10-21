# Phase 10 — Quotation Lifecycle and Invoice-Draft Conversion

**Current engineering status (2026-10-21): accepted and locked as part of Pack 2's engineering gate.** The functional baseline is f9c2a307549b6e1873b64c1020ec09dd68ad8deb with full successful CI at [39567709020](https://github.com/Daarxsn/Fx-Financial/actions/runs/39567709020). Pack 2's final lock-record/quality-cleanup commit must also retain green CI.

## Scope and invariant

Quotations are a separate commercial-document lifecycle. A quotation is not an invoice, and converting it must create an editable invoice draft only. It must never allocate an invoice number or capture invoice issue snapshots as a side effect of conversion. An accepted quote may convert exactly once.

The implementation lives in:
- GET/POST /api/v1/quotations — bounded, scoped list/search and idempotent draft creation.
- GET/PATCH /api/v1/quotations/{quotationId} — detail, draft editing, server recalculation and optimistic concurrency.
- POST /api/v1/quotations/{quotationId}/status — version-checked status transition, reason and audit handling.
- POST /api/v1/quotations/{quotationId}/convert — atomic, idempotent conversion to an invoice draft.
- GET /api/v1/quotations/draft-options — scoped entities, customers, catalog and approved tax options.
- The quotations workspace at /quotations — draft editor, status/decision actions and conversion experience.

## State-transition policy

| Current state | Allowed target | Guard |
|---|---|---|
| DRAFT | SENT | Active legal entity/customer, at least one line, approved effective configuration, valid entity timezone, expected record version |
| DRAFT | CANCELLED | Expected record version and a reason |
| SENT | ACCEPTED | Expected record version; quotation must not be expired |
| SENT | REJECTED | Expected record version, reason, and quotation must not be expired |
| SENT | CANCELLED | Expected record version, reason, and quotation must not be expired |
| SENT | EXPIRED | Expected record version and validity date has passed in the entity timezone |
| ACCEPTED | CONVERTED | Conversion validates current configuration and commits one linked draft transactionally |
| REJECTED / CANCELLED / EXPIRED / CONVERTED | — | Terminal state; transitions that would rewrite the decision are rejected |

The server remains authoritative. UI hiding is not authorization: routes require quotations:read/quotations:write and assigned legal-entity scope. Status updates use expectedVersion and a conditional update inside the transaction. Invalid timezone configuration fails closed rather than treating the quote as valid or expired by machine-local assumptions.

## Snapshot and numbering boundary

When SENT, the route allocates the approved quotation number and stores the approved configuration snapshot/hash plus supplier and customer identity snapshots, including the customer's name/contact/billing identity at send time. This historical display does not change when customer master data changes later.

The selected number series and template are the configured values of the legal entity, not guessed from commercial brand names. Drafts do not consume official quotation numbers. PDF rendering and actual outbound email are not implemented by the SENT transition; the workspace states this explicitly.

## Conversion contract

1. Lock the source quotation and confirm it is ACCEPTED and within the caller's entity scope.
2. Validate the idempotency key and reject conflicting reuse.
3. Derive the invoice date using the legal entity's configured timezone. Invalid or missing timezone context fails closed.
4. Revalidate active customer/entity, currency, approved effective tax configuration and line inputs through the shared invoice draft service.
5. Recalculate line and document totals using the exact-decimal invoice calculation engine.
6. Create one DRAFT invoice with a source quotation reference/audit event and atomically update the quotation to CONVERTED with the linked invoice ID.
7. Commit both source and draft updates together. A repeated same-key call returns the linked conversion result; different-key or racing attempts cannot create a second draft.

## Verification evidence

The MySQL-backed API integration suite verifies:
- Draft creation and same-key replay; different payload with the same key conflicts.
- List/detail calculation parity, high-value DECIMAL(19,4) taxable-value precision, draft update and stale record-version rejection.
- Real SENT → ACCEPTED → CONVERTED transitions using the status endpoint rather than direct status mutation.
- Frozen customer/issuer snapshots, approved quotation number series/template snapshot and no historical display rewrite following customer rename.
- Expiry in legal-entity timezone and refusal to accept expired quotes.
- Concurrent conversion retry invariant: one linked invoice draft, same-key replay and different-key conflict.
- Invalid timezone fails closed without issuing or creating the conversion draft.

The Playwright browser gate creates a quotation using the real workspace, records SENT and ACCEPTED through the UI confirmation flow, then converts it and checks the database for a CONVERTED source linked to exactly one invoice in DRAFT state. The same CI run covers invoice UI create/edit/issue and number/snapshot persistence.

## Not a production go-live declaration

Pack 2 is locked for engineering progression. Business/finance/tax owners must still approve production entity values, tax assignments, numbering and correction policy. Aiven migration verification and a provider-level backup restore drill, production secret/origin/database-grant review, real-device keyboard/screen-reader/contrast review, PDF/private storage and outbound email are separate gates. Pack 3 may build on this lifecycle baseline, but it must not assume PDF, email, invoice cancellation/correction or payment reversal capabilities exist until their own gates pass.
