-- Pack 5: immutable business-document content snapshots and private generated PDF history.
-- Forward-only MySQL 8 migration. Never edit after this migration is recorded.
-- Historical backfills are explicitly marked LEGACY_BACKFILL; they do not claim pre-existing PDFs were archived.

CREATE TABLE IF NOT EXISTS document_content_snapshots (
  id CHAR(36) NOT NULL PRIMARY KEY,
  source_document_type ENUM('INVOICE','QUOTATION','RECEIPT') NOT NULL,
  source_document_id CHAR(36) NOT NULL,
  legal_entity_id CHAR(36) NOT NULL,
  document_number VARCHAR(80) NOT NULL,
  source_configuration_snapshot_id CHAR(36) NULL,
  revision_number INT UNSIGNED NOT NULL,
  capture_reason ENUM('ISSUED','STATUS_CHANGE','RECEIPT_RECORDED','RECEIPT_REVERSED','LEGACY_BACKFILL') NOT NULL,
  content_json JSON NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  captured_by CHAR(36) NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_doc_content_revision (source_document_type,source_document_id,revision_number),
  UNIQUE KEY uq_doc_content_hash (source_document_type,source_document_id,content_sha256),
  KEY ix_doc_content_history (legal_entity_id,source_document_type,source_document_id,captured_at,id),
  CONSTRAINT fk_doc_content_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_doc_content_config_snapshot FOREIGN KEY (source_configuration_snapshot_id) REFERENCES document_configuration_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_doc_content_actor FOREIGN KEY (captured_by) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_doc_content_revision CHECK (revision_number >= 1),
  CONSTRAINT ck_doc_content_hash CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB;

CREATE TRIGGER trg_document_content_snapshot_no_update
BEFORE UPDATE ON document_content_snapshots
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document content snapshots are immutable';
END;

CREATE TRIGGER trg_document_content_snapshot_no_delete
BEFORE DELETE ON document_content_snapshots
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document content snapshots are immutable';
END;

CREATE TABLE IF NOT EXISTS generated_documents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  content_snapshot_id CHAR(36) NOT NULL,
  source_document_type ENUM('INVOICE','QUOTATION','RECEIPT') NOT NULL,
  source_document_id CHAR(36) NOT NULL,
  legal_entity_id CHAR(36) NOT NULL,
  document_number VARCHAR(80) NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  byte_size BIGINT UNSIGNED NULL,
  file_sha256 CHAR(64) NULL,
  status ENUM('PENDING','READY','FAILED') NOT NULL DEFAULT 'PENDING',
  generation_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(80) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ready_at DATETIME(3) NULL,
  UNIQUE KEY uq_generated_document_snapshot (content_snapshot_id),
  UNIQUE KEY uq_generated_document_storage_key (storage_key(191)),
  KEY ix_generated_doc_scope_history (legal_entity_id,source_document_type,source_document_id,created_at,id),
  KEY ix_generated_doc_ready (status,updated_at),
  CONSTRAINT fk_generated_document_content FOREIGN KEY (content_snapshot_id) REFERENCES document_content_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_generated_document_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_generated_document_creator FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_generated_document_mime CHECK (mime_type='application/pdf'),
  CONSTRAINT ck_generated_document_integrity CHECK (
    (status='READY' AND byte_size IS NOT NULL AND byte_size>0 AND file_sha256 REGEXP '^[0-9a-f]{64}$' AND ready_at IS NOT NULL)
    OR status IN ('PENDING','FAILED')
  ),
  CONSTRAINT ck_generated_document_attempts CHECK (generation_attempts >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS generated_document_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  generated_document_id CHAR(36) NOT NULL,
  event_type ENUM('REQUESTED','RETRY_STARTED','READY','FAILED','DOWNLOADED','INTEGRITY_FAILURE') NOT NULL,
  previous_status ENUM('PENDING','READY','FAILED') NULL,
  new_status ENUM('PENDING','READY','FAILED') NOT NULL,
  actor_id CHAR(36) NULL,
  reason VARCHAR(1000) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_generated_doc_events (generated_document_id,created_at,id),
  CONSTRAINT fk_generated_doc_event_doc FOREIGN KEY (generated_document_id) REFERENCES generated_documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_generated_doc_event_actor FOREIGN KEY (actor_id) REFERENCES app_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TRIGGER trg_generated_document_event_no_update
BEFORE UPDATE ON generated_document_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Generated document events are append-only';
END;

CREATE TRIGGER trg_generated_document_event_no_delete
BEFORE DELETE ON generated_document_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Generated document events are append-only';
END;

-- One-time best-effort backfill of historical content for eligible records. These rows are labelled
-- LEGACY_BACKFILL and do not imply that a PDF was previously created or that pre-migration mutable
-- fields are stronger evidence than the original issue/customer/supplier/configuration snapshots.
INSERT IGNORE INTO document_content_snapshots
  (id,source_document_type,source_document_id,legal_entity_id,document_number,source_configuration_snapshot_id,
   revision_number,capture_reason,content_json,content_sha256,captured_by,captured_at)
SELECT UUID(),p.source_document_type,p.source_document_id,p.legal_entity_id,p.document_number,p.source_configuration_snapshot_id,
       1,'LEGACY_BACKFILL',p.content_json,SHA2(CAST(p.content_json AS CHAR),256),p.captured_by,NOW(3)
FROM (
  SELECT 'INVOICE' AS source_document_type,i.id AS source_document_id,i.legal_entity_id,i.invoice_number AS document_number,
         d.id AS source_configuration_snapshot_id,i.issued_by AS captured_by,
         JSON_OBJECT('schemaVersion',1,'captureReason','LEGACY_BACKFILL','sourceType','INVOICE','sourceDocumentId',i.id,
           'documentNumber',i.invoice_number,'lifecycleStatus',i.lifecycle_status,
           'documentDate',DATE_FORMAT(i.invoice_date,'%Y-%m-%d'),'dueDate',DATE_FORMAT(i.due_date,'%Y-%m-%d'),
           'validUntil',NULL,'currency',i.currency,'subtotal',CAST(i.subtotal AS CHAR),
           'discountTotal',CAST(i.discount_total AS CHAR),'taxTotal',CAST(i.tax_total AS CHAR),
           'grandTotal',CAST(i.grand_total AS CHAR),'paidAmount',CAST(COALESCE((
             SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments pay ON pay.id=pa.payment_id
             WHERE pa.invoice_id=i.id AND pay.status='RECORDED'),0) AS CHAR),
           'paymentStatus',CASE WHEN i.lifecycle_status='CANCELLED' THEN 'CANCELLED'
             WHEN COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments pay ON pay.id=pa.payment_id
               WHERE pa.invoice_id=i.id AND pay.status='RECORDED'),0)>=i.grand_total AND i.grand_total>0 THEN 'PAID'
             WHEN COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments pay ON pay.id=pa.payment_id
               WHERE pa.invoice_id=i.id AND pay.status='RECORDED'),0)>0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END,
           'notes',i.notes,'supplier',i.supplier_snapshot,'customer',i.customer_snapshot,
           'configurationSnapshotId',d.id,'configurationSha256',d.configuration_sha256,
           'configurationSnapshot',d.configuration_snapshot,
           'lines',COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('lineNumber',ordered.line_number,'lineKind',ordered.line_kind,
             'description',ordered.description,'unitCode',ordered.unit_code,'quantity',CAST(ordered.quantity AS CHAR),
             'unitPrice',CAST(ordered.unit_price AS CHAR),'discountType',ordered.discount_type,
             'discountValue',CAST(ordered.discount_value AS CHAR),'discountAmount',CAST(ordered.discount_amount AS CHAR),
             'taxRate',CAST(ordered.tax_rate AS CHAR),'taxCode',ordered.tax_code,'taxCalculationMode',ordered.tax_calculation_mode,
             'taxAmount',CAST(ordered.tax_amount AS CHAR),'lineTotal',CAST(ordered.line_total AS CHAR)))
             FROM (SELECT line_number,line_kind,description,unit_code,quantity,unit_price,discount_type,discount_value,
               discount_amount,tax_rate,tax_code,tax_calculation_mode,tax_amount,line_total
               FROM invoice_lines WHERE invoice_id=i.id ORDER BY line_number) ordered),JSON_ARRAY())) AS content_json
  FROM invoices i JOIN document_configuration_snapshots d ON d.resource_type=i.document_type AND d.resource_id=i.id
  WHERE i.document_type='INVOICE' AND i.lifecycle_status IN ('ISSUED','CANCELLED') AND i.invoice_number IS NOT NULL

  UNION ALL

  SELECT 'QUOTATION',q.id,q.legal_entity_id,q.quotation_number,d.id,q.updated_by,
         JSON_OBJECT('schemaVersion',1,'captureReason','LEGACY_BACKFILL','sourceType','QUOTATION','sourceDocumentId',q.id,
           'documentNumber',q.quotation_number,'lifecycleStatus',q.status,'documentDate',DATE_FORMAT(q.issue_date,'%Y-%m-%d'),
           'dueDate',NULL,'validUntil',DATE_FORMAT(q.valid_until,'%Y-%m-%d'),'currency',q.currency,
           'subtotal',CAST(q.subtotal AS CHAR),'discountTotal',CAST(q.discount_total AS CHAR),'taxTotal',CAST(q.tax_total AS CHAR),
           'grandTotal',CAST(q.grand_total AS CHAR),'paidAmount','0.0000','paymentStatus','NOT_APPLICABLE','notes',q.notes,
           'supplier',q.supplier_snapshot,'customer',q.customer_snapshot,'configurationSnapshotId',d.id,
           'configurationSha256',d.configuration_sha256,'configurationSnapshot',d.configuration_snapshot,
           'lines',COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('lineNumber',ordered.line_number,'lineKind',ordered.line_kind,
             'description',ordered.description,'unitCode',ordered.unit_code,'quantity',CAST(ordered.quantity AS CHAR),
             'unitPrice',CAST(ordered.unit_price AS CHAR),'discountType',ordered.discount_type,
             'discountValue',CAST(ordered.discount_value AS CHAR),'discountAmount',CAST(ordered.discount_amount AS CHAR),
             'taxRate',CAST(ordered.tax_rate AS CHAR),'taxCode',ordered.tax_code,'taxCalculationMode',ordered.tax_calculation_mode,
             'taxAmount',CAST(ordered.tax_amount AS CHAR),'lineTotal',CAST(ordered.line_total AS CHAR)))
             FROM (SELECT line_number,line_kind,description,unit_code,quantity,unit_price,discount_type,discount_value,
               discount_amount,tax_rate,tax_code,tax_calculation_mode,tax_amount,line_total
               FROM quotation_lines WHERE quotation_id=q.id ORDER BY line_number) ordered),JSON_ARRAY()))
  FROM quotations q JOIN document_configuration_snapshots d ON d.resource_type='QUOTATION' AND d.resource_id=q.id
  WHERE q.status<>'DRAFT' AND q.quotation_number IS NOT NULL

  UNION ALL

  SELECT 'RECEIPT',p.id,p.legal_entity_id,p.receipt_reference,NULL,p.recorded_by,
         JSON_OBJECT('schemaVersion',1,'captureReason','LEGACY_BACKFILL','sourceType','RECEIPT','sourceDocumentId',p.id,
           'documentNumber',p.receipt_reference,'lifecycleStatus',p.status,'documentDate',DATE_FORMAT(p.payment_date,'%Y-%m-%d'),
           'dueDate',NULL,'validUntil',NULL,'currency',p.currency,'subtotal',CAST(p.amount AS CHAR),
           'discountTotal','0.0000','taxTotal','0.0000','grandTotal',CAST(p.amount AS CHAR),
           'paidAmount','0.0000','paymentStatus',p.status,'notes',p.notes,'method',p.method,'reference',p.reference,
           'supplier',p.legal_entity_snapshot,'customer',p.customer_snapshot,'configurationSnapshotId',NULL,
           'configurationSha256',NULL,'configurationSnapshot',NULL,'lines',JSON_ARRAY())
  FROM payments p WHERE p.legal_entity_id IS NOT NULL AND p.receipt_reference IS NOT NULL
    AND p.customer_snapshot IS NOT NULL AND p.legal_entity_snapshot IS NOT NULL
) p;
