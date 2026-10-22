import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "@/lib/db/pool";
import { generateDocumentPdf, downloadGeneratedDocument, type DocumentSourceType } from "@/lib/documents/service";

export type EmailSourceType = "INVOICE" | "QUOTATION" | "RECEIPT";
export type EmailOutboxStatus = "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "DELIVERY_DELAYED" | "BOUNCED" | "COMPLAINED" | "FAILED" | "REQUIRES_REVIEW";

export class EmailWorkflowError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "EmailWorkflowError";
  }
}

type SourceRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  document_number: string;
  status: string;
  currency: string;
  grand_total: string | number;
  due_date: Date | string | null;
};

type SnapshotRow = RowDataPacket & {
  id: string;
  source_document_type: EmailSourceType;
  source_document_id: string;
  legal_entity_id: string;
  document_number: string;
  content_json: unknown;
};

type OutboxRow = RowDataPacket & {
  id: string;
  request_idempotency_key: string;
  request_payload_sha256: string;
  legal_entity_id: string;
  source_document_type: EmailSourceType;
  source_document_id: string;
  content_snapshot_id: string | null;
  generated_document_id: string | null;
  document_number: string;
  message_kind: "DOCUMENT" | "OVERDUE_REMINDER";
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  html_body: string;
  text_body: string;
  attachment_sha256: string | null;
  attachment_byte_size: number | string | null;
  provider_idempotency_key: string;
  provider_message_id: string | null;
  status: EmailOutboxStatus;
  attempt_count: number;
  next_attempt_at: Date | string | null;
  last_attempt_at: Date | string | null;
  last_error_code: string | null;
  lease_token: string | null;
  lease_until: Date | string | null;
  reminder_dedupe_key: string | null;
  reminder_policy_version: number | null;
  requested_by: string | null;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
function object(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}
function isEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}
function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function dateOnly(value: Date | string | null): string | null {
  if (value == null || value === "") return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function safeColor(value: unknown): string {
  const candidate = text(value);
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : "#253d63";
}
function providerConfig(): { apiKey: string; from: string; baseUrl: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
  const baseUrl = (process.env.RESEND_API_URL?.trim() || "https://api.resend.com").replace(/\/+$/, "");
  if (!apiKey || !from || from.length > 320 || /[\r\n]/.test(from)) {
    throw new EmailWorkflowError("EMAIL_PROVIDER_NOT_CONFIGURED", 503, "Outbound email is not configured. Set the provider API key and verified sender.");
  }
  if (process.env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) {
    throw new EmailWorkflowError("EMAIL_PROVIDER_NOT_CONFIGURED", 503, "Outbound email must use the provider HTTPS endpoint.");
  }
  return { apiKey, from, baseUrl };
}
function sourcePermissionCheckStatus(sourceType: EmailSourceType, status: string): boolean {
  if (sourceType === "INVOICE") return status === "ISSUED";
  if (sourceType === "QUOTATION") return status === "SENT" || status === "ACCEPTED";
  return status === "RECORDED";
}
function template(sourceType: EmailSourceType, documentNumber: string, recipientName: string, issuerName: string, brandName: string, color: string, currency: string, total: string, dueDate: string | null, isReminder: boolean, overdueDays = 0, outstanding = "") {
  const kind = sourceType === "INVOICE" ? "Invoice" : sourceType === "QUOTATION" ? "Quotation" : "Payment receipt";
  const greeting = recipientName ? "Hello " + recipientName + "," : "Hello,";
  const title = isReminder ? "Payment reminder for " + documentNumber : kind + " " + documentNumber;
  const totalLabel = isReminder ? "Outstanding balance" : sourceType === "RECEIPT" ? "Receipt amount" : "Document total";
  const shownAmount = isReminder ? outstanding : total;
  const dateLabel = sourceType === "QUOTATION" ? "Valid until" : sourceType === "RECEIPT" ? "Payment date" : "Due date";
  const dueLine = dueDate ? dateLabel + ": " + dueDate : "";
  const reminderLine = isReminder
    ? "Our records show an outstanding balance of " + shownAmount + " " + currency + " for invoice " + documentNumber + ". It is " + overdueDays + " day(s) overdue. If you have already paid, please contact us so we can reconcile the account."
    : sourceType === "QUOTATION"
      ? "Please review the attached quotation. This email does not change the quotation's recorded status."
      : sourceType === "RECEIPT"
        ? "Your payment receipt is attached for your records."
        : "Your invoice is attached for your records.";
  const safeIssuer = htmlEscape(issuerName || "Falchion Xeniaa");
  const safeBrand = htmlEscape(brandName || issuerName || "Falchion Xeniaa");
  const safeTitle = htmlEscape(title);
  const safeGreeting = htmlEscape(greeting);
  const safeBody = htmlEscape(reminderLine);
  const safeDue = htmlEscape(dueLine);
  const safeTotal = htmlEscape(shownAmount + " " + currency);
  const html = '<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:24px auto;padding:28px;background:#fff;border-radius:12px;border-top:5px solid ' + color + '"><p style="color:' + color + ';font-size:12px;font-weight:700;letter-spacing:1px">' + safeBrand + '</p><h1 style="font-size:22px">' + safeTitle + '</h1><p>' + safeGreeting + '</p><p>' + safeBody + '</p><table role="presentation" style="width:100%;border-collapse:collapse;margin:24px 0"><tr><td style="padding:12px;background:#f5f7fa">' + htmlEscape(totalLabel) + '</td><td style="padding:12px;background:#f5f7fa;text-align:right;font-weight:700">' + safeTotal + '</td></tr>' + (safeDue ? '<tr><td style="padding:12px">' + htmlEscape(dateLabel) + '</td><td style="padding:12px;text-align:right">' + htmlEscape(dueDate ?? "") + '</td></tr>' : "") + '</table><p style="font-size:12px;color:#667085">For questions about this document, contact ' + safeIssuer + ' through your usual business contact channel.</p><p style="font-size:11px;color:#98a2b3">Automated financial document communication. Please do not reply with payment-card or account credentials.</p></div></body></html>';
  const bodyText = [greeting, "", reminderLine, "", totalLabel + ": " + shownAmount + " " + currency, dueLine, "", "Issuer: " + (issuerName || "Falchion Xeniaa"), "This email contains no internal notes."].filter(Boolean).join("\n");
  return { subject: title, html, text: bodyText };
}
function emailRow(row: OutboxRow) {
  return {
    id: row.id,
    sourceType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    legalEntityId: row.legal_entity_id,
    documentNumber: row.document_number,
    messageKind: row.message_kind,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    subject: row.subject,
    attachmentSha256: row.attachment_sha256,
    attachmentByteSize: row.attachment_byte_size == null ? null : Number(row.attachment_byte_size),
    providerMessageId: row.provider_message_id,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    lastErrorCode: row.last_error_code,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function appendEmailEvent(
  conn: PoolConnection,
  outboxId: string | null,
  eventType: string,
  previousStatus: string | null,
  newStatus: string | null,
  actorId: string | null,
  reasonCode: string | null,
  providerEventId: string | null = null,
  payloadSha256: string | null = null,
  metadata: Record<string, unknown> | null = null,
) {
  await conn.execute(
    "INSERT INTO email_outbox_events (id,email_outbox_id,event_type,previous_status,new_status,actor_id,provider_event_id,reason_code,payload_sha256,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [randomUUID(), outboxId, eventType, previousStatus, newStatus, actorId, providerEventId, reasonCode, payloadSha256, metadata ? JSON.stringify(metadata) : null],
  );
}
async function loadSource(sourceType: EmailSourceType, sourceId: string, requireSendable = true): Promise<SourceRow> {
  let rows: SourceRow[] = [];
  if (sourceType === "INVOICE") {
    const [result] = await pool.execute<SourceRow[]>(
      "SELECT id,legal_entity_id,invoice_number AS document_number,lifecycle_status AS status,currency,grand_total,due_date FROM invoices WHERE id=? AND document_type='INVOICE' LIMIT 1",
      [sourceId],
    );
    rows = result;
  } else if (sourceType === "QUOTATION") {
    const [result] = await pool.execute<SourceRow[]>(
      "SELECT id,legal_entity_id,quotation_number AS document_number,status,currency,grand_total,valid_until AS due_date FROM quotations WHERE id=? LIMIT 1",
      [sourceId],
    );
    rows = result;
  } else {
    const [result] = await pool.execute<SourceRow[]>(
      "SELECT id,legal_entity_id,receipt_reference AS document_number,status,currency,amount AS grand_total,payment_date AS due_date FROM payments WHERE id=? LIMIT 1",
      [sourceId],
    );
    rows = result;
  }
  if (!rows.length) throw new EmailWorkflowError("EMAIL_SOURCE_NOT_FOUND", 404, "The financial document is not available for email.");
  if (!rows[0].legal_entity_id || !rows[0].document_number ||
      (requireSendable && !sourcePermissionCheckStatus(sourceType, rows[0].status))) {
    throw new EmailWorkflowError("EMAIL_SOURCE_NOT_SENDABLE", 409, "Only active issued invoices, sent or accepted quotations, and recorded receipts can be emailed.");
  }
  return rows[0];
}
async function latestSnapshot(sourceType: EmailSourceType, sourceId: string): Promise<SnapshotRow> {
  const [rows] = await pool.execute<SnapshotRow[]>(
    "SELECT id,source_document_type,source_document_id,legal_entity_id,document_number,content_json FROM document_content_snapshots WHERE source_document_type=? AND source_document_id=? ORDER BY revision_number DESC LIMIT 1",
    [sourceType, sourceId],
  );
  if (!rows.length) throw new EmailWorkflowError("EMAIL_SNAPSHOT_UNAVAILABLE", 409, "An immutable document snapshot is required before email delivery.");
  return rows[0];
}
function idempotencyPayloadHash(input: { sourceType: EmailSourceType; sourceId: string; recipientEmail: string; reminderDedupeKey?: string | null }) {
  return sha256(JSON.stringify({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    reminderDedupeKey: input.reminderDedupeKey ?? null,
  }));
}
async function findExistingByKey(key: string, payloadHash: string): Promise<Record<string, unknown> | null> {
  const [rows] = await pool.execute<OutboxRow[]>("SELECT * FROM email_outbox WHERE request_idempotency_key=? LIMIT 1", [key]);
  if (!rows.length) return null;
  if (rows[0].request_payload_sha256 !== payloadHash) {
    throw new EmailWorkflowError("IDEMPOTENCY_KEY_REUSED", 409, "This idempotency key was already used for a different email request.");
  }
  return emailRow(rows[0]);
}

export async function getEmailSourcePreview(sourceType: EmailSourceType, sourceId: string) {
  const source = await loadSource(sourceType, sourceId, false);
  const snapshot = await latestSnapshot(sourceType, sourceId);
  const content = object(snapshot.content_json);
  const customer = object(content.customer);
  return {
    sourceType,
    sourceDocumentId: sourceId,
    legalEntityId: source.legal_entity_id,
    documentNumber: source.document_number,
    sourceStatus: source.status,
    defaultRecipientEmail: isEmail(text(customer.email)) ? text(customer.email).trim().toLowerCase() : "",
    recipientName: text(customer.name),
  };
}

export async function queueDocumentEmail(input: {
  sourceType: EmailSourceType;
  sourceId: string;
  actorId: string;
  recipientEmail: string;
  recipientConfirmed: boolean;
  idempotencyKey: string;
}) {
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) {
    throw new EmailWorkflowError("VALIDATION_ERROR", 422, "A UUID Idempotency-Key is required.");
  }
  if (!isEmail(recipientEmail)) throw new EmailWorkflowError("VALIDATION_ERROR", 422, "Enter a valid recipient email address.");
  if (input.recipientConfirmed !== true) throw new EmailWorkflowError("RECIPIENT_CONFIRMATION_REQUIRED", 422, "Confirm the recipient address before queueing email.");
  const payloadHash = idempotencyPayloadHash({ sourceType: input.sourceType, sourceId: input.sourceId, recipientEmail });
  const existing = await findExistingByKey(input.idempotencyKey, payloadHash);
  if (existing) return { ...existing, idempotentReplay: true };

  providerConfig();
  const source = await loadSource(input.sourceType, input.sourceId);
  const snapshot = await latestSnapshot(input.sourceType, input.sourceId);
  const content = object(snapshot.content_json);
  const customer = object(content.customer);
  // The snapshot email is a suggestion only. The caller has already validated and explicitly
  // confirmed the actual recipientEmail, so a legitimate override must not be blocked here.
  const pdfRecord = await generateDocumentPdf(input.sourceType as DocumentSourceType, input.sourceId, input.actorId, false);
  if (pdfRecord.status !== "READY" || !pdfRecord.id) {
    throw new EmailWorkflowError("DOCUMENT_GENERATION_PENDING", 409, "The verified PDF is still being prepared. Refresh the document history before sending email.");
  }
  if (pdfRecord.contentSnapshotId !== snapshot.id) {
    // Do not pair body text derived from one snapshot with a PDF generated from a different revision.
    throw new EmailWorkflowError("DOCUMENT_SNAPSHOT_CHANGED", 409, "The document changed while this email was being prepared. Refresh the document and retry.");
  }
  const pdf = await downloadGeneratedDocument(String(pdfRecord.id), input.actorId, false);
  const config = object(content.configurationSnapshot);
  const brand = object(config.brand);
  const templateConfig = object(object(config.template).config);
  const legalEntity = object(config.legalEntity);
  const brandName = text(brand.name ?? brand.displayName ?? brand.brandName);
  const issuerName = text(legalEntity.legalName ?? object(content.supplier).legalName ?? object(content.supplier).displayName);
  const color = safeColor(templateConfig.primaryColor ?? templateConfig.accentColor ?? brand.primaryColor);
  const total = text(content.grandTotal, String(source.grand_total));
  const dueDate = dateOnly(source.due_date);
  const message = template(input.sourceType, source.document_number, text(customer.name), issuerName, brandName, color,
    text(content.currency, source.currency), total, dueDate, false);
  const outboxId = randomUUID();
  const providerIdempotencyKey = "fx-email-" + outboxId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.execute<OutboxRow[]>(
      "SELECT * FROM email_outbox WHERE request_idempotency_key=? LIMIT 1 FOR UPDATE",
      [input.idempotencyKey],
    );
    if (existingRows.length) {
      await conn.rollback();
      if (existingRows[0].request_payload_sha256 !== payloadHash) throw new EmailWorkflowError("IDEMPOTENCY_KEY_REUSED", 409, "This idempotency key was already used for a different email request.");
      return { ...emailRow(existingRows[0]), idempotentReplay: true };
    }
    await conn.execute(
      "INSERT INTO email_outbox (id,request_idempotency_key,request_payload_sha256,legal_entity_id,source_document_type,source_document_id,content_snapshot_id,generated_document_id,document_number,message_kind,recipient_email,recipient_name,subject,html_body,text_body,attachment_sha256,attachment_byte_size,provider,provider_idempotency_key,status,attempt_count,next_attempt_at,requested_by) VALUES (?,?,?,?,?,?,?,?,?,'DOCUMENT',?,?,?,?,?,?,?,'RESEND',?,'QUEUED',0,NOW(3),?)",
      [outboxId,input.idempotencyKey,payloadHash,source.legal_entity_id,input.sourceType,input.sourceId,snapshot.id,String(pdfRecord.id),
        source.document_number,recipientEmail,text(customer.name) || null,message.subject,message.html,message.text,pdf.fileSha256,pdf.bytes.length,providerIdempotencyKey,input.actorId],
    );
    await appendEmailEvent(conn,outboxId,"QUEUED",null,"QUEUED",input.actorId,null,null,null,{sourceType:input.sourceType,attachmentSha256:pdf.fileSha256});
    const [rows] = await conn.execute<OutboxRow[]>("SELECT * FROM email_outbox WHERE id=? LIMIT 1",[outboxId]);
    await conn.commit();
    return { ...emailRow(rows[0]), idempotentReplay: false };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    const candidate = error as { code?: string };
    if (candidate?.code === "ER_DUP_ENTRY") {
      const raced = await findExistingByKey(input.idempotencyKey,payloadHash);
      if (raced) return { ...raced, idempotentReplay: true };
    }
    throw error;
  } finally { conn.release(); }
}

export async function listEmailOutbox(input: { legalEntityIds: string[]; sourceType?: EmailSourceType; sourceId?: string }) {
  if (!input.legalEntityIds.length) return [];
  const placeholders = input.legalEntityIds.map(() => "?").join(",");
  const params: string[] = [...input.legalEntityIds];
  let where = "legal_entity_id IN (" + placeholders + ")";
  if (input.sourceType) { where += " AND source_document_type=?"; params.push(input.sourceType); }
  if (input.sourceId) { where += " AND source_document_id=?"; params.push(input.sourceId); }
  const [rows] = await pool.execute<OutboxRow[]>(
    "SELECT * FROM email_outbox WHERE " + where + " ORDER BY created_at DESC,id DESC LIMIT 100",
    params,
  );
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [events] = await pool.execute<(RowDataPacket & {
    id: string; email_outbox_id: string; event_type: string; previous_status: string | null;
    new_status: string | null; reason_code: string | null; created_at: Date | string;
  })[]>(
    "SELECT id,email_outbox_id,event_type,previous_status,new_status,reason_code,created_at FROM email_outbox_events WHERE email_outbox_id IN (" + ids.map(() => "?").join(",") + ") ORDER BY created_at,id",
    ids,
  );
  const map = new Map<string, unknown[]>();
  for (const event of events) {
    const item = map.get(event.email_outbox_id) ?? [];
    item.push({ type:event.event_type, previousStatus:event.previous_status, status:event.new_status, reasonCode:event.reason_code, createdAt:event.created_at });
    map.set(event.email_outbox_id,item);
  }
  return rows.map(row => ({ ...emailRow(row), events: map.get(row.id) ?? [] }));
}

export async function retryFailedEmail(outboxId: string, actorId: string) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<OutboxRow[]>("SELECT * FROM email_outbox WHERE id=? LIMIT 1 FOR UPDATE",[outboxId]);
    if (!rows.length) throw new EmailWorkflowError("EMAIL_NOT_FOUND",404,"The email record is not available.");
    const row = rows[0];
    if (row.status !== "FAILED") {
      throw new EmailWorkflowError("EMAIL_NOT_RETRYABLE",409,"Only a confirmed failed email can be retried. Uncertain delivery requires provider review first.");
    }
    if (!row.attachment_sha256 && row.message_kind === "DOCUMENT") {
      throw new EmailWorkflowError("EMAIL_ATTACHMENT_UNAVAILABLE",409,"The original verified attachment is unavailable; queue a new email after repairing document storage.");
    }
    // An operator retry is allowed only after a confirmed FAILED outcome, never after an uncertain
    // network result. Give the intentional new attempt a fresh provider key while retaining the
    // original outbox/request idempotency key for API replay protection.
    const providerIdempotencyKey = "fx-email-" + randomUUID();
    await conn.execute("UPDATE email_outbox SET status='QUEUED',provider_idempotency_key=?,next_attempt_at=NOW(3),last_error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=NOW(3) WHERE id=? AND status='FAILED'",[providerIdempotencyKey,outboxId]);
    await appendEmailEvent(conn,outboxId,"MANUAL_RETRY","FAILED","QUEUED",actorId,"OPERATOR_RETRY");
    const [updated] = await conn.execute<OutboxRow[]>("SELECT * FROM email_outbox WHERE id=? LIMIT 1",[outboxId]);
    await conn.commit();
    return emailRow(updated[0]);
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally { conn.release(); }
}

function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
function retryDelaySeconds(attempt: number): number {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, attempt - 1)));
}
async function finishAttempt(row: OutboxRow, token: string, status: EmailOutboxStatus, errorCode: string | null, providerMessageId: string | null = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [current] = await conn.execute<(RowDataPacket & { status: string; lease_token: string | null; attempt_count: number })[]>(
      "SELECT status,lease_token,attempt_count FROM email_outbox WHERE id=? LIMIT 1 FOR UPDATE",[row.id],
    );
    if (!current.length || current[0].lease_token !== token || current[0].status !== "SENDING") {
      await conn.rollback();
      return;
    }
    const previous = current[0].status;
    await conn.execute(
      "UPDATE email_outbox SET status=?,provider_message_id=COALESCE(?,provider_message_id),sent_at=CASE WHEN ?='SENT' THEN COALESCE(sent_at,NOW(3)) ELSE sent_at END,last_error_code=?,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=NOW(3) WHERE id=? AND lease_token=?",
      [status,providerMessageId,status,errorCode,row.id,token],
    );
    await appendEmailEvent(conn,row.id,status === "QUEUED" ? "RETRY_SCHEDULED" : status === "SENT" ? "PROVIDER_ACCEPTED" : status === "REQUIRES_REVIEW" ? "DELIVERY_REQUIRES_REVIEW" : "ATTEMPT_FAILED",
      previous,status,null,errorCode);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally { conn.release(); }
}

async function recheckReminder(row: OutboxRow): Promise<boolean> {
  if (row.message_kind !== "OVERDUE_REMINDER") return true;
  if (row.reminder_policy_version == null || !row.legal_entity_id) return false;
  const [policies] = await pool.execute<(RowDataPacket & { id: string })[]>(
    "SELECT id FROM overdue_reminder_policies WHERE legal_entity_id=? AND version_number=? AND status='ACTIVE' LIMIT 1",
    [row.legal_entity_id,row.reminder_policy_version],
  );
  if (!policies.length) return false;
  const [invoices] = await pool.execute<(RowDataPacket & { lifecycle_status: string; due_date: Date | string | null; currency: string; grand_total: string | number; paid_total: string | number; time_zone: string })[]>(
    "SELECT i.lifecycle_status,i.due_date,i.currency,i.grand_total,COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'),0) AS paid_total,le.time_zone FROM invoices i JOIN legal_entities le ON le.id=i.legal_entity_id WHERE i.id=? AND i.legal_entity_id=? AND i.document_type='INVOICE' LIMIT 1",
    [row.source_document_id,row.legal_entity_id],
  );
  const invoice = invoices[0];
  if (!invoice || invoice.lifecycle_status !== "ISSUED" || !invoice.due_date) return false;
  const outstanding = toUnits(invoice.grand_total) - toUnits(invoice.paid_total);
  if (outstanding <= 0n) return false;
  const timezone = text(invoice.time_zone,"UTC");
  const today = localDate(new Date(),timezone);
  const due = dateOnly(invoice.due_date);
  return !!due && due < today;
}
function toUnits(value: unknown): bigint {
  const raw = String(value ?? "0");
  if (!/^(0|[1-9][0-9]{0,14})(?:\.[0-9]{1,4})?$/.test(raw)) return 0n;
  const parts = raw.split(".");
  return BigInt(parts[0]) * 10000n + BigInt(((parts[1] ?? "") + "0000").slice(0,4));
}
function fromUnits(value: bigint): string {
  return (value / 10000n).toString() + "." + (value % 10000n).toString().padStart(4,"0");
}
function localDate(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
    const part = (kind: string) => parts.find(item => item.type === kind)?.value ?? "";
    return part("year") + "-" + part("month") + "-" + part("day");
  } catch { return ""; }
}
function dayDifference(earlier: string, later: string): number {
  const a = new Date(earlier + "T00:00:00Z").getTime();
  const b = new Date(later + "T00:00:00Z").getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.floor((b - a) / 86400000) : -1;
}

export async function processEmailOutboxBatch(limit = 3): Promise<{ claimed: number; sentToProvider: number; deferred: number; failed: number; review: number }> {
  const config = providerConfig();
  const max = Math.max(1,Math.min(5,Math.floor(limit)));
  const counts = { claimed:0,sentToProvider:0,deferred:0,failed:0,review:0 };
  for (let index=0; index<max; index++) {
    const conn = await pool.getConnection();
    let row: OutboxRow | undefined;
    let token = "";
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<OutboxRow[]>(
        "SELECT * FROM email_outbox WHERE (status='QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at<=NOW(3))) OR (status='SENDING' AND lease_until<NOW(3)) ORDER BY COALESCE(next_attempt_at,created_at),created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      row = rows[0];
      if (!row) { await conn.commit(); break; }
      token = randomUUID();
      if (Date.now() - new Date(row.created_at).getTime() > 20 * 60 * 60 * 1000) {
        await conn.execute("UPDATE email_outbox SET status='REQUIRES_REVIEW',last_error_code='IDEMPOTENCY_WINDOW_EXPIRED',lease_token=NULL,lease_until=NULL,updated_at=NOW(3) WHERE id=?",[row.id]);
        await appendEmailEvent(conn,row.id,"DELIVERY_REQUIRES_REVIEW",row.status,"REQUIRES_REVIEW",null,"IDEMPOTENCY_WINDOW_EXPIRED");
        await conn.commit();
        counts.review++;
        continue;
      }
      const previous = row.status;
      await conn.execute(
        "UPDATE email_outbox SET status='SENDING',attempt_count=attempt_count+1,last_attempt_at=NOW(3),lease_token=?,lease_until=DATE_ADD(NOW(3),INTERVAL 45 SECOND),updated_at=NOW(3) WHERE id=?",
        [token,row.id],
      );
      await appendEmailEvent(conn,row.id,"ATTEMPT_STARTED",previous,"SENDING",null,null);
      await conn.commit();
      counts.claimed++;
    } catch (error) {
      await conn.rollback().catch(() => undefined);
      throw error;
    } finally { conn.release(); }
    if (!row) continue;

    try {
      if (!(await recheckReminder(row))) {
        await finishAttempt(row,token,"FAILED","REMINDER_NO_LONGER_DUE");
        counts.failed++;
        continue;
      }
      const payload: Record<string,unknown> = {
        from: config.from,
        to: [row.recipient_email],
        subject: row.subject,
        html: row.html_body,
        text: row.text_body,
        tags: [{ name:"fx-outbox-id",value:row.id }],
      };
      if (row.generated_document_id) {
        const pdf = await downloadGeneratedDocument(row.generated_document_id,null,false);
        if (!row.attachment_sha256 || pdf.fileSha256 !== row.attachment_sha256 ||
            (row.attachment_byte_size != null && pdf.bytes.length !== Number(row.attachment_byte_size))) {
          await finishAttempt(row,token,"FAILED","ATTACHMENT_INTEGRITY_FAILURE");
          counts.failed++;
          continue;
        }
        const filename = row.document_number.replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,100) + ".pdf";
        payload.attachments = [{ filename, content:pdf.bytes.toString("base64"), content_type:"application/pdf" }];
      }
      const response = await fetch(config.baseUrl + "/emails",{
        method:"POST",
        headers:{
          Authorization:"Bearer " + config.apiKey,
          "Content-Type":"application/json",
          "Idempotency-Key":row.provider_idempotency_key,
        },
        body:JSON.stringify(payload),
        signal:AbortSignal.timeout(12000),
      });
      let responseBody: Record<string,unknown> = {};
      try { responseBody = object(await response.json()); } catch { responseBody = {}; }
      if (response.ok && typeof responseBody.id === "string") {
        await finishAttempt(row,token,"SENT",null,responseBody.id);
        counts.sentToProvider++;
      } else if (isRetryableHttp(response.status) && Number(row.attempt_count) + 1 < 5) {
        const delay = retryDelaySeconds(Number(row.attempt_count));
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [current] = await conn.execute<(RowDataPacket & { status:string;lease_token:string|null })[]>("SELECT status,lease_token FROM email_outbox WHERE id=? LIMIT 1 FOR UPDATE",[row.id]);
          if (current.length && current[0].status==="SENDING" && current[0].lease_token===token) {
            await conn.execute("UPDATE email_outbox SET status='QUEUED',last_error_code=?,next_attempt_at=DATE_ADD(NOW(3),INTERVAL ? SECOND),lease_token=NULL,lease_until=NULL,updated_at=NOW(3) WHERE id=?",
              ["PROVIDER_HTTP_" + response.status,delay,row.id]);
            await appendEmailEvent(conn,row.id,"RETRY_SCHEDULED","SENDING","QUEUED",null,"PROVIDER_HTTP_" + response.status);
          }
          await conn.commit();
        } catch(error) { await conn.rollback().catch(()=>undefined); throw error; } finally { conn.release(); }
        counts.deferred++;
      } else {
        await finishAttempt(row,token,"FAILED","PROVIDER_HTTP_" + response.status);
        counts.failed++;
      }
    } catch (error) {
      const retrySafe = Number(row.attempt_count) + 1 < 5 && Date.now() - new Date(row.created_at).getTime() < 20 * 60 * 60 * 1000;
      if (retrySafe) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [current] = await conn.execute<(RowDataPacket & { status:string;lease_token:string|null })[]>("SELECT status,lease_token FROM email_outbox WHERE id=? LIMIT 1 FOR UPDATE",[row.id]);
          if (current.length && current[0].status==="SENDING" && current[0].lease_token===token) {
            await conn.execute("UPDATE email_outbox SET status='QUEUED',last_error_code='PROVIDER_NETWORK_UNCERTAIN',next_attempt_at=DATE_ADD(NOW(3),INTERVAL ? SECOND),lease_token=NULL,lease_until=NULL,updated_at=NOW(3) WHERE id=?",
              [retryDelaySeconds(Number(row.attempt_count)),row.id]);
            await appendEmailEvent(conn,row.id,"RETRY_SCHEDULED","SENDING","QUEUED",null,"PROVIDER_NETWORK_UNCERTAIN");
          }
          await conn.commit();
        } catch(finishError) { await conn.rollback().catch(()=>undefined); throw finishError; } finally { conn.release(); }
        counts.deferred++;
      } else {
        await finishAttempt(row,token,"REQUIRES_REVIEW","PROVIDER_OUTCOME_UNCERTAIN");
        counts.review++;
      }
      console.warn("Email delivery attempt did not complete",{
        outboxId:row.id,
        errorName:error instanceof Error?error.name:"UnknownError",
        disposition:retrySafe?"RETRY_SCHEDULED":"REQUIRES_REVIEW",
      });
    }
  }
  return counts;
}

export async function scheduleOverdueReminderEmails(limit = 100): Promise<{ policies: number; scanned: number; queued: number; skipped: number }> {
  providerConfig();
  const max = Math.max(1,Math.min(250,Math.floor(limit)));
  const [policies] = await pool.execute<(RowDataPacket & {
    id:string;legal_entity_id:string;version_number:number;first_reminder_after_days:number;max_reminders:number;interval_days:number;requested_by:string;approved_by:string;time_zone:string;
  })[]>(
    "SELECT p.id,p.legal_entity_id,p.version_number,p.first_reminder_after_days,p.max_reminders,p.interval_days,p.requested_by,p.approved_by,le.time_zone FROM overdue_reminder_policies p JOIN legal_entities le ON le.id=p.legal_entity_id WHERE p.status='ACTIVE' ORDER BY p.updated_at,p.id LIMIT " + max,
  );
  const stats = {policies:policies.length,scanned:0,queued:0,skipped:0};
  for (const policy of policies) {
    const timezone = text(policy.time_zone,"UTC");
    const today = localDate(new Date(),timezone);
    if (!today) { stats.skipped++; continue; }
    const candidateLimit = Math.max(1,Math.min(500,max));
    const [invoices] = await pool.execute<(RowDataPacket & {
      id:string;invoice_number:string;due_date:Date|string;currency:string;grand_total:string|number;paid_total:string|number;customer_snapshot:unknown;document_number:string;status:string;
    })[]>(
      "SELECT i.id,i.invoice_number,i.due_date,i.currency,i.grand_total,i.customer_snapshot,i.invoice_number AS document_number,i.lifecycle_status AS status,COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'),0) AS paid_total FROM invoices i WHERE i.legal_entity_id=? AND i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' AND i.due_date IS NOT NULL AND i.due_date<=DATE_ADD(UTC_DATE(),INTERVAL 1 DAY) ORDER BY i.due_date,i.id LIMIT " + candidateLimit,
      [policy.legal_entity_id],
    );
    for (const invoice of invoices) {
      stats.scanned++;
      const dueDate = dateOnly(invoice.due_date);
      const overdueDays = dueDate ? dayDifference(dueDate,today) : -1;
      const outstanding = toUnits(invoice.grand_total) - toUnits(invoice.paid_total);
      if (!dueDate || overdueDays < Number(policy.first_reminder_after_days) || outstanding <= 0n) { stats.skipped++; continue; }

      const [originals] = await pool.execute<(RowDataPacket & {recipient_email:string;generated_document_id:string|null;status:string;sent_at:Date|string|null})[]>(
        "SELECT recipient_email,generated_document_id,status,sent_at FROM email_outbox WHERE legal_entity_id=? AND source_document_type='INVOICE' AND source_document_id=? AND message_kind='DOCUMENT' ORDER BY created_at DESC,id DESC LIMIT 1",
        [policy.legal_entity_id,invoice.id],
      );
      const original = originals[0];
      if (!original || !["SENT","DELIVERED"].includes(original.status) || !isEmail(original.recipient_email) || !original.generated_document_id) { stats.skipped++; continue; }

      const [oldReminders] = await pool.execute<(RowDataPacket & {id:string;status:string;sent_at:Date|string|null;created_at:Date|string;generated_document_id:string|null})[]>(
        "SELECT id,status,sent_at,created_at,generated_document_id FROM email_outbox WHERE legal_entity_id=? AND source_document_type='INVOICE' AND source_document_id=? AND message_kind='OVERDUE_REMINDER' AND reminder_policy_version=? ORDER BY created_at,id",
        [policy.legal_entity_id,invoice.id,policy.version_number],
      );
      if (oldReminders.length >= Number(policy.max_reminders)) { stats.skipped++; continue; }
      const latestReminder = oldReminders[oldReminders.length-1];
      if (latestReminder) {
        if (!latestReminder.sent_at || !["SENT","DELIVERED","DELIVERY_DELAYED"].includes(latestReminder.status)) { stats.skipped++; continue; }
        const localSentDate = localDate(new Date(latestReminder.sent_at),timezone);
        if (!localSentDate || dayDifference(localSentDate,today) < Number(policy.interval_days)) { stats.skipped++; continue; }
      }
      const reminderNumber = oldReminders.length+1;
      const dedupeKey = "reminder:" + policy.id + ":" + invoice.id + ":" + String(policy.version_number) + ":" + String(reminderNumber);
      const [priorByDedupe] = await pool.execute<(RowDataPacket & {id:string})[]>("SELECT id FROM email_outbox WHERE reminder_dedupe_key=? LIMIT 1",[dedupeKey]);
      if (priorByDedupe.length) { stats.skipped++; continue; }

      const [artifactRows] = await pool.execute<(RowDataPacket & {id:string;file_sha256:string;byte_size:number|string;document_number:string})[]>(
        "SELECT id,file_sha256,byte_size,document_number FROM generated_documents WHERE id=? AND source_document_type='INVOICE' AND source_document_id=? AND status='READY' AND file_sha256 IS NOT NULL LIMIT 1",
        [original.generated_document_id,invoice.id],
      );
      if (!artifactRows.length) { stats.skipped++; continue; }
      const artifact = artifactRows[0];
      const snapshot = await latestSnapshot("INVOICE",invoice.id);
      const content = object(snapshot.content_json);
      const customer = object(content.customer);
      const config = object(content.configurationSnapshot);
      const brand = object(config.brand);
      const issuer = object(config.legalEntity);
      const templateConfig = object(object(config.template).config);
      const message = template("INVOICE",invoice.invoice_number,text(customer.name),text(issuer.legalName ?? object(content.supplier).legalName),
        text(brand.name ?? brand.displayName),safeColor(templateConfig.primaryColor ?? brand.primaryColor),
        invoice.currency,fromUnits(outstanding),dueDate,true,overdueDays,fromUnits(outstanding));
      const payloadHash = idempotencyPayloadHash({sourceType:"INVOICE",sourceId:invoice.id,recipientEmail:original.recipient_email,reminderDedupeKey:dedupeKey});
      const rowId = randomUUID();
      const providerIdempotencyKey = "fx-email-" + rowId;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [lockedPolicy] = await conn.execute<(RowDataPacket & {status:string;version_number:number})[]>(
          "SELECT status,version_number FROM overdue_reminder_policies WHERE id=? AND legal_entity_id=? LIMIT 1 FOR UPDATE",[policy.id,policy.legal_entity_id]);
        if (!lockedPolicy.length || lockedPolicy[0].status!=="ACTIVE" || Number(lockedPolicy[0].version_number)!==Number(policy.version_number)) {
          await conn.rollback(); stats.skipped++; continue;
        }
        await conn.execute(
          "INSERT INTO email_outbox (id,request_idempotency_key,request_payload_sha256,legal_entity_id,source_document_type,source_document_id,content_snapshot_id,generated_document_id,document_number,message_kind,recipient_email,recipient_name,subject,html_body,text_body,attachment_sha256,attachment_byte_size,provider,provider_idempotency_key,status,attempt_count,next_attempt_at,reminder_dedupe_key,reminder_policy_version,requested_by) VALUES (?,?,?,?,?,?,?,?,?,'OVERDUE_REMINDER',?,?,?,?,?,?,?,'RESEND',?,'QUEUED',0,NOW(3),?,?,?)",
          [rowId,randomUUID(),payloadHash,policy.legal_entity_id,"INVOICE",invoice.id,snapshot.id,artifact.id,invoice.invoice_number,
            original.recipient_email,text(customer.name)||null,message.subject,message.html,message.text,artifact.file_sha256,Number(artifact.byte_size),
            providerIdempotencyKey,dedupeKey,Number(policy.version_number),policy.approved_by]);
        await appendEmailEvent(conn,rowId,"REMINDER_QUEUED",null,"QUEUED",policy.approved_by,null,null,null,
          {policyVersion:Number(policy.version_number),reminderNumber,overdueDays,attachmentSha256:artifact.file_sha256});
        await conn.commit();
        stats.queued++;
      } catch(error) {
        await conn.rollback().catch(()=>undefined);
        if ((error as {code?:string})?.code==="ER_DUP_ENTRY") { stats.skipped++; continue; }
        throw error;
      } finally { conn.release(); }
    }
  }
  return stats;
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left,right);
}
export function verifyResendWebhookSignature(payload: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret = process.env.RESEND_WEBHOOK_SECRET ?? ""): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature || !/^\d+$/.test(headers.timestamp)) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now()/1000)-timestamp)>300) return false;
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key=Buffer.from(encodedSecret,"base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256",key).update(headers.id + "." + headers.timestamp + "." + payload).digest();
  const parts = headers.signature.split(/\s+/).filter(value=>value.startsWith("v1,")).map(value=>value.slice(3));
  return parts.some(value=>{
    try { return constantTimeEqual(expected,Buffer.from(value,"base64")); } catch { return false; }
  });
}

export async function recordResendWebhook(payload: string, event: Record<string,unknown>, providerEventId: string) {
  const type = text(event.type);
  const data = object(event.data);
  const providerMessageId = text(data.email_id ?? data.id);
  const payloadDigest = sha256(payload);
  const statusMap: Record<string,EmailOutboxStatus> = {
    "email.sent":"SENT",
    "email.delivered":"DELIVERED",
    "email.delivery_delayed":"DELIVERY_DELAYED",
    "email.bounced":"BOUNCED",
    "email.complained":"COMPLAINED",
    "email.failed":"FAILED",
  };
  const target = statusMap[type];
  if (!providerEventId || providerEventId.length > 255 || !providerMessageId || !type) {
    throw new EmailWorkflowError("WEBHOOK_PAYLOAD_INVALID",400,"The provider webhook payload is invalid.");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [seen] = await conn.execute<(RowDataPacket & {id:string})[]>("SELECT id FROM email_outbox_events WHERE provider_event_id=? LIMIT 1 FOR UPDATE",[providerEventId]);
    if (seen.length) { await conn.commit(); return {duplicate:true,matched:false}; }
    const [rows] = await conn.execute<OutboxRow[]>("SELECT * FROM email_outbox WHERE provider='RESEND' AND provider_message_id=? LIMIT 1 FOR UPDATE",[providerMessageId]);
    const row = rows[0];
    let previous: string | null = null, next: string | null = null;
    if (row && target) {
      previous=row.status;
      const terminal = ["DELIVERED","BOUNCED","COMPLAINED"].includes(row.status);
      const priority: Record<string,number> = {QUEUED:0,SENDING:0,SENT:1,DELIVERY_DELAYED:2,FAILED:2,DELIVERED:3,BOUNCED:3,COMPLAINED:3,REQUIRES_REVIEW:2};
      if (terminal) {
        // Terminal provider outcomes never regress or contradict each other on a late webhook.
        next = row.status;
      } else if (priority[target] < priority[row.status] ||
          (priority[target] === priority[row.status] && row.status !== target &&
           ["DELIVERY_DELAYED","FAILED","REQUIRES_REVIEW"].includes(row.status))) {
        // Delayed, failed, and review states must not be overwritten by lower/equal-priority stale events.
        next = row.status;
      } else {
        next = target;
      }
      if (next !== row.status) {
        await conn.execute(
          "UPDATE email_outbox SET status=?,delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,NOW(3)) ELSE delivered_at END,last_error_code=CASE WHEN ? IN ('BOUNCED','COMPLAINED','FAILED') THEN ? ELSE last_error_code END,updated_at=NOW(3) WHERE id=?",
          [next,next,next,"PROVIDER_" + type.replace("email.","").toUpperCase(),row.id],
        );
      }
    }
    await appendEmailEvent(conn,row?.id ?? null,"PROVIDER_WEBHOOK:" + type,previous,next,null,null,providerEventId,payloadDigest,{providerMessageId});
    await conn.commit();
    return {duplicate:false,matched:!!row};
  } catch(error) {
    await conn.rollback().catch(()=>undefined);
    if ((error as {code?:string})?.code==="ER_DUP_ENTRY") return {duplicate:true,matched:false};
    throw error;
  } finally { conn.release(); }
}
