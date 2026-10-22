-- Pack 6 Part B: finance-approved, versioned overdue-reminder policy.
-- Forward-only: never edit migrations 001–026.
CREATE TABLE overdue_reminder_policies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  legal_entity_id CHAR(36) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  first_reminder_after_days SMALLINT UNSIGNED NOT NULL,
  max_reminders TINYINT UNSIGNED NOT NULL,
  interval_days SMALLINT UNSIGNED NOT NULL,
  status ENUM('PENDING_APPROVAL','ACTIVE','DISABLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  requested_by CHAR(36) NOT NULL,
  approved_by CHAR(36) NULL,
  approval_reference VARCHAR(255) NULL,
  approval_evidence_notes TEXT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at DATETIME(3) NULL,
  disabled_by CHAR(36) NULL,
  disabled_at DATETIME(3) NULL,
  disable_reason VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reminder_policy_version (legal_entity_id,version_number),
  KEY ix_reminder_policy_active (status,legal_entity_id),
  CONSTRAINT fk_reminder_policy_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT,
  CONSTRAINT ck_reminder_policy_first_days CHECK (first_reminder_after_days BETWEEN 1 AND 365),
  CONSTRAINT ck_reminder_policy_max_reminders CHECK (max_reminders BETWEEN 1 AND 6),
  CONSTRAINT ck_reminder_policy_interval CHECK (interval_days BETWEEN 1 AND 90),
  CONSTRAINT ck_reminder_policy_approval CHECK (
    (status <> 'ACTIVE') OR
    (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_reference IS NOT NULL AND approval_evidence_notes IS NOT NULL)
  )
) ENGINE=InnoDB;
