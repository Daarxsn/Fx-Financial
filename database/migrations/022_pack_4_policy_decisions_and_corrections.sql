-- Pack 4: evidence-backed business-policy decisions and staged issued-document corrections.
-- This schema seeds PENDING decisions only; it does not imply real business, finance or tax approval.
CREATE TABLE IF NOT EXISTS business_policy_decisions (
 id CHAR(36) NOT NULL PRIMARY KEY,
 decision_key VARCHAR(10) NOT NULL,
 legal_entity_id CHAR(36) NULL,
 decision_scope_key CHAR(36) GENERATED ALWAYS AS (COALESCE(legal_entity_id,'00000000-0000-0000-0000-000000000000')) STORED,
 topic VARCHAR(200) NOT NULL,
 recommended_starting_point TEXT NOT NULL,
 required_approver VARCHAR(255) NOT NULL,
 requires_issue_gate BOOLEAN NOT NULL DEFAULT TRUE,
 status ENUM('PENDING','APPROVED','NOT_APPLICABLE','BLOCKED') NOT NULL DEFAULT 'PENDING',
 decision_code VARCHAR(80) NULL,
 decision_text TEXT NULL,
 rationale TEXT NULL,
 external_approver_name VARCHAR(160) NULL,
 external_approver_role VARCHAR(160) NULL,
 approval_reference VARCHAR(255) NULL,
 approval_date DATE NULL,
 recorded_by CHAR(36) NULL,
 recorded_at DATETIME(3) NULL,
 updated_by CHAR(36) NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_business_policy_decision_scope (decision_scope_key,decision_key),
 KEY ix_policy_decision_gate (legal_entity_id,requires_issue_gate,status),
 CONSTRAINT fk_policy_decision_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_policy_decision_recorder FOREIGN KEY (recorded_by) REFERENCES app_users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_policy_decision_updater FOREIGN KEY (updated_by) REFERENCES app_users(id) ON DELETE RESTRICT,
 CONSTRAINT ck_policy_decision_evidence CHECK (
  status NOT IN ('APPROVED','NOT_APPLICABLE') OR
  (decision_text IS NOT NULL AND CHAR_LENGTH(TRIM(decision_text))>=10 AND rationale IS NOT NULL AND CHAR_LENGTH(TRIM(rationale))>=10
   AND external_approver_name IS NOT NULL AND external_approver_role IS NOT NULL AND approval_reference IS NOT NULL
   AND approval_date IS NOT NULL AND recorded_by IS NOT NULL AND recorded_at IS NOT NULL)),
 CONSTRAINT ck_policy_decision_blocked_reason CHECK (status<>'BLOCKED' OR (rationale IS NOT NULL AND CHAR_LENGTH(TRIM(rationale))>=10)),
 CONSTRAINT ck_policy_decision_na_scope CHECK (
  status<>'NOT_APPLICABLE' OR (decision_key='D-11' AND legal_entity_id IS NOT NULL) OR (decision_key='D-12' AND legal_entity_id IS NULL)),
 CONSTRAINT ck_policy_correction_mode CHECK (
  decision_key<>'D-09' OR status<>'APPROVED' OR decision_code IN ('CANCEL_UNPAID_ONLY','CREDIT_DEBIT_NOTE_REQUIRED','CANCEL_OR_NOTE','NO_CANCELLATION'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS business_policy_decision_events (
 id CHAR(36) NOT NULL PRIMARY KEY,
 policy_decision_id CHAR(36) NOT NULL,
 previous_status ENUM('PENDING','APPROVED','NOT_APPLICABLE','BLOCKED') NULL,
 new_status ENUM('PENDING','APPROVED','NOT_APPLICABLE','BLOCKED') NOT NULL,
 decision_code VARCHAR(80) NULL,
 decision_text TEXT NULL,
 rationale TEXT NOT NULL,
 external_approver_name VARCHAR(160) NULL,
 external_approver_role VARCHAR(160) NULL,
 approval_reference VARCHAR(255) NULL,
 approval_date DATE NULL,
 recorded_by CHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_policy_decision_events_history (policy_decision_id,created_at),
 CONSTRAINT fk_policy_decision_event_decision FOREIGN KEY (policy_decision_id) REFERENCES business_policy_decisions(id) ON DELETE RESTRICT,
 CONSTRAINT fk_policy_decision_event_actor FOREIGN KEY (recorded_by) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT IGNORE INTO business_policy_decisions
 (id,decision_key,legal_entity_id,topic,recommended_starting_point,required_approver,requires_issue_gate,status,rationale)
VALUES
 (UUID(),'D-01',NULL,'Parent, brands and legal billing entities','Keep parent/platform operator, commercial brand and legal supplier distinct; do not infer the issuer from POS, Digitech or Coworks labels.','Business owner; finance/tax verification',TRUE,'PENDING','Awaiting verified brand-to-issuer mapping and named approval evidence.'),
 (UUID(),'D-05',NULL,'Calculation, tax and rounding examples','Use exact-decimal calculations and a documented rounding sequence; attach approved worked examples for charges, discounts and inclusive/exclusive tax.','Finance/accounting owner',TRUE,'PENDING','Awaiting finance-approved worked examples and evidence.'),
 (UUID(),'D-08',NULL,'Payments, overpayments and reversals','Use recorded allocations; prevent over-allocation; require reasoned audited reversals; confirm unapplied balances, refunds and withholding.','Finance/accounting owner',TRUE,'PENDING','Awaiting approved payment, overpayment and refund policy.'),
 (UUID(),'D-09',NULL,'Issued-document cancellation and correction','Never rewrite/delete issued documents; explicitly select cancellation/credit-note/debit-note path and payment-state guard.','Finance/accounting; tax/legal where applicable',TRUE,'PENDING','Awaiting signed correction policy; no cancellation/note action is enabled by default.'),
 (UUID(),'D-10',NULL,'Approvals and separation of duties','Document maker/checker, self-approval, thresholds, issue, correction, payment/reversal, export and administrator authority.','Business owner; finance/security',TRUE,'PENDING','Awaiting approved role/threshold and separation-of-duties matrix.'),
 (UUID(),'D-12',NULL,'Templates, communications and reports','Approve supplier/footer/recipient/retention/reminder and report-field policies; entity template readiness remains separately checked.','Business and finance/privacy owner',FALSE,'PENDING','Awaiting approved template, communications, export and retention policy.');

INSERT IGNORE INTO business_policy_decisions
 (id,decision_key,legal_entity_id,topic,recommended_starting_point,required_approver,requires_issue_gate,status,rationale)
SELECT UUID(),x.decision_key,le.id,x.topic,x.recommendation,x.required_approver,TRUE,'PENDING',x.initial_rationale
FROM legal_entities le
CROSS JOIN (
 SELECT 'D-02' decision_key,'Numbering' topic,'Use one approved server-side sequence per legal entity, financial year and document type.' recommendation,'Business owner and finance/accounting' required_approver,'Awaiting issuer-specific numbering format, sequence scope and approval evidence.' initial_rationale
 UNION ALL SELECT 'D-03','Financial year','Configure the actual issuer financial-year boundary and timezone; do not assume an unapproved default.','Finance/accounting owner','Awaiting issuer-specific financial-year and timezone decision.'
 UNION ALL SELECT 'D-04','Currency','Set currency from approved issuer records; no FX or multi-currency settlement is inferred.','Finance/accounting owner','Awaiting explicit currency approval from authoritative issuer records.'
 UNION ALL SELECT 'D-06','Tax registrations and rule matrix','Use effective-dated approved tax rules and matching registrations for the applicable jurisdiction.','Finance/accounting and qualified tax reviewer','Awaiting issuer-specific tax-registration and tax-rule matrix approval.'
 UNION ALL SELECT 'D-07','Payment terms and due dates','Use approved issuer/customer contract terms and snapshot the due date at issue.','Finance and business owner','Awaiting issuer-specific payment-terms and due-date policy approval.'
 UNION ALL SELECT 'D-11','E-invoice and statutory applicability','Record a reasoned statutory applicability outcome; if required but unimplemented, block issuance. Never infer IRN/submission.','Tax/accounting owner; tax/legal when required','Awaiting issuer-specific statutory/e-invoice applicability evidence.'
) x;

CREATE TABLE IF NOT EXISTS invoice_correction_requests (
 id CHAR(36) NOT NULL PRIMARY KEY,
 invoice_id CHAR(36) NOT NULL,
 legal_entity_id CHAR(36) NOT NULL,
 invoice_number_snapshot VARCHAR(80) NULL,
 correction_type ENUM('CANCEL','CREDIT_NOTE','DEBIT_NOTE') NOT NULL,
 reason VARCHAR(1000) NOT NULL,
 idempotency_key VARCHAR(128) NOT NULL,
 status ENUM('PENDING_REVIEW','REJECTED','EXECUTED') NOT NULL DEFAULT 'PENDING_REVIEW',
 requested_by CHAR(36) NOT NULL,
 reviewed_by CHAR(36) NULL,
 review_decision ENUM('APPROVE','REJECT') NULL,
 review_reason VARCHAR(1000) NULL,
 reviewed_at DATETIME(3) NULL,
 executed_at DATETIME(3) NULL,
 result_document_id CHAR(36) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_invoice_correction_idempotency (idempotency_key),
 KEY ix_invoice_correction_queue (legal_entity_id,status,created_at),
 KEY ix_invoice_correction_invoice (invoice_id,status),
 CONSTRAINT fk_correction_request_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
 CONSTRAINT fk_correction_request_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT,
 CONSTRAINT fk_correction_request_actor FOREIGN KEY (requested_by) REFERENCES app_users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_correction_review_actor FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_correction_result_document FOREIGN KEY (result_document_id) REFERENCES invoices(id) ON DELETE RESTRICT,
 CONSTRAINT ck_correction_reason CHECK (CHAR_LENGTH(TRIM(reason))>=10),
 CONSTRAINT ck_correction_separation CHECK (reviewed_by IS NULL OR reviewed_by<>requested_by),
 CONSTRAINT ck_correction_review_state CHECK (
  (status='PENDING_REVIEW' AND reviewed_by IS NULL AND review_decision IS NULL AND reviewed_at IS NULL)
  OR (status='REJECTED' AND reviewed_by IS NOT NULL AND review_decision='REJECT' AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL)
  OR (status='EXECUTED' AND reviewed_by IS NOT NULL AND review_decision='APPROVE' AND reviewed_at IS NOT NULL AND executed_at IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_correction_request_events (
 id CHAR(36) NOT NULL PRIMARY KEY,
 request_id CHAR(36) NOT NULL,
 event_type ENUM('REQUESTED','REJECTED','EXECUTED') NOT NULL,
 previous_status ENUM('PENDING_REVIEW','REJECTED','EXECUTED') NULL,
 new_status ENUM('PENDING_REVIEW','REJECTED','EXECUTED') NOT NULL,
 reason TEXT NOT NULL,
 actor_id CHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_correction_events_history (request_id,created_at),
 CONSTRAINT fk_correction_event_request FOREIGN KEY (request_id) REFERENCES invoice_correction_requests(id) ON DELETE RESTRICT,
 CONSTRAINT fk_correction_event_actor FOREIGN KEY (actor_id) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
