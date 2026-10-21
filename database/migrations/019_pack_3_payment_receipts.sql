-- Pack 3: receipt identity, legal-entity scope and allocation idempotency.
-- Existing invoice allocations are used to backfill entity scope where it is unambiguous.
-- Legacy unallocated rows remain NULL-scoped and are intentionally not surfaced by scoped lists.
ALTER TABLE payments
  ADD COLUMN legal_entity_id CHAR(36) NULL AFTER id,
  ADD COLUMN receipt_reference VARCHAR(40) NULL AFTER legal_entity_id,
  ADD KEY ix_payments_entity_customer_date (legal_entity_id, customer_id, payment_date),
  ADD UNIQUE KEY uq_payment_receipt_reference (receipt_reference),
  ADD CONSTRAINT fk_payments_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;

UPDATE payments p
JOIN (
  SELECT pa.payment_id, MIN(i.legal_entity_id) AS legal_entity_id
    FROM payment_allocations pa
    JOIN invoices i ON i.id = pa.invoice_id
   GROUP BY pa.payment_id
  HAVING COUNT(DISTINCT i.legal_entity_id) = 1
) attributed ON attributed.payment_id = p.id
   SET p.legal_entity_id = attributed.legal_entity_id
 WHERE p.legal_entity_id IS NULL;

UPDATE payments
   SET receipt_reference = CONCAT('RCPT-', UPPER(REPLACE(id, '-', '')))
 WHERE receipt_reference IS NULL;

ALTER TABLE payment_allocations
  ADD COLUMN idempotency_key VARCHAR(128) NULL AFTER amount,
  ADD COLUMN created_by CHAR(36) NULL AFTER idempotency_key,
  ADD UNIQUE KEY uq_payment_allocation_idempotency (idempotency_key),
  ADD CONSTRAINT fk_payment_allocation_created_by FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE RESTRICT;
