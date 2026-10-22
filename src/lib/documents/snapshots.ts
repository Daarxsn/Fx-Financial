import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export type ContentSourceType = "INVOICE" | "QUOTATION" | "RECEIPT";
export type ContentCaptureReason = "ISSUED" | "STATUS_CHANGE" | "RECEIPT_RECORDED" | "RECEIPT_REVERSED" | "LEGACY_BACKFILL";

export function canonicalDocumentJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalDocumentJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().filter(key => obj[key] !== undefined)
    .map(key => JSON.stringify(key) + ":" + canonicalDocumentJson(obj[key])).join(",") + "}";
}

export type CaptureDocumentSnapshotInput = {
  sourceType: ContentSourceType;
  sourceDocumentId: string;
  legalEntityId: string;
  documentNumber: string;
  configurationSnapshotId: string | null;
  captureReason: ContentCaptureReason;
  content: Record<string, unknown>;
  actorId: string | null;
};

export async function captureDocumentContentSnapshot(
  conn: PoolConnection,
  input: CaptureDocumentSnapshotInput,
): Promise<{ id: string; revisionNumber: number; contentSha256: string; inserted: boolean }> {
  const canonical = canonicalDocumentJson(input.content);
  const hash = createHash("sha256").update(canonical).digest("hex");
  const [existing] = await conn.execute<(RowDataPacket & { id: string; revision_number: number })[]>(
    "SELECT id,revision_number FROM document_content_snapshots WHERE source_document_type=? AND source_document_id=? AND content_sha256=? LIMIT 1 FOR UPDATE",
    [input.sourceType,input.sourceDocumentId,hash],
  );
  if (existing.length) {
    return { id:String(existing[0].id),revisionNumber:Number(existing[0].revision_number),contentSha256:hash,inserted:false };
  }
  const [revisions] = await conn.execute<(RowDataPacket & { revision_number: number })[]>(
    "SELECT COALESCE(MAX(revision_number),0) AS revision_number FROM document_content_snapshots WHERE source_document_type=? AND source_document_id=?",
    [input.sourceType,input.sourceDocumentId],
  );
  const revisionNumber = Number(revisions[0]?.revision_number ?? 0) + 1;
  const id = randomUUID();
  await conn.execute(
    "INSERT INTO document_content_snapshots (id,source_document_type,source_document_id,legal_entity_id,document_number,source_configuration_snapshot_id,revision_number,capture_reason,content_json,content_sha256,captured_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id,input.sourceType,input.sourceDocumentId,input.legalEntityId,input.documentNumber,input.configurationSnapshotId,
      revisionNumber,input.captureReason,canonical,hash,input.actorId],
  );
  return { id,revisionNumber,contentSha256:hash,inserted:true };
}
