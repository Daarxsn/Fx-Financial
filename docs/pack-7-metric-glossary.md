# Pack 7 — Reporting metric glossary

**Status: implementation baseline defined; business/finance approval pending.** This document is not evidence of issuer-specific accounting, tax, or statutory approval. Before production reports are treated as official financial statements, an authorized finance owner must review and approve the definitions and treatment of corrections.

## Date and scope rules

- All report endpoints require reports:read plus the relevant underlying domain read permission. Legal-entity scope is taken from the authenticated session; a query parameter can only narrow scope.
- Report windows use inclusive YYYY-MM-DD dates and are limited to 366 calendar days. The API discloses the period.
- Invoice movement uses invoice_date; quotation movement uses issue_date; receipt movement uses payment_date; drafts without a scheduled document date use their record-creation date. Payment reversals are counted by reversal event timestamp.
- Currency is always grouped with legal entity. Amounts in different currencies are never added together.
- Decimal amounts remain MySQL DECIMAL text and are serialized to four decimal places. Financial arithmetic uses integer-scaled values/BigInt, not JavaScript floating-point arithmetic.

## Metric definitions (provisional until signed off)

| Metric | Operational definition | Explicit exclusions / caveat |
|---|---|---|
| Issued invoice count/value | document_type=INVOICE and lifecycle_status=ISSUED, dated in the report period. | Cancelled invoices are reported separately and are not silently netted. |
| Cancelled invoice count/value | Invoice records whose current state is CANCELLED, with invoice date in the period. | Current-state view, not a historical “as originally known” snapshot. |
| Issued credit/debit-note value | Issued CREDIT_NOTE and DEBIT_NOTE records, grouped separately. | Never netted against invoice value without finance approval and a defined recognition basis. |
| Won quotation count/value | Quotations currently ACCEPTED or CONVERTED, dated in the report period. | A current lifecycle-state view; not revenue recognition. |
| Expired quotation count | Stored EXPIRED or SENT quotations whose validity date is before the report-window end date. | Expiry is evaluated for the selected end date; timezone/validity policy remains issuer-owned. |
| Recorded receipt count/value | Payments currently RECORDED, grouped by payment date. | Does not imply bank settlement or payment-gateway clearing. |
| Reversed receipt count/value | Append-only payment reversal events by reversal timestamp in the selected period. | Reversed payments are excluded from collected/allocation totals. |
| Unallocated receipt value | Current recorded payment amount minus allocations belonging to currently recorded receipts, floored at zero. | Operational unapplied-receipt measure, not a statement of customer credit/refund liability. |
| Current outstanding balance | For currently issued invoice documents, grand total less allocations from currently recorded receipts, floored at zero. | Current snapshot, independent of the selected movement period. |
| Current overdue balance/count | Current outstanding invoices with a due date before the legal entity current local date (UTC fallback only when timezone conversion is unavailable). | Requires finance approval of due-date and timezone conventions before use as an official aging report. |
| Customer activity | Customers referenced by invoices or quotations in the report window, grouped by legal entity and currency. | Global customer master data is constrained to assigned entity document linkage. |

## Required sign-off

- [ ] Finance/accounting approves the operational metric glossary and date basis.
- [ ] Finance/legal approves treatment and presentation of cancelled, credit-note, and debit-note records.
- [ ] Finance approves the meaning of overdue and unallocated receipt balances.
- [ ] Privacy/business owner approves report/export field allowlists and retention.
- [ ] Acceptance evidence records approver identity, date, and exact glossary version.

Until approved, responses label these metrics PENDING_FINANCE_APPROVAL. Code availability is not business approval or production go-live authorization.
