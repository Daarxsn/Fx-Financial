-- Pack 6: allow audited verification events when the worker reads an immutable PDF for an email attachment.
-- Forward-only: extend the existing event vocabulary instead of editing Pack 5 migration 024.
ALTER TABLE generated_document_events
  MODIFY event_type ENUM(
    'REQUESTED',
    'RETRY_STARTED',
    'READY',
    'FAILED',
    'DOWNLOADED',
    'EMAIL_ATTACHMENT_VERIFIED',
    'INTEGRITY_FAILURE'
  ) NOT NULL;
