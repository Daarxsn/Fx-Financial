import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { getAuditEvents, parseAuditFilters } from "@/lib/audit/service";
import { scopedEntityIds } from "@/lib/reports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const parsed = parseAuditFilters(request.nextUrl.searchParams);
    if (!parsed.filters) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: parsed.error ?? "Invalid audit filters." } }, 400);
    const actor = await requirePermission("audit:read");
    const scope = scopedEntityIds(actor.legalEntityIds, parsed.filters.legalEntityId);
    if (scope.forbidden) return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    const result = await getAuditEvents(scope.ids, parsed.filters);
    return jsonNoStore({
      data: result.data,
      meta: { pagination: result.pagination, from: parsed.filters.from, to: parsed.filters.to, payloadsOmitted: true },
    });
  } catch (error) {
    return apiError(error);
  }
}
