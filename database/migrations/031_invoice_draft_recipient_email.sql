-- Keep an invoice-specific recipient on a draft even when it differs from the customer's default email.
-- Existing drafts inherit the current customer email once; issued-document delivery history remains in the durable email outbox.
ALTER TABLE invoices ADD COLUMN draft_recipient_email VARCHAR(320) NOT NULL DEFAULT '' AFTER notes;

UPDATE invoices i
JOIN customers c ON c.id=i.customer_id
SET i.draft_recipient_email=COALESCE(c.email,'')
WHERE i.lifecycle_status='DRAFT';
