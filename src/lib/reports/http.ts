import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { recordAudit } from "@/lib/configuration/service";
import { buildCsv } from "@/lib/master-data/csv";
import {
  getReportRows, getReportSummary, parseReportFilters, scopedEntityIds, statusAllowed, type ReportKind,
} from "@/lib/reports/service";

const RESOURCE_PERMISSION: Record<ReportKind, string> = {
  invoices: "invoices:read", quotations: "quotations:read", payments: "payments:read", customers: "customers:read",
};
const EXPORT_FIELDS: Record<ReportKind, Array<{ key: string; label: string }>> = {
  invoices: [
    { key: "legalEntityName", label: "Legal entity" }, { key: "documentType", label: "Document type" }, { key: "documentNumber", label: "Document number" },
    { key: "status", label: "Status" }, { key: "date", label: "Document date" },
    { key: "dueDate", label: "Due date" }, { key: "customerName", label: "Customer" },
    { key: "currency", label: "Currency" }, { key: "subtotal", label: "Subtotal" },
    { key: "discountTotal", label: "Discount" }, { key: "taxTotal", label: "Tax" },
    { key: "total", label: "Document total" }, { key: "allocatedPayment", label: "Allocated payment" },
    { key: "outstandingBalance", label: "Outstanding balance" },
  ],
  quotations: [
    { key: "legalEntityName", label: "Legal entity" }, { key: "quotationNumber", label: "Quotation number" }, { key: "status", label: "Status" },
    { key: "date", label: "Quotation date" }, { key: "validUntil", label: "Valid until" },
    { key: "customerName", label: "Customer" }, { key: "currency", label: "Currency" },
    { key: "total", label: "Quotation total" },
  ],
  payments: [
    { key: "legalEntityName", label: "Legal entity" }, { key: "receiptReference", label: "Receipt reference" }, { key: "paymentDate", label: "Payment date" },
    { key: "customerName", label: "Customer" }, { key: "currency", label: "Currency" },
    { key: "amount", label: "Receipt amount" }, { key: "method", label: "Method" },
    { key: "status", label: "Status" }, { key: "allocatedAmount", label: "Allocated amount" },
    { key: "unallocatedAmount", label: "Unallocated amount" },
  ],
  customers: [
    { key: "legalEntityName", label: "Legal entity" }, { key: "currency", label: "Currency" },
    { key: "customerCode", label: "Customer code" }, { key: "name", label: "Customer" },
    { key: "status", label: "Status" }, { key: "issuedInvoiceCount", label: "Issued invoice count" },
    { key: "issuedInvoiceValue", label: "Issued invoice value" }, { key: "quotationCount", label: "Quotation count" },
    { key: "quotationsWonCount", label: "Won quotation count" },
  ],
};

function parsedFilters(request: NextRequest) {
  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (parsed.error || !parsed.filters) {
    return { response: jsonNoStore({ error: { code: "VALIDATION_ERROR", message: parsed.error ?? "Invalid report filters." } }, 400) };
  }
  return { filters: parsed.filters };
}

async function authorizedScope(kind: ReportKind, requestedEntityId?: string) {
  const actor = await requirePermission("reports:read");
  await requirePermission(RESOURCE_PERMISSION[kind]);
  const scope = scopedEntityIds(actor.legalEntityIds, requestedEntityId);
  return { actor, scope };
}

export async function handleReportRows(request: NextRequest, kind: ReportKind) {
  try {
    const parsed = parsedFilters(request);
    if (parsed.response) return parsed.response;
    const filters = parsed.filters!;
    if (!statusAllowed(kind, filters.status)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Unsupported status filter for this report." } }, 400);
    }
    const { scope } = await authorizedScope(kind, filters.legalEntityId);
    if (scope.forbidden) {
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    }
    const result = await getReportRows(kind, scope.ids, filters);
    return jsonNoStore({
      data: result.data,
      meta: { pagination: result.pagination, from: filters.from, to: filters.to, metricDefinitionsStatus: "PENDING_FINANCE_APPROVAL", scopedEntityCount: scope.ids.length },
    });
  } catch (error) { return apiError(error); }
}

export async function handleReportSummary(request: NextRequest) {
  try {
    const parsed = parsedFilters(request);
    if (parsed.response) return parsed.response;
    const filters = parsed.filters!;
    const actor = await requirePermission("reports:read");
    await requirePermission("invoices:read");
    await requirePermission("quotations:read");
    await requirePermission("payments:read");
    const scope = scopedEntityIds(actor.legalEntityIds, filters.legalEntityId);
    if (scope.forbidden) {
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    }
    return jsonNoStore({
      data: await getReportSummary(scope.ids, filters),
      meta: { from: filters.from, to: filters.to, metricDefinitionsStatus: "PENDING_FINANCE_APPROVAL", scopedEntityCount: scope.ids.length },
    });
  } catch (error) { return apiError(error); }
}

export async function handleReportExport(request: NextRequest, kind: ReportKind) {
  try {
    await assertCsrf(request);
    const parsed = parsedFilters(request);
    if (parsed.response) return parsed.response;
    const filters = parsed.filters!;
    if (!statusAllowed(kind, filters.status)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Unsupported status filter for this export." } }, 400);
    }
    if (filters.offset !== 0) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "CSV exports start at offset 0; narrow the filters rather than paginating an export." } }, 400);
    }
    const rowLimit = Number(request.nextUrl.searchParams.get("rowLimit") ?? "10000");
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 10000) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "rowLimit must be between 1 and 10000." } }, 400);
    }
    const { actor, scope } = await authorizedScope(kind, filters.legalEntityId);
    if (scope.forbidden) {
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Legal entity not found in your assigned scope." } }, 404);
    }
    const exportFilters = { ...filters, limit: rowLimit, offset: 0 };
    const result = await getReportRows(kind, scope.ids, exportFilters);
    if (result.pagination.hasMore) {
      return jsonNoStore({ error: { code: "EXPORT_LIMIT_EXCEEDED", message: "The result exceeds the 10,000-row export limit. Narrow the date range or filters." } }, 413);
    }
    const fields = EXPORT_FIELDS[kind];
    const records = result.data as unknown as Array<Record<string, unknown>>;
    const headers = fields.map(field => field.label);
    const rows = records.map(record => Object.fromEntries(fields.map(field => [field.label, record[field.key] ?? ""])));
    const csv = buildCsv(headers, rows);

    if (scope.ids.length) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const legalEntityId of scope.ids) {
          const entityRowCount = records.filter(record => record.legalEntityId === legalEntityId).length;
          await recordAudit(
            conn, actor.userId, "report.exported", "report_export", legalEntityId,
            "Authorized report CSV export", null,
            { reportKind: kind, from: filters.from, to: filters.to, rowCount: entityRowCount, status: filters.status, format: "CSV" },
          );
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally { conn.release(); }
    }
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="falchion-' + kind + '-report-' + filters.from + '-to-' + filters.to + '.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": randomUUID(),
      },
    });
  } catch (error) { return apiError(error); }
}
