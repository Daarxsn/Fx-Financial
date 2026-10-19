-- Phase 10: complete quotation draft lifecycle, financial lines, idempotency and invoice conversion linkage.
-- Forward-only MySQL 8 migration. Existing quotation rows remain readable and start at version 1.
ALTER TABLE quotations
  ADD COLUMN record_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN notes TEXT NULL AFTER grand_total,
  ADD COLUMN payment_terms_days INT UNSIGNED NULL AFTER notes,
  ADD COLUMN idempotency_key VARCHAR(128) NULL AFTER payment_terms_days,
  ADD COLUMN idempotency_payload_sha256 CHAR(64) NULL AFTER idempotency_key,
  ADD COLUMN conversion_idempotency_key VARCHAR(128) NULL AFTER converted_invoice_id,
  ADD COLUMN conversion_payload_sha256 CHAR(64) NULL AFTER conversion_idempotency_key,
  ADD KEY ix_quotations_entity_status_date (legal_entity_id, status, issue_date, id),
  ADD UNIQUE KEY uq_quotation_idempotency (idempotency_key),
  ADD UNIQUE KEY uq_quotation_conversion_idempotency (legal_entity_id, conversion_idempotency_key),
  ADD CONSTRAINT ck_quotation_record_version_positive CHECK (record_version >= 1);

ALTER TABLE quotation_lines
  ADD COLUMN line_kind ENUM('ITEM','CHARGE') NOT NULL DEFAULT 'ITEM' AFTER line_number,
  ADD COLUMN discount_type ENUM('AMOUNT','PERCENT') NOT NULL DEFAULT 'AMOUNT' AFTER discount_amount,
  ADD COLUMN discount_value DECIMAL(19,4) NOT NULL DEFAULT 0.0000 AFTER discount_type,
  ADD COLUMN tax_rule_id CHAR(36) NULL AFTER tax_code,
  ADD COLUMN tax_registration_id CHAR(36) NULL AFTER tax_rule_id,
  ADD COLUMN tax_calculation_mode ENUM('EXCLUSIVE','INCLUSIVE') NOT NULL DEFAULT 'EXCLUSIVE' AFTER tax_rate,
  ADD KEY ix_quotation_lines_tax_rule (tax_rule_id),
  ADD KEY ix_quotation_lines_tax_registration (tax_registration_id),
  ADD CONSTRAINT fk_quotation_lines_tax_rule FOREIGN KEY (tax_rule_id) REFERENCES tax_rules(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quotation_lines_tax_registration FOREIGN KEY (tax_registration_id) REFERENCES legal_entity_tax_registrations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_quotation_line_discount_value_nonnegative CHECK (discount_value >= 0);
