import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/authorize";
import { jsonNoStore } from "@/lib/http/api-response";
import { assertDocumentScope, findGeneratedDocumentAccessTarget, permissionForDocumentSource } from "@/lib/documents/access";
import { documentApiError, privatePdfResponse } from "@/lib/documents/http";
import { downloadGeneratedDocument } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ documentId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { documentId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "documentId must be a UUID." } }, 400);
    }
    const target = await findGeneratedDocumentAccessTarget(documentId);
    if (!target) return jsonNoStore({ error: { code: "DOCUMENT_NOT_FOUND", message: "The requested PDF is not available." } }, 404);
    const actor = await requirePermission(permissionForDocumentSource(target.sourceType));
    assertDocumentScope(actor, target.legalEntityId);
    const result = await downloadGeneratedDocument(documentId, actor.userId);
    return privatePdfResponse(result.bytes, result.documentNumber, result.fileSha256);
  } catch (error) {
    return documentApiError(error);
  }
}
