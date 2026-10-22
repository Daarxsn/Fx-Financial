-- Pack 6 Part A: durable transactional email outbox and append-only delivery evidence.
-- Forward-only: never edit migrations 001–025.
CREATE TABLE email_outbox (
  id CHAR(36) NOT NULL PRIMARY KEY,
  request_idempotency_key CHAR(36) NOT NULL,
  request_payload_sha256 CHAR(64) NOT NULL,
  legal_entity_id CHAR(36) NOT NULL,
  source_document_type ENUM('INVOICE','QUOTATION','RECEIPT') NOT NULL,
  source_document_id CHAR(36) NOT NULL,
  content_snapshot_id CHAR(36) NULL,
  generated_document_id CHAR(36) NULL,
  document_number VARCHAR(80) NOT NULL,
  message_kind ENUM('DOCUMENT','OVERDUE_REMINDER') NOT NULL DEFAULT 'DOCUMENT',
  recipient_email VARCHAR(320) NOT NULL,
  recipient_name VARCHAR(200) NULL,
  subject VARCHAR(255) NOT NULL,
  html_body MEDIUMTEXT NOT NULL,
  text_body MEDIUMTEXT NOT NULL,
  attachment_sha256 CHAR(64) NULL,
  attachment_byte_size BIGINT UNSIGNED NULL,
  provider ENUM('RESEND') NOT NULL DEFAULT 'RESEND',
  provider_idempotency_key VARCHAR(64) NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  status ENUM('QUEUED','SENDING','SENT','DELIVERED','DELIVERY_DELAYED','BOUNCED','COMPLAINED','FAILED','REQUIRES_REVIEW') NOT NULL DEFAULT 'QUEUED',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NULL,
  last_attempt_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  reminder_dedupe_key VARCHAR(255) NULL,
  reminder_policy_version INT UNSIGNED NULL,
  requested_by CHAR(36) NULL,
  sent_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_email_outbox_request_idempotency (request_idempotency_key),
  UNIQUE KEY uq_email_outbox_provider_idempotency (provider_idempotency_key),
  UNIQUE KEY uq_email_outbox_reminder_dedupe (reminder_dedupe_key),
  UNIQUE KEY uq_email_outbox_provider_message (provider, provider_message_id),
  KEY ix_email_outbox_due (status, next_attempt_at, created_at),
  KEY ix_email_outbox_source (legal_entity_id, source_document_type, source_document_id, created_at),
  KEY ix_email_outbox_generated_document (generated_document_id, created_at),
  KEY ix_email_outbox_lease (status, lease_until),
  CONSTRAINT ck_email_outbox_digest CHECK (request_payload_sha256 REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT ck_email_outbox_attachment_digest CHECK (attachment_sha256 IS NULL OR attachment_sha256 REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB;

CREATE TABLE email_outbox_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email_outbox_id CHAR(36) NULL,
  event_type VARCHAR(48) NOT NULL,
  previous_status VARCHAR(32) NULL,
  new_status VARCHAR(32) NULL,
  actor_id CHAR(36) NULL,
  provider_event_id VARCHAR(255) NULL,
  reason_code VARCHAR(64) NULL,
  payload_sha256 CHAR(64) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_email_event_provider_event (provider_event_id),
  KEY ix_email_event_outbox_time (email_outbox_id, created_at),
  KEY ix_email_event_type_time (event_type, created_at),
  CONSTRAINT fk_email_event_outbox FOREIGN KEY (email_outbox_id) REFERENCES email_outbox(id) ON DELETE RESTRICT,
  CONSTRAINT ck_email_event_payload_digest CHECK (payload_sha256 IS NULL OR payload_sha256 REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB;

INSERT INTO app_permissions (id, permission_key, description)
SELECT UUID(), 'email:send', 'Send approved invoice, quotation and receipt emails'
WHERE NOT EXISTS (SELECT 1 FROM app_permissions WHERE permission_key='email:send');

INSERT INTO app_permissions (id, permission_key, description)
SELECT UUID(), 'email:read', 'Read delivery status and email audit history within assigned legal entities'
WHERE NOT EXISTS (SELECT 1 FROM app_permissions WHERE permission_key='email:read');

INSERT INTO app_permissions (id, permission_key, description)
SELECT UUID(), 'reminders:manage', 'Manage finance-approved overdue invoice reminder policies'
WHERE NOT EXISTS (SELECT 1 FROM app_permissions WHERE permission_key='reminders:manage');

-- Existing installations already have role mappings: grant only the new, least-privilege permissions.
-- On a fresh installation role_permissions is still empty; reference seeding applies the complete template.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM app_roles r
JOIN app_permissions p ON (
  (r.role_key='system_admin' AND p.permission_key IN ('email:send','email:read','reminders:manage')) OR
  (r.role_key='finance_admin' AND p.permission_key IN ('email:send','email:read','reminders:manage')) OR
  (r.role_key='invoice_issuer' AND p.permission_key IN ('email:send','email:read')) OR
  (r.role_key='auditor' AND p.permission_key='email:read')
)
WHERE (SELECT COUNT(*) FROM role_permissions) > 0
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);
