-- Optional milestone label for the supplied brand invoice layouts.
-- Existing invoice lines remain unchanged; immutable issued snapshots are not rewritten.
ALTER TABLE invoice_lines ADD COLUMN milestone VARCHAR(160) NULL AFTER description;
