import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "@/lib/db/pool";
import { canonicalDocumentJson, captureDocumentContentSnapshot, type ContentCaptureReason, type ContentSourceType } from "@/lib/documents/snapshots";
import { renderDocumentPdf, type PdfSnapshot } from "@/lib/documents/pdf";
import { getPrivateObject, headPrivateObject, putPrivateObject, PrivateStorageError } from "@/lib/documents/storage";

export type DocumentSourceType = ContentSourceType;
type SourceMeta = { id: string; legal_entity_id: string; document_number: string; status: string };
type SnapshotRow = RowDataPacket & {
  id: string; source_document_type: DocumentSourceType; source_document_id: string;
  legal_entity_id: string; document_number: string; revision_number: number;
  content_json: unknown; content_sha256: string; captured_at: Date | string;
};
type GeneratedRow = RowDataPacket & {
  id: string; content_snapshot_id: string; source_document_type: DocumentSourceType;
  source_document_id: string; legal_entity_id: string; document_number: string;
  storage_key: string; mime_type: string; byte_size: number | string | null;
  file_sha256: string | null; status: "PENDING" | "READY" | "FAILED"; generation_attempts: number;
  last_error_code: string | null; created_by: string; created_at: Date | string; ready_at: Date | string | null;
  generation_started_at: Date | string | null; generation_token: string | null; lease_age_seconds?: number | null;
};

export class DocumentWorkflowError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "DocumentWorkflowError";
  }
}
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
function object(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
function dateText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function amount(value: unknown): string { return String(value ?? "0.0000"); }
function amountUnits(value: unknown): bigint {
  const raw = amount(value);
  if (!/^(0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$/.test(raw)) {
    throw new DocumentWorkflowError("DOCUMENT_SNAPSHOT_INVALID", 409, "The stored document amount is invalid.");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10000n + BigInt((fraction + "0000").slice(0, 4));
}
function paymentStatus(total: unknown, paid: unknown, lifecycle: string): string {
  if (lifecycle === "CANCELLED") return "CANCELLED";
  const due = amountUnits(total), settled = amountUnits(paid);
  if (due > 0n && settled >= due) return "PAID";
  if (settled > 0n) return "PARTIALLY_PAID";
  return "UNPAID";
}
function safeStorageError(error: unknown): string {
  if (error instanceof PrivateStorageError) return error.code;
  if (error instanceof DocumentWorkflowError) return error.code;
  return "DOCUMENT_GENERATION_FAILED";
}
function event(
  conn: PoolConnection, documentId: string, eventType: "REQUESTED" | "RETRY_STARTED" | "READY" | "FAILED" | "DOWNLOADED" | "EMAIL_ATTACHMENT_VERIFIED" | "INTEGRITY_FAILURE",
  previousStatus: "PENDING" | "READY" | "FAILED" | null, newStatus: "PENDING" | "READY" | "FAILED",
  actorId: string | null, reason: string | null, metadata: Record<string, unknown> | null = null,
) {
  return conn.execute(
    "INSERT INTO generated_document_events (id,generated_document_id,event_type,previous_status,new_status,actor_id,reason,metadata_json) VALUES (?,?,?,?,?,?,?,?)",
    [randomUUID(), documentId, eventType, previousStatus, newStatus, actorId, reason, metadata ? JSON.stringify(metadata) : null],
  );
}

export async function getEligibleDocumentSource(sourceType: DocumentSourceType, sourceId: string): Promise<SourceMeta | null> {
  let rows: SourceMeta[] = [];
  if (sourceType === "INVOICE") {
    const [result] = await pool.execute<(RowDataPacket & SourceMeta)[]>(
      "SELECT id,legal_entity_id,invoice_number AS document_number,lifecycle_status AS status FROM invoices WHERE id=? AND document_type='INVOICE' AND lifecycle_status IN ('ISSUED','CANCELLED') AND invoice_number IS NOT NULL LIMIT 1",
      [sourceId],
    );
    rows = result;
  } else if (sourceType === "QUOTATION") {
    const [result] = await pool.execute<(RowDataPacket & SourceMeta)[]>(
      "SELECT id,legal_entity_id,quotation_number AS document_number,status FROM quotations WHERE id=? AND status<>'DRAFT' AND quotation_number IS NOT NULL LIMIT 1",
      [sourceId],
    );
    rows = result;
  } else {
    const [result] = await pool.execute<(RowDataPacket & SourceMeta)[]>(
      "SELECT id,legal_entity_id,receipt_reference AS document_number,status FROM payments WHERE id=? AND legal_entity_id IS NOT NULL AND receipt_reference IS NOT NULL AND customer_snapshot IS NOT NULL AND legal_entity_snapshot IS NOT NULL AND status IN ('RECORDED','REVERSED') LIMIT 1",
      [sourceId],
    );
    rows = result;
  }
  return rows[0] ?? null;
}

export async function captureDocumentSourceSnapshot(
  conn: PoolConnection, sourceType: DocumentSourceType, sourceId: string, actorId: string | null,
  reason: ContentCaptureReason,
): Promise<{ id: string; revisionNumber: number; contentSha256: string }> {
  if (sourceType === "INVOICE") {
    const [rows] = await conn.execute<(RowDataPacket & {
      id: string; legal_entity_id: string; document_type: string; invoice_number: string | null; lifecycle_status: string;
      currency: string; subtotal: string; discount_total: string; tax_total: string; grand_total: string;
      invoice_date: Date | string | null; due_date: Date | string | null; notes: string | null;
      supplier_snapshot: unknown; customer_snapshot: unknown; issued_by: string | null;
      configuration_id: string | null; configuration_sha256: string | null; configuration_snapshot: unknown; paid_total: string | number;
    })[]>(
      "SELECT i.id,i.legal_entity_id,i.document_type,i.invoice_number,i.lifecycle_status,i.currency,i.subtotal,i.discount_total,i.tax_total,i.grand_total,i.invoice_date,i.due_date,i.notes,i.supplier_snapshot,i.customer_snapshot,i.issued_by,d.id AS configuration_id,d.configuration_sha256,d.configuration_snapshot,COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'),0) AS paid_total FROM invoices i LEFT JOIN document_configuration_snapshots d ON d.resource_type=i.document_type AND d.resource_id=i.id WHERE i.id=? LIMIT 1 FOR UPDATE",
      [sourceId],
    );
    const row = rows[0];
    if (!row || !row.invoice_number || !["ISSUED", "CANCELLED"].includes(row.lifecycle_status)) {
      throw new DocumentWorkflowError("DOCUMENT_SOURCE_NOT_READY", 409, "Only issued or cancelled invoices can produce a PDF.");
    }
    if (!row.configuration_id || !row.configuration_snapshot || !row.supplier_snapshot || !row.customer_snapshot) {
      throw new DocumentWorkflowError("DOCUMENT_SNAPSHOT_UNAVAILABLE", 409, "The invoice does not have complete issue-time snapshots required for a reliable PDF.");
    }
    const [lineRows] = await conn.execute<(RowDataPacket & {
      line_number: number; line_kind: string; milestone: string|null; description: string; unit_code: string; quantity: string;
      unit_price: string; discount_type: string; discount_value: string; discount_amount: string;
      tax_rate: string; tax_code: string | null; tax_calculation_mode: string; tax_amount: string; line_total: string;
    })[]>(
      "SELECT line_number,line_kind,milestone,description,unit_code,quantity,unit_price,discount_type,discount_value,discount_amount,tax_rate,tax_code,tax_calculation_mode,tax_amount,line_total FROM invoice_lines WHERE invoice_id=? ORDER BY line_number",
      [sourceId],
    );
    const paid = amount(row.paid_total);
    const content = {
      schemaVersion: 1, captureReason: reason, sourceType, sourceDocumentId: row.id,
      documentNumber: row.invoice_number, lifecycleStatus: row.lifecycle_status,
      documentDate: dateText(row.invoice_date), dueDate: dateText(row.due_date), validUntil: null,
      currency: row.currency, subtotal: amount(row.subtotal), discountTotal: amount(row.discount_total),
      taxTotal: amount(row.tax_total), grandTotal: amount(row.grand_total), paidAmount: paid,
      paymentStatus: paymentStatus(row.grand_total, paid, row.lifecycle_status), notes: row.notes,
      supplier: object(row.supplier_snapshot), customer: object(row.customer_snapshot),
      configurationSnapshotId: row.configuration_id, configurationSha256: row.configuration_sha256,
      configurationSnapshot: object(row.configuration_snapshot),
      lines: lineRows.map(line => ({
        lineNumber: Number(line.line_number), lineKind: line.line_kind, milestone: line.milestone??"", description: line.description, unitCode: line.unit_code,
        quantity: String(line.quantity), unitPrice: String(line.unit_price), discountType: line.discount_type,
        discountValue: String(line.discount_value), discountAmount: String(line.discount_amount),
        taxRate: String(line.tax_rate), taxCode: line.tax_code, taxCalculationMode: line.tax_calculation_mode,
        taxAmount: String(line.tax_amount), lineTotal: String(line.line_total),
      })),
    };
    return captureDocumentContentSnapshot(conn, {
      sourceType, sourceDocumentId: row.id, legalEntityId: row.legal_entity_id, documentNumber: row.invoice_number,
      configurationSnapshotId: row.configuration_id, captureReason: reason, content, actorId,
    });
  }

  if (sourceType === "QUOTATION") {
    const [rows] = await conn.execute<(RowDataPacket & {
      id: string; legal_entity_id: string; quotation_number: string | null; status: string; issue_date: Date | string | null;
      valid_until: Date | string | null; currency: string; subtotal: string; discount_total: string; tax_total: string;
      grand_total: string; notes: string | null; supplier_snapshot: unknown; customer_snapshot: unknown;
      configuration_id: string | null; configuration_sha256: string | null; configuration_snapshot: unknown;
    })[]>(
      "SELECT q.id,q.legal_entity_id,q.quotation_number,q.status,q.issue_date,q.valid_until,q.currency,q.subtotal,q.discount_total,q.tax_total,q.grand_total,q.notes,q.supplier_snapshot,q.customer_snapshot,d.id AS configuration_id,d.configuration_sha256,d.configuration_snapshot FROM quotations q LEFT JOIN document_configuration_snapshots d ON d.resource_type='QUOTATION' AND d.resource_id=q.id WHERE q.id=? LIMIT 1 FOR UPDATE",
      [sourceId],
    );
    const row = rows[0];
    if (!row || !row.quotation_number || row.status === "DRAFT") {
      throw new DocumentWorkflowError("DOCUMENT_SOURCE_NOT_READY", 409, "Only sent or later quotations can produce a PDF.");
    }
    if (!row.configuration_id || !row.configuration_snapshot || !row.supplier_snapshot || !row.customer_snapshot) {
      throw new DocumentWorkflowError("DOCUMENT_SNAPSHOT_UNAVAILABLE", 409, "The quotation does not have complete send-time snapshots required for a reliable PDF.");
    }
    const [lineRows] = await conn.execute<(RowDataPacket & {
      line_number: number; line_kind: string; description: string; unit_code: string; quantity: string;
      unit_price: string; discount_type: string; discount_value: string; discount_amount: string;
      tax_rate: string; tax_code: string | null; tax_calculation_mode: string; tax_amount: string; line_total: string;
    })[]>(
      "SELECT line_number,line_kind,description,unit_code,quantity,unit_price,discount_type,discount_value,discount_amount,tax_rate,tax_code,tax_calculation_mode,tax_amount,line_total FROM quotation_lines WHERE quotation_id=? ORDER BY line_number",
      [sourceId],
    );
    const content = {
      schemaVersion: 1, captureReason: reason, sourceType, sourceDocumentId: row.id,
      documentNumber: row.quotation_number, lifecycleStatus: row.status,
      documentDate: dateText(row.issue_date), dueDate: null, validUntil: dateText(row.valid_until),
      currency: row.currency, subtotal: amount(row.subtotal), discountTotal: amount(row.discount_total),
      taxTotal: amount(row.tax_total), grandTotal: amount(row.grand_total), paidAmount: "0.0000",
      paymentStatus: "NOT_APPLICABLE", notes: row.notes,
      supplier: object(row.supplier_snapshot), customer: object(row.customer_snapshot),
      configurationSnapshotId: row.configuration_id, configurationSha256: row.configuration_sha256,
      configurationSnapshot: object(row.configuration_snapshot),
      lines: lineRows.map(line => ({
        lineNumber: Number(line.line_number), lineKind: line.line_kind, description: line.description, unitCode: line.unit_code,
        quantity: String(line.quantity), unitPrice: String(line.unit_price), discountType: line.discount_type,
        discountValue: String(line.discount_value), discountAmount: String(line.discount_amount),
        taxRate: String(line.tax_rate), taxCode: line.tax_code, taxCalculationMode: line.tax_calculation_mode,
        taxAmount: String(line.tax_amount), lineTotal: String(line.line_total),
      })),
    };
    return captureDocumentContentSnapshot(conn, {
      sourceType, sourceDocumentId: row.id, legalEntityId: row.legal_entity_id, documentNumber: row.quotation_number,
      configurationSnapshotId: row.configuration_id, captureReason: reason, content, actorId,
    });
  }

  const [rows] = await conn.execute<(RowDataPacket & {
    id: string; legal_entity_id: string | null; receipt_reference: string | null; status: string; currency: string;
    amount: string; payment_date: Date | string; method: string; reference: string | null; notes: string | null;
    reversed_at: Date | string | null; reversal_reason: string | null; customer_snapshot: unknown; legal_entity_snapshot: unknown;
  })[]>(
    "SELECT id,legal_entity_id,receipt_reference,status,currency,amount,payment_date,method,reference,notes,reversed_at,reversal_reason,customer_snapshot,legal_entity_snapshot FROM payments WHERE id=? LIMIT 1 FOR UPDATE",
    [sourceId],
  );
  const row = rows[0];
  if (!row || !row.legal_entity_id || !row.receipt_reference || !["RECORDED", "REVERSED"].includes(row.status) || !row.customer_snapshot || !row.legal_entity_snapshot) {
    throw new DocumentWorkflowError("DOCUMENT_SOURCE_NOT_READY", 409, "This receipt is not ready for PDF generation.");
  }
  const receiptAmount = amount(row.amount);
  const content = {
    schemaVersion: 1, captureReason: reason, sourceType, sourceDocumentId: row.id,
    documentNumber: row.receipt_reference, lifecycleStatus: row.status,
    documentDate: dateText(row.payment_date), dueDate: null, validUntil: null, currency: row.currency,
    subtotal: receiptAmount, discountTotal: "0.0000", taxTotal: "0.0000", grandTotal: receiptAmount,
    paidAmount: "0.0000", paymentStatus: row.status, notes: row.notes, method: row.method,
    reference: row.reference, reversedAt: row.reversed_at instanceof Date ? row.reversed_at.toISOString() : row.reversed_at ? String(row.reversed_at) : null, reversalReason: row.reversal_reason,
    supplier: object(row.legal_entity_snapshot), customer: object(row.customer_snapshot),
    configurationSnapshotId: null, configurationSha256: null, configurationSnapshot: null, lines: [],
  };
  return captureDocumentContentSnapshot(conn, {
    sourceType, sourceDocumentId: row.id, legalEntityId: row.legal_entity_id, documentNumber: row.receipt_reference,
    configurationSnapshotId: null, captureReason: reason, content, actorId,
  });
}

function summary(row: GeneratedRow) {
  return {
    id: row.id, contentSnapshotId: row.content_snapshot_id, sourceType: row.source_document_type,
    sourceDocumentId: row.source_document_id, legalEntityId: row.legal_entity_id,
    documentNumber: row.document_number, mimeType: row.mime_type, byteSize: row.byte_size === null ? null : Number(row.byte_size),
    fileSha256: row.file_sha256, status: row.status, generationAttempts: Number(row.generation_attempts),
    lastErrorCode: row.last_error_code, createdBy: row.created_by, createdAt: row.created_at, readyAt: row.ready_at,
  };
}

async function markGenerationFailed(documentId: string, token: string, actorId: string, code: string): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<(RowDataPacket & { status: string; generation_token: string | null })[]>(
      "SELECT status,generation_token FROM generated_documents WHERE id=? LIMIT 1 FOR UPDATE", [documentId],
    );
    if (rows.length && rows[0].status === "PENDING" && rows[0].generation_token === token) {
      await conn.execute(
        "UPDATE generated_documents SET status='FAILED',last_error_code=?,generation_started_at=NULL,generation_token=NULL,updated_at=NOW(3) WHERE id=? AND status='PENDING' AND generation_token=?",
        [code, documentId, token],
      );
      await event(conn, documentId, "FAILED", "PENDING", "FAILED", actorId, code);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally { conn.release(); }
}

export async function generateDocumentPdf(sourceType: DocumentSourceType, sourceId: string, actorId: string, forceNew = false) {
  let snapshot: SnapshotRow;
  let pending: GeneratedRow;
  let token: string;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sources] = await conn.execute<(RowDataPacket & SourceMeta)[]>(
      sourceType === "INVOICE"
        ? "SELECT id,legal_entity_id,invoice_number AS document_number,lifecycle_status AS status FROM invoices WHERE id=? AND document_type='INVOICE' AND lifecycle_status IN ('ISSUED','CANCELLED') AND invoice_number IS NOT NULL LIMIT 1 FOR UPDATE"
        : sourceType === "QUOTATION"
          ? "SELECT id,legal_entity_id,quotation_number AS document_number,status FROM quotations WHERE id=? AND status<>'DRAFT' AND quotation_number IS NOT NULL LIMIT 1 FOR UPDATE"
          : "SELECT id,legal_entity_id,receipt_reference AS document_number,status FROM payments WHERE id=? AND legal_entity_id IS NOT NULL AND receipt_reference IS NOT NULL AND status IN ('RECORDED','REVERSED') LIMIT 1 FOR UPDATE",
      [sourceId],
    );
    if (!sources.length) throw new DocumentWorkflowError("DOCUMENT_SOURCE_NOT_READY", 404, "This financial document is unavailable for PDF generation.");
    const source = sources[0];
    const [snapshotRows] = await conn.execute<SnapshotRow[]>(
      "SELECT id,source_document_type,source_document_id,legal_entity_id,document_number,revision_number,content_json,content_sha256,captured_at FROM document_content_snapshots WHERE source_document_type=? AND source_document_id=? ORDER BY revision_number DESC LIMIT 1 FOR UPDATE",
      [sourceType, sourceId],
    );
    if (snapshotRows.length) {
      snapshot = snapshotRows[0];
    } else {
      await captureDocumentSourceSnapshot(conn, sourceType, sourceId, actorId, "LEGACY_BACKFILL");
      const [createdRows] = await conn.execute<SnapshotRow[]>(
        "SELECT id,source_document_type,source_document_id,legal_entity_id,document_number,revision_number,content_json,content_sha256,captured_at FROM document_content_snapshots WHERE source_document_type=? AND source_document_id=? ORDER BY revision_number DESC LIMIT 1 FOR UPDATE",
        [sourceType, sourceId],
      );
      if (!createdRows.length) throw new DocumentWorkflowError("DOCUMENT_SNAPSHOT_UNAVAILABLE", 409, "A document content snapshot could not be created.");
      snapshot = createdRows[0];
    }
    const snapshotContent = object(snapshot.content_json);
    if (snapshot.source_document_type !== sourceType || snapshot.source_document_id !== sourceId ||
        snapshot.legal_entity_id !== source.legal_entity_id || snapshot.document_number !== source.document_number ||
        snapshotContent.sourceType !== sourceType || snapshotContent.sourceDocumentId !== sourceId ||
        snapshotContent.documentNumber !== source.document_number) {
      throw new DocumentWorkflowError("DOCUMENT_SNAPSHOT_INVALID", 409, "The stored content snapshot does not match its source financial document.");
    }
    // Native source snapshots use the application's canonical JSON hash. Legacy SQL backfills
    // are explicitly labelled because MySQL's JSON serialization differs from the canonical form.
    if (snapshotContent.captureReason !== "LEGACY_BACKFILL") {
      const canonicalHash = createHash("sha256").update(canonicalDocumentJson(snapshotContent)).digest("hex");
      if (canonicalHash !== snapshot.content_sha256) {
        throw new DocumentWorkflowError("DOCUMENT_INTEGRITY_FAILURE", 409, "The stored source snapshot failed its SHA-256 verification.");
      }
    }

    const [existingRows] = await conn.execute<GeneratedRow[]>(
      "SELECT id,content_snapshot_id,source_document_type,source_document_id,legal_entity_id,document_number,storage_key,mime_type,byte_size,file_sha256,status,generation_attempts,last_error_code,created_by,created_at,ready_at,generation_started_at,generation_token,TIMESTAMPDIFF(SECOND,generation_started_at,NOW(3)) AS lease_age_seconds FROM generated_documents WHERE content_snapshot_id=? ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [snapshot.id],
    );
    const latest = existingRows[0];
    if (latest?.status === "READY" && !forceNew) {
      await conn.commit();
      return { ...summary(latest), reused: true };
    }
    if (latest?.status === "PENDING" && latest.lease_age_seconds !== null && Number(latest.lease_age_seconds ?? 0) < 300) {
      await conn.commit();
      return { ...summary(latest), reused: true };
    }
    if (latest?.status === "PENDING") {
      await conn.execute(
        "UPDATE generated_documents SET status='FAILED',last_error_code='GENERATION_LEASE_EXPIRED',generation_started_at=NULL,generation_token=NULL,updated_at=NOW(3) WHERE id=? AND status='PENDING'",
        [latest.id],
      );
      await event(conn, latest.id, "FAILED", "PENDING", "FAILED", actorId, "GENERATION_LEASE_EXPIRED");
    }
    const documentId = randomUUID();
    token = randomUUID();
    const attempts = Number(latest?.generation_attempts ?? 0) + 1;
    const storageKey = "documents/" + source.legal_entity_id + "/" + sourceType.toLowerCase() + "/" + sourceId + "/" + snapshot.id + "-" + documentId + ".pdf";
    await conn.execute(
      "INSERT INTO generated_documents (id,content_snapshot_id,source_document_type,source_document_id,legal_entity_id,document_number,storage_key,mime_type,status,generation_attempts,created_by,generation_started_at,generation_token) VALUES (?,?,?,?,?,?,?,'application/pdf','PENDING',?,?,NOW(3),?)",
      [documentId, snapshot.id, sourceType, sourceId, source.legal_entity_id, source.document_number, storageKey, attempts, actorId, token],
    );
    await event(conn, documentId, latest?.status === "FAILED" ? "RETRY_STARTED" : "REQUESTED", null, "PENDING", actorId,
      latest?.status === "READY" && forceNew ? "MANUAL_REGENERATION" : latest?.status === "FAILED" ? "RETRY" : "INITIAL_GENERATION",
      { contentSha256: snapshot.content_sha256, revisionNumber: Number(snapshot.revision_number) });
    const [newRows] = await conn.execute<GeneratedRow[]>(
      "SELECT id,content_snapshot_id,source_document_type,source_document_id,legal_entity_id,document_number,storage_key,mime_type,byte_size,file_sha256,status,generation_attempts,last_error_code,created_by,created_at,ready_at,generation_started_at,generation_token FROM generated_documents WHERE id=? LIMIT 1",
      [documentId],
    );
    if (!newRows.length) throw new DocumentWorkflowError("DOCUMENT_GENERATION_FAILED", 500, "The document generation request could not be recorded.");
    pending = newRows[0];
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally { conn.release(); }

  let generationStage = "render";
  try {
    const content = object(snapshot.content_json) as unknown as PdfSnapshot;
    const pdf = await renderDocumentPdf(content, snapshot.captured_at);
    const fileSha256 = createHash("sha256").update(pdf).digest("hex");
    generationStage = "store";
    const stored = await putPrivateObject(pending.storage_key, pdf, fileSha256);
    generationStage = "read-back";
    const readBack = await getPrivateObject(pending.storage_key);
    if (readBack.length !== stored.byteSize || createHash("sha256").update(readBack).digest("hex") !== fileSha256) {
      throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE", "The stored PDF did not match the generated PDF.");
    }
    generationStage = "metadata";
    const verify = await headPrivateObject(pending.storage_key);
    if (verify.byteSize !== pdf.length || verify.sha256 !== fileSha256) {
      throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE", "The stored PDF metadata did not match the generated PDF.");
    }
    generationStage = "mark-ready";
    const finish = await pool.getConnection();
    try {
      await finish.beginTransaction();
      const [latestRows] = await finish.execute<(RowDataPacket & { status: string; generation_token: string | null })[]>(
        "SELECT status,generation_token FROM generated_documents WHERE id=? LIMIT 1 FOR UPDATE", [pending.id],
      );
      if (!latestRows.length || latestRows[0].status !== "PENDING" || latestRows[0].generation_token !== token) {
        await finish.rollback();
        throw new DocumentWorkflowError("DOCUMENT_GENERATION_LEASE_LOST", 409, "This generation attempt was superseded; retry from document history.");
      }
      await finish.execute(
        "UPDATE generated_documents SET status='READY',byte_size=?,file_sha256=?,last_error_code=NULL,ready_at=NOW(3),generation_started_at=NULL,generation_token=NULL,updated_at=NOW(3) WHERE id=? AND status='PENDING' AND generation_token=?",
        [pdf.length, fileSha256, pending.id, token],
      );
      await event(finish, pending.id, "READY", "PENDING", "READY", actorId, null, { byteSize: pdf.length, fileSha256 });
      await finish.commit();
    } catch (error) {
      await finish.rollback().catch(() => undefined);
      throw error;
    } finally { finish.release(); }
  } catch (error) {
    const code = safeStorageError(error);
    // Keep observability useful without logging financial content, object keys or raw provider errors.
    console.error("Document PDF generation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: code,
      sourceType,
      stage: generationStage,
    });
    await markGenerationFailed(pending.id, token, actorId, code).catch(() => undefined);
    if (error instanceof DocumentWorkflowError) throw error;
    throw new DocumentWorkflowError(code, 503, "The PDF could not be generated or stored. Review document history and retry.");
  }

  const [readyRows] = await pool.execute<GeneratedRow[]>(
    "SELECT id,content_snapshot_id,source_document_type,source_document_id,legal_entity_id,document_number,storage_key,mime_type,byte_size,file_sha256,status,generation_attempts,last_error_code,created_by,created_at,ready_at,generation_started_at,generation_token FROM generated_documents WHERE id=? LIMIT 1",
    [pending.id],
  );
  if (!readyRows.length || readyRows[0].status !== "READY") throw new DocumentWorkflowError("DOCUMENT_GENERATION_FAILED", 503, "The PDF was not marked ready after storage verification.");
  return { ...summary(readyRows[0]), reused: false };
}

export async function listGeneratedDocumentHistory(sourceType: DocumentSourceType, sourceId: string) {
  const [rows] = await pool.execute<GeneratedRow[]>(
    "SELECT id,content_snapshot_id,source_document_type,source_document_id,legal_entity_id,document_number,storage_key,mime_type,byte_size,file_sha256,status,generation_attempts,last_error_code,created_by,created_at,ready_at,generation_started_at,generation_token FROM generated_documents WHERE source_document_type=? AND source_document_id=? ORDER BY created_at DESC,id DESC LIMIT 25",
    [sourceType, sourceId],
  );
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [events] = await pool.execute<(RowDataPacket & {
    id: string; generated_document_id: string; event_type: string; previous_status: string | null;
    new_status: string; actor_id: string | null; reason: string | null; metadata_json: unknown; created_at: Date | string;
  })[]>(
    "SELECT id,generated_document_id,event_type,previous_status,new_status,actor_id,reason,metadata_json,created_at FROM generated_document_events WHERE generated_document_id IN (" + ids.map(() => "?").join(",") + ") ORDER BY created_at,id",
    ids,
  );
  const eventsByDocument = new Map<string, unknown[]>();
  for (const item of events) {
    const current = eventsByDocument.get(item.generated_document_id) ?? [];
    current.push({
      type: item.event_type, previousStatus: item.previous_status, status: item.new_status,
      actorId: item.actor_id, reason: item.reason, metadata: parseJson(item.metadata_json), createdAt: item.created_at,
    });
    eventsByDocument.set(item.generated_document_id, current);
  }
  return rows.map(row => ({ ...summary(row), events: eventsByDocument.get(row.id) ?? [] }));
}

export async function downloadGeneratedDocument(documentId: string, actorId: string | null, recordDownloadEvent = true) {
  const [rows] = await pool.execute<GeneratedRow[]>(
    "SELECT id,content_snapshot_id,source_document_type,source_document_id,legal_entity_id,document_number,storage_key,mime_type,byte_size,file_sha256,status,generation_attempts,last_error_code,created_by,created_at,ready_at,generation_started_at,generation_token FROM generated_documents WHERE id=? LIMIT 1",
    [documentId],
  );
  const row = rows[0];
  if (!row || row.status !== "READY" || !row.file_sha256 || !row.byte_size) {
    throw new DocumentWorkflowError("DOCUMENT_NOT_READY", 404, "The requested document is not available.");
  }
  try {
    const [head, bytes] = await Promise.all([headPrivateObject(row.storage_key), getPrivateObject(row.storage_key)]);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (head.byteSize !== Number(row.byte_size) || head.sha256 !== row.file_sha256 ||
        bytes.length !== Number(row.byte_size) || actual !== row.file_sha256) {
      throw new PrivateStorageError("DOCUMENT_INTEGRITY_FAILURE", "Stored document integrity validation failed.");
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await event(conn, row.id, recordDownloadEvent ? "DOWNLOADED" : "EMAIL_ATTACHMENT_VERIFIED", "READY", "READY", actorId, null,
        { fileSha256: row.file_sha256, accessPurpose: recordDownloadEvent ? "USER_DOWNLOAD" : "EMAIL_ATTACHMENT" });
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => undefined);
      throw error;
    } finally { conn.release(); }
    return { bytes, documentNumber: row.document_number, sourceType: row.source_document_type, mimeType: row.mime_type, fileSha256: row.file_sha256 };
  } catch (error) {
    if (error instanceof PrivateStorageError && error.code === "DOCUMENT_INTEGRITY_FAILURE") {
      const conn = await pool.getConnection();
      try {
        await event(conn, row.id, "INTEGRITY_FAILURE", "READY", "READY", actorId, error.code, { fileSha256: row.file_sha256 });
      } finally { conn.release(); }
    }
    if (error instanceof DocumentWorkflowError) throw error;
    throw new DocumentWorkflowError(safeStorageError(error), 503, "This PDF failed storage-integrity verification and cannot be downloaded.");
  }
}
