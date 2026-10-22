-- Pack 5: separate immutable PDF artifacts for retries and fenced generation leases.
-- Forward-only: never alter applied migrations 001–024.
ALTER TABLE generated_documents
  DROP INDEX uq_generated_document_snapshot,
  ADD KEY ix_generated_document_snapshot_history (content_snapshot_id, created_at, id),
  ADD COLUMN generation_started_at DATETIME(3) NULL AFTER generation_attempts,
  ADD COLUMN generation_token CHAR(36) NULL AFTER generation_started_at;
