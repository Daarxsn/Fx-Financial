-- ==============================================================================
-- ROLLBACK SCRIPT: down_032_proforma_invoice_document_fields.sql
-- Target: Migration 032 Rollback Runbook (Contingency Architecture CF-01)
-- Description: Safely drops proforma & GST columns from invoices and signature from legal_entities.
-- WARNING: Only execute under approved disaster recovery protocol.
-- ==============================================================================

START TRANSACTION;

-- Drop check constraint first
ALTER TABLE invoices
    DROP CONSTRAINT ck_invoice_valid_until;

-- Drop columns from invoices table
ALTER TABLE invoices
    DROP COLUMN invoice_valid_until,
    DROP COLUMN tax_mode,
    DROP COLUMN cgst_enabled,
    DROP COLUMN cgst_rate,
    DROP COLUMN sgst_enabled,
    DROP COLUMN sgst_rate,
    DROP COLUMN cgst_amount,
    DROP COLUMN sgst_amount;

-- Drop column from legal_entities table
ALTER TABLE legal_entities
    DROP COLUMN signature_reference;

-- Remove ledger record from schema_migrations
DELETE FROM schema_migrations WHERE version = '032_proforma_invoice_document_fields.sql';

COMMIT;
