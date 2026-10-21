-- Pack 4: only one pending correction can exist per issued invoice.
-- Existing duplicate pending rows, if any, must be triaged rather than deleted; this ALTER
-- intentionally fails closed if more than one pending request already exists for an invoice.
ALTER TABLE invoice_correction_requests
  ADD COLUMN pending_invoice_id CHAR(36)
    GENERATED ALWAYS AS (CASE WHEN status='PENDING_REVIEW' THEN invoice_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_invoice_correction_one_pending (pending_invoice_id);
