import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { jsonNoStore } from "@/lib/http/api-response";
import { assertDocumentScope, normalizeDocumentSourceType, permissionForDocumentSource } from "@/lib/documents/access";
import { documentApiError } from "@/lib/documents/http";
import { generateDocumentPdf, getEligibleDocumentSource } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sourceType: string; sourceId: string }> };
const generateSchema = z.object({ forceNew: z.boolean().optional() }).strict();

export async function POST(request: NextRequest, context: Context) {
  try {
    await assertCsrf(request);
    const input = generateSchema.parse(await request.json());
    const { sourceType: rawType, sourceId } = await context.params;
    const sourceType = normalizeDocumentSourceType(rawType);
    const actor = await requirePermission(permissionForDocumentSource(sourceType));
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "sourceId must be a UUID." } }, 400);
    }
    const source = await getEligibleDocumentSource(sourceType, sourceId);
    if (!source) return jsonNoStore({ error: { code: "DOCUMENT_NOT_FOUND", message: "The requested financial document was not found or is not ready for PDF generation." } }, 404);
    assertDocumentScope(actor, source.legal_entity_id);
    const data = await generateDocumentPdf(sourceType, sourceId, actor.userId, input.forceNew ?? false);
    const status = data.status === "READY" ? (data.reused ? 200 : 201) : 202;
    return jsonNoStore({ data }, status);
  } catch (error) {
    return documentApiError(error);
  }
}
