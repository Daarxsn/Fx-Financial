-- Pack 3: allow a receipt to be allocated in multiple partial chunks to the same invoice.
-- Idempotency is now enforced per allocation request; source allocation rows remain immutable ledger facts.
ALTER TABLE payment_allocations
  DROP INDEX uq_payment_invoice_allocation,
  ADD KEY ix_payment_invoice_allocation (payment_id, invoice_id, created_at);
