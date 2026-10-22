# Pack 8 Query Plan and Index Review

**Scope:** invoice, quotation and payment list queries used by the current API  
**Migration:** `029_pack_8_finance_query_indexes.sql`  
**Automated evidence:** `scripts/verify-pack-8-query-plans.mjs`, run on the disposable MySQL 8 CI service

## Review result

The list endpoints use legal-entity scoping, status/date filters where supplied, stable ordering by business date plus creation time and ID, and bounded `LIMIT`/offset pagination (1–100 rows; offset capped at 1,000,000). The report layer also caps list page sizes at 100 and CSV exports at the existing allowlisted maximum.

The review found useful leading-index gaps:
- Invoice history/status indexes did not cover the common compound predicate `legal_entity_id + lifecycle_status + invoice_date` with creation-time/ID tie-breakers.
- Quotation history already had `legal_entity_id + status + issue_date + id`, but no parallel entity/date index for the unfiltered status view.
- Receipt history had `legal_entity_id + customer_id + payment_date`, which is less suitable for entity-scoped date lists when no customer filter is selected.

Migration 029 adds the compound indexes without changing existing data or financial semantics:
- invoices: `ix_invoices_entity_date_history`, `ix_invoices_entity_status_date_history`
- quotations: `ix_quotations_entity_date_history`
- payments: `ix_payments_entity_date_history`, `ix_payments_entity_status_date_history`

## Automated test

On every CI run, the new query-plan verifier creates temporary legal entities/customers and inserts 3,000 draft invoices, 3,000 quotations and 3,000 receipts spread across ten legal-entity scopes. It runs `ANALYZE TABLE` in the disposable database, issues `EXPLAIN` for five list query shapes, confirms the matching composite index is in `possible_keys`, logs selected key and estimated rows, and deletes the fixture records. The test fails outside the loopback `falchion_ci` CI database.

The HTTP health smoke test validates the configured global browser security headers on a live development response. A separate `next start` smoke test checks the actual production server response for CSP, frame/MIME/referrer/permissions/COOP policies, HSTS and absence of `X-Powered-By`.

## Interpretation and residual limit

These checks demonstrate index availability and MySQL planner visibility at a representative disposable CI row count; they do not establish a latency SLA or production-sized worst-case behavior. Actual deployed data-volume benchmarking and monitoring belong in Pack 9 and must use the production provider environment under a controlled, approved test plan. No production DB is altered by the Pack 8 test.
