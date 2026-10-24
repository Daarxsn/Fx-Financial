-- Proforma invoice form, invoice-level GST components and private signature image reference.
-- Forward-only MySQL 8 migration; preserve all existing invoice and issuer history.
ALTER TABLE invoices
  ADD COLUMN invoice_valid_until DATE NULL AFTER due_date,
  ADD COLUMN tax_mode ENUM('LINE','COMPONENTS') NOT NULL DEFAULT 'LINE' AFTER invoice_valid_until,
  ADD COLUMN cgst_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER tax_mode,
  ADD COLUMN cgst_rate DECIMAL(9,6) NULL AFTER cgst_enabled,
  ADD COLUMN sgst_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER cgst_rate,
  ADD COLUMN sgst_rate DECIMAL(9,6) NULL AFTER sgst_enabled,
  ADD COLUMN cgst_amount DECIMAL(19,4) NOT NULL DEFAULT 0.0000 AFTER sgst_rate,
  ADD COLUMN sgst_amount DECIMAL(19,4) NOT NULL DEFAULT 0.0000 AFTER cgst_amount,
  ADD CONSTRAINT ck_invoice_valid_until CHECK (invoice_valid_until IS NULL OR invoice_date IS NULL OR invoice_valid_until >= invoice_date);

ALTER TABLE legal_entities
  ADD COLUMN signature_reference VARCHAR(1024) NULL AFTER logo_reference;
