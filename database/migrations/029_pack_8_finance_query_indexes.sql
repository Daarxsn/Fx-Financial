-- Pack 8: add compound indexes for legal-entity scoped invoice, quotation and payment lists.
-- These indexes support date/status filtering and stable keyset-like ordering while preserving
-- the existing API pagination contract. This is forward-only: do not edit after application.

ALTER TABLE invoices
  ADD KEY ix_invoices_entity_date_history (legal_entity_id, invoice_date, created_at, id),
  ADD KEY ix_invoices_entity_status_date_history (legal_entity_id, lifecycle_status, invoice_date, created_at, id);

ALTER TABLE quotations
  ADD KEY ix_quotations_entity_date_history (legal_entity_id, issue_date, created_at, id);

ALTER TABLE payments
  ADD KEY ix_payments_entity_date_history (legal_entity_id, payment_date, created_at, id),
  ADD KEY ix_payments_entity_status_date_history (legal_entity_id, status, payment_date, created_at, id);
