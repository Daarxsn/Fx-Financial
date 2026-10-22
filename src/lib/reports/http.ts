import "server-only";

import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { getReportRows, getReportSummary, parseReportFilters, scopedEntityIds, statusAllowed, type ReportKind } from "@/lib/reports/service";

const RESOURCE_PERMISSION: Record<ReportKind, string> = {
  invoices: "invoices:read", quotations: "quotations:read", payments: "payments:read", customers: "customers:read",
};

export async function handleReportRows(request: NextRequest, kind: ReportKind) {
  try {
    const parsed = parseReportFilters(request.nextUrl.searchParams);
    if (parsed.error || !parsed.filters) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: parsed.error ?? "Invalid report filters." } }, 400);
    const filters = parsed.filters;
    if (!statusAllowed(kind, filters.status)) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Unsupported status filter for this report." } }, 400);
    const actor = await requirePermission("reports:read");
    await requirePermission(RESOURCE_PERMISSION[kind]);
    const scope = scopedEntityIds(actor.legalEntityIds, filters.legalEntityId);
    if (scope.forbidden) return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    const result = await getReportRows(kind, scope.ids, filters);
    return jsonNoStore({ data: result.data, pagination: result.pagination, meta: { from: filters.from, to: filters.to } });
  } catch (error) { return apiError(error); }
}

export async function handleReportSummary(request: NextRequest) {
  try {
    const parsed = parseReportFilters(request.nextUrl.searchParams);
    if (parsed.error || !parsed.filters) return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: parsed.error ?? "Invalid report filters." } }, 400);
    const actor = await requirePermission("reports:read");
    const scope = scopedEntityIds(actor.legalEntityIds, parsed.filters.legalEntityId);
    if (scope.forbidden) return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    return jsonNoStore({ data: await getReportSummary(scope.ids, parsed.filters), meta: { from: parsed.filters.from, to: parsed.filters.to } });
  } catch (error) { return apiError(error); }
}
