import "server-only";

import type { SessionPrincipal } from "@/lib/auth/session";
import { DocumentWorkflowError, type DocumentSourceType } from "@/lib/documents/service";
import { pool } from "@/lib/db/pool";
import type { RowDataPacket } from "mysql2";

export function normalizeDocumentSourceType(value: string): DocumentSourceType {
  const source = value.toUpperCase();
  if (source === "INVOICE" || source === "QUOTATION" || source === "RECEIPT") return source;
  throw new DocumentWorkflowError("DOCUMENT_SOURCE_INVALID", 400, "sourceType must be INVOICE, QUOTATION, or RECEIPT.");
}

export function permissionForDocumentSource(sourceType: DocumentSourceType): string {
  if (sourceType === "INVOICE") return "invoices:read";
  if (sourceType === "QUOTATION") return "quotations:read";
  return "payments:read";
}

export function assertDocumentScope(actor: SessionPrincipal, legalEntityId: string): void {
  if (!actor.legalEntityIds.includes(legalEntityId)) {
    throw new DocumentWorkflowError("DOCUMENT_NOT_FOUND", 404, "The requested document is not available in your assigned scope.");
  }
}

export async function findGeneratedDocumentAccessTarget(documentId: string): Promise<{ id: string; sourceType: DocumentSourceType; sourceId: string; legalEntityId: string } | null> {
  const [rows] = await pool.execute<(RowDataPacket & {
    id: string; source_document_type: DocumentSourceType; source_document_id: string; legal_entity_id: string;
  })[]>(
    "SELECT id,source_document_type,source_document_id,legal_entity_id FROM generated_documents WHERE id=? LIMIT 1",
    [documentId],
  );
  const row = rows[0];
  return row ? { id: row.id, sourceType: row.source_document_type, sourceId: row.source_document_id, legalEntityId: row.legal_entity_id } : null;
}
