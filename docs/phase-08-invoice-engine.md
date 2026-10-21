# Phase 08 — Invoice Engine & Financial Calculations

**Status:** Invoice-engine core and Pack 2 lifecycle regression hardening are committed directly to `main`. Latest verified code revision: `0026defdf6da109a8379e945b7c3a144ba8d07d6`; full CI passed in [run 39394369865](https://github.com/Daarxsn/Fx-Financial/actions/runs/39394369865). The workflow verifies the current MySQL 8 migrations/seed/restore, authorization and invoice/quotation API contracts, Phase 6B issue/configuration snapshots, calculations, lint, TypeScript, production build and Playwright browser acceptance. Earlier implementation-baseline CI: https://github.com/Daarxsn/Fx-Financial/actions/runs/39005607553.

## Delivered

The invoice workspace now supports a searchable, scoped invoice list; draft creation and editing; catalog-backed item/service lines; separate charge lines; quantity and unit-rate entry; fixed or percentage discounts; approved tax-code selection; invoice and due dates; payment terms; server-returned totals; payment-aware outstanding balances; and issue actions guarded by the existing Phase 6B approval, numbering and snapshot workflow.

The implemented API is:

- `GET /api/v1/invoices`: bounded, entity-scoped list/search/filter with pagination and calculated balances.
- `POST /api/v1/invoices`: create a draft with an `Idempotency-Key` and payload fingerprint.
- `GET /api/v1/invoices/draft-options`: retrieve permitted active entities, customers, catalog items and approved tax rules.
- `GET /api/v1/invoices/{invoiceId}`: read lines, stored calculation results and outstanding balance in the caller's scope.
- `PATCH /api/v1/invoices/{invoiceId}`: update drafts only, with `expectedVersion` optimistic concurrency and server recalculation.
- `POST /api/v1/invoices/{invoiceId}/issue`: the existing controlled issuance endpoint now recalculates from persisted line inputs and approved effective tax configuration before preserving issue-time evidence and allocating the official number.
- `GET /api/v1/invoices/{invoiceId}/payments`: list payment allocations for an invoice within the caller's legal-entity scope.
- `POST /api/v1/invoices/{invoiceId}/payments`: record a manual payment against an issued invoice, with exact-decimal amount validation, invoice locking, outstanding-balance enforcement, idempotency-key conflict detection, transactionally persisted allocation, and audit evidence. Receipts, reversal workflows, general payment allocation, and a dedicated payment workspace are not yet complete.

## Calculation policy: invoice-calculation-v1

All monetary calculations use exact scaled integers with `BigInt`, not JavaScript floating-point arithmetic. User-entered monetary amounts and quantities are decimal strings with up to four fractional places. Tax rates are percentages with up to six fractional places.

For each line, the engine extends quantity by unit price, calculates the configured fixed/percentage discount, derives the taxable net amount, then calculates tax and line total. It rounds line extensions, calculated percentage discounts and tax amounts to four decimals using explicit **ROUND_HALF_UP**, then aggregates those rounded line values. Amounts returned by the engine are serialized to four decimal places to match MySQL `DECIMAL(19,4)`.

Tax behaviour comes only from the approved effective-dated tax rule selected by the server:

- **Tax-exclusive:** the unit price excludes tax. Discounts are applied to the net line amount, tax is calculated on the post-discount taxable value, and line total is taxable value plus tax.
- **Tax-inclusive:** the unit price includes tax. The engine extracts the net taxable value using `gross × 100 / (100 + rate)`, rounded HALF_UP to four places. An entered discount reduces gross price; its net-of-tax discount is extracted and the post-discount gross amount remains the line total.

The document reports:

- **Subtotal:** aggregate net-of-tax line bases before discounts.
- **Discount total:** aggregate discounts excluding the tax component.
- **Taxable value:** subtotal minus discount total.
- **Tax total:** aggregate calculated line tax.
- **Grand total:** sum of line totals after discounts and including applicable tax.
- **Outstanding balance:** `max(0, grand total − recorded allocated payments)`, using exact decimal subtraction.

Additional charges are explicit lines with `lineKind=CHARGE`, so their discount and approved tax treatment are visible and calculated under the same policy. A customer-facing UI amount or client-supplied total cannot override the server’s results.

## Currency, dates and safety

The current policy requires the invoice currency to equal the selected legal entity’s configured currency. FX conversion is intentionally blocked until finance approves an exchange-rate source, rate date, rounding and gain/loss policy.

Invoice and due dates must be real `YYYY-MM-DD` calendar dates; due dates cannot precede invoice dates. If a due date is omitted or null and an invoice date is present, it is derived from the invoice date and payment terms. Quantities must be positive; prices and discounts must be non-negative; discounts cannot exceed a line; percentages cannot exceed 100; malformed precision and unsupported tax codes are rejected. Tax code alone is accepted from the client—the server resolves the applicable rate and inclusive/exclusive mode.

Create retries with an identical idempotency key and identical payload return the existing draft. Reusing a key for a different payload returns a conflict. Stale draft updates are rejected using the record version. Issued/cancelled documents cannot be edited with draft endpoints, and the issuance path recalculates totals before taking the established configuration snapshot.

## Automated evidence

CI on the implementation revision passed MySQL 8 migrations/seed/dump-restore, OpenAPI validation, authorization/API contracts, Phase 6B issuance/snapshot tests, the new invoice calculation test suite, responsive/accessibility foundation checks, lint, TypeScript and production build.

The added calculation test suite covers exclusive and inclusive tax, fixed/percentage discount handling, an additional charge, half-up rounding at the fourth decimal, invalid negative values/rate and over-discounts, date validation, and outstanding balances. The MySQL-backed API suite additionally covers create/update/list/detail consistency, approved inclusive/exclusive rules, idempotency and conflicts, stale-version protection, and issue-time recalculation against deliberately inconsistent draft totals.

## Pack 2 lifecycle regression hardening (2026-10-20)

The full CI run on `ea0803f57efe81114e8ee82325fca62a3f0aacbc` passed with these new lifecycle regression gates:

- **Issue-time customer identity:** invoice detail and list use the frozen `customer_snapshot` name when available. The MySQL-backed API test renames the live customer after issuance and verifies the issued invoice continues to show its issue-time name in both detail and list.
- **Quotation conversion date safety:** conversion derives the invoice date from the legal entity's configured timezone and fails closed if the timezone is invalid. The regression test verifies the accepted quotation stays accepted and no invoice draft is created.
- **Concurrent invoice issuance:** simultaneous same-key, same-document-date requests return one original result and one idempotent replay. Both responses share the same official invoice number and immutable configuration snapshot hash; existing checks verify a single issue snapshot A separate test reuses the consumed key on a different draft and verifies a conflict with no second number allocation or snapshot.

These checks do not replace configured Aiven integration evidence, finance/legal policy approvals, or manual production-like browser acceptance. Invoice cancellation/correction behavior remains a policy gate until finance/legal approves how issued documents are corrected and numbered.

## Payment recording status (Pack 0)

The payment-recording API is part of the current implementation baseline. Pack 0 adds MySQL-backed endpoint regression coverage for concurrent identical retries (one creation and one replay), conflicting idempotency-key reuse, zero-value rejection, overpayment rejection, payment-history retrieval, and exact outstanding-balance arithmetic. This does not establish production readiness for reversals, receipts, general allocation, reconciliation, or payment UI.

## Remaining rollout gates

- Manual browser acceptance at real desktop and mobile viewports, keyboard usability and finance-user sign-off remain operator checks.
- Migrations 013–015 passed in the disposable MySQL 8 CI service; they have not been applied to the configured Aiven instance in this work.
- Finance/tax owners still need to approve actual production tax rules, registrations, invoice numbering/configuration and policy for any future multi-currency requirements.
