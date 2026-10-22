import "server-only";

import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";

export type ReportKind = "invoices" | "quotations" | "payments" | "customers";
export type ReportFilters = {
  from: string;
  to: string;
  legalEntityId?: string;
  status: string;
  query: string;
  limit: number;
  offset: number;
};

export type FilterParse = { filters?: ReportFilters; error?: string };

function dateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function utcDate(date: Date): string { return date.toISOString().slice(0, 10); }
function dateText(value: Date | string | null): string | null { if (value === null) return null; return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function defaultRange(): { from: string; to: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400000);
  return { from: utcDate(start), to: utcDate(end) };
}
export function parseReportFilters(params: URLSearchParams): FilterParse {
  const defaults = defaultRange();
  const from = params.get("from") ?? defaults.from;
  const to = params.get("to") ?? defaults.to;
  const legalEntityId = params.get("legalEntityId")?.trim() || undefined;
  const status = (params.get("status") ?? "all").trim().toUpperCase();
  const query = (params.get("query") ?? "").trim();
  const limit = Number(params.get("limit") ?? "25");
  const offset = Number(params.get("offset") ?? "0");
  if (!dateValue(from) || !dateValue(to)) return { error: "from and to must be real YYYY-MM-DD dates." };
  if (from > to) return { error: "from cannot be later than to." };
  const spanDays = Math.floor((Date.parse(to + "T00:00:00.000Z") - Date.parse(from + "T00:00:00.000Z")) / 86400000) + 1;
  if (spanDays > 366) return { error: "Report date ranges cannot exceed 366 days." };
  if (legalEntityId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(legalEntityId)) {
    return { error: "legalEntityId must be a UUID." };
  }
  if (query.length > 100) return { error: "query must be 100 characters or fewer." };
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: "limit must be between 1 and 100." };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return { error: "offset must be between 0 and 1000000." };
  return { filters: { from, to, legalEntityId, status, query, limit, offset } };
}

export function scopedEntityIds(assignedIds: string[], requestedId?: string): { ids: string[]; forbidden: boolean } {
  const unique = [...new Set(assignedIds)].filter(Boolean);
  if (requestedId && !unique.includes(requestedId)) return { ids: [], forbidden: true };
  return { ids: requestedId ? [requestedId] : unique, forbidden: false };
}

export function statusAllowed(kind: ReportKind, status: string): boolean {
  const allowed: Record<ReportKind, string[]> = {
    invoices: ["ALL", "DRAFT", "ISSUED", "CANCELLED"],
    quotations: ["ALL", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED", "CONVERTED"],
    payments: ["ALL", "RECORDED", "REVERSED"],
    customers: ["ALL", "ACTIVE", "ARCHIVED"],
  };
  return allowed[kind].includes(status);
}

function money(value: string | number | null | undefined): string {
  const raw = String(value ?? "0");
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(raw)) {
    throw new Error("A report query returned a monetary value outside DECIMAL(19,4) bounds.");
  }
  const parts = raw.split(".");
  const units = BigInt(parts[0]) * 10000n + BigInt(((parts[1] ?? "") + "0000").slice(0, 4));
  return (units / 10000n).toString() + "." + (units % 10000n).toString().padStart(4, "0");
}
function safePattern(query: string): string {
  return "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
}
function zeroMetrics(legalEntityId: string, legalEntityName: string, currency: string) {
  return {
    legalEntityId, legalEntityName, currency,
    issuedInvoiceCount: 0, issuedInvoiceValue: "0.0000",
    cancelledInvoiceCount: 0, cancelledInvoiceValue: "0.0000",
    creditNoteIssuedValue: "0.0000", debitNoteIssuedValue: "0.0000",
    quotationCount: 0, quotationsWonCount: 0, quotationsExpiredCount: 0, quotationsWonValue: "0.0000",
    recordedReceiptCount: 0, recordedReceiptValue: "0.0000", unallocatedReceiptValue: "0.0000",
    reversedReceiptCount: 0, reversedReceiptValue: "0.0000",
    currentOutstandingBalance: "0.0000", currentOverdueBalance: "0.0000", currentOverdueInvoiceCount: 0,
  };
}
type Metric = ReturnType<typeof zeroMetrics>;
type ScopeRow = RowDataPacket & { legal_entity_id: string; legal_entity_name: string; currency: string };

export async function getReportSummary(scope: string[], filters: ReportFilters) {
  if (!scope.length) return { asOf: new Date().toISOString(), period: { from: filters.from, to: filters.to }, metricDefinitionsStatus: "PENDING_FINANCE_APPROVAL", summaries: [] as Metric[] };
  const marks = scope.map(() => "?").join(",");
  const invoiceSql =
    "SELECT i.legal_entity_id,le.display_name AS legal_entity_name,i.currency," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' THEN 1 ELSE 0 END) AS issued_invoice_count," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' THEN i.grand_total ELSE 0 END) AS issued_invoice_value," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled_invoice_count," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='CANCELLED' THEN i.grand_total ELSE 0 END) AS cancelled_invoice_value," +
    " SUM(CASE WHEN i.document_type='CREDIT_NOTE' AND i.lifecycle_status='ISSUED' THEN i.grand_total ELSE 0 END) AS credit_note_issued_value," +
    " SUM(CASE WHEN i.document_type='DEBIT_NOTE' AND i.lifecycle_status='ISSUED' THEN i.grand_total ELSE 0 END) AS debit_note_issued_value" +
    " FROM invoices i JOIN legal_entities le ON le.id=i.legal_entity_id" +
    " WHERE i.legal_entity_id IN (" + marks + ") AND COALESCE(i.invoice_date,DATE(i.created_at)) BETWEEN ? AND ?" +
    " GROUP BY i.legal_entity_id,le.display_name,i.currency";
  const quoteSql =
    "SELECT q.legal_entity_id,le.display_name AS legal_entity_name,q.currency,COUNT(*) AS quotation_count," +
    " SUM(CASE WHEN q.status IN ('ACCEPTED','CONVERTED') THEN 1 ELSE 0 END) AS quotations_won_count," +
    " SUM(CASE WHEN q.status='EXPIRED' OR (q.status='SENT' AND q.valid_until IS NOT NULL AND q.valid_until < ?) THEN 1 ELSE 0 END) AS quotations_expired_count," +
    " SUM(CASE WHEN q.status IN ('ACCEPTED','CONVERTED') THEN q.grand_total ELSE 0 END) AS quotations_won_value" +
    " FROM quotations q JOIN legal_entities le ON le.id=q.legal_entity_id" +
    " WHERE q.legal_entity_id IN (" + marks + ") AND COALESCE(q.issue_date,DATE(q.created_at)) BETWEEN ? AND ?" +
    " GROUP BY q.legal_entity_id,le.display_name,q.currency";
  const paymentSql =
    "SELECT p.legal_entity_id,le.display_name AS legal_entity_name,p.currency," +
    " SUM(CASE WHEN p.status='RECORDED' THEN 1 ELSE 0 END) AS recorded_receipt_count," +
    " SUM(CASE WHEN p.status='RECORDED' THEN p.amount ELSE 0 END) AS recorded_receipt_value," +
    " SUM(CASE WHEN p.status='RECORDED' THEN GREATEST(p.amount-COALESCE(a.allocated_total,0),0) ELSE 0 END) AS unallocated_receipt_value" +
    " FROM payments p JOIN legal_entities le ON le.id=p.legal_entity_id" +
    " LEFT JOIN (SELECT pa.payment_id,SUM(pa.amount) AS allocated_total FROM payment_allocations pa" +
    " JOIN payments p2 ON p2.id=pa.payment_id AND p2.status='RECORDED' GROUP BY pa.payment_id) a ON a.payment_id=p.id" +
    " WHERE p.legal_entity_id IN (" + marks + ") AND p.payment_date BETWEEN ? AND ?" +
    " GROUP BY p.legal_entity_id,le.display_name,p.currency";
  const reversedSql =
    "SELECT p.legal_entity_id,le.display_name AS legal_entity_name,pre.currency,COUNT(*) AS reversed_receipt_count,SUM(pre.amount) AS reversed_receipt_value" +
    " FROM payment_reversal_events pre JOIN payments p ON p.id=pre.payment_id JOIN legal_entities le ON le.id=p.legal_entity_id" +
    " WHERE p.legal_entity_id IN (" + marks + ") AND pre.reversed_at >= ? AND pre.reversed_at < DATE_ADD(?,INTERVAL 1 DAY)" +
    " GROUP BY p.legal_entity_id,le.display_name,pre.currency";
  const outstandingSql =
    "SELECT i.legal_entity_id,le.display_name AS legal_entity_name,i.currency," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' THEN GREATEST(i.grand_total-COALESCE(a.allocated_total,0),0) ELSE 0 END) AS current_outstanding_balance," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' AND i.due_date IS NOT NULL" +
    " AND i.due_date < COALESCE(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00',le.time_zone)),UTC_DATE())" +
    " AND GREATEST(i.grand_total-COALESCE(a.allocated_total,0),0)>0 THEN GREATEST(i.grand_total-COALESCE(a.allocated_total,0),0) ELSE 0 END) AS current_overdue_balance," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' AND i.due_date IS NOT NULL" +
    " AND i.due_date < COALESCE(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00',le.time_zone)),UTC_DATE())" +
    " AND GREATEST(i.grand_total-COALESCE(a.allocated_total,0),0)>0 THEN 1 ELSE 0 END) AS current_overdue_invoice_count" +
    " FROM invoices i JOIN legal_entities le ON le.id=i.legal_entity_id" +
    " LEFT JOIN (SELECT pa.invoice_id,SUM(pa.amount) AS allocated_total FROM payment_allocations pa" +
    " JOIN payments p ON p.id=pa.payment_id AND p.status='RECORDED' GROUP BY pa.invoice_id) a ON a.invoice_id=i.id" +
    " WHERE i.legal_entity_id IN (" + marks + ") GROUP BY i.legal_entity_id,le.display_name,i.currency";

  const [invoiceRows] = await pool.execute<(ScopeRow & {
    issued_invoice_count: string | number; issued_invoice_value: string | number;
    cancelled_invoice_count: string | number; cancelled_invoice_value: string | number;
    credit_note_issued_value: string | number; debit_note_issued_value: string | number;
  })[]>(invoiceSql, [...scope, filters.from, filters.to]);
  const [quoteRows] = await pool.execute<(ScopeRow & {
    quotation_count: string | number; quotations_won_count: string | number;
    quotations_expired_count: string | number; quotations_won_value: string | number;
  })[]>(quoteSql, [filters.to, ...scope, filters.from, filters.to]);
  const [paymentRows] = await pool.execute<(ScopeRow & {
    recorded_receipt_count: string | number; recorded_receipt_value: string | number; unallocated_receipt_value: string | number;
  })[]>(paymentSql, [...scope, filters.from, filters.to]);
  const [reversedRows] = await pool.execute<(ScopeRow & {
    reversed_receipt_count: string | number; reversed_receipt_value: string | number;
  })[]>(reversedSql, [...scope, filters.from, filters.to]);
  const [outstandingRows] = await pool.execute<(ScopeRow & {
    current_outstanding_balance: string | number; current_overdue_balance: string | number; current_overdue_invoice_count: string | number;
  })[]>(outstandingSql, scope);

  const rows = new Map<string, Metric>();
  const get = (row: ScopeRow) => {
    const key = row.legal_entity_id + ":" + row.currency;
    let metric = rows.get(key);
    if (!metric) { metric = zeroMetrics(row.legal_entity_id, row.legal_entity_name, row.currency); rows.set(key, metric); }
    return metric;
  };
  for (const row of invoiceRows) {
    const m = get(row);
    m.issuedInvoiceCount = Number(row.issued_invoice_count);
    m.issuedInvoiceValue = money(row.issued_invoice_value);
    m.cancelledInvoiceCount = Number(row.cancelled_invoice_count);
    m.cancelledInvoiceValue = money(row.cancelled_invoice_value);
    m.creditNoteIssuedValue = money(row.credit_note_issued_value);
    m.debitNoteIssuedValue = money(row.debit_note_issued_value);
  }
  for (const row of quoteRows) {
    const m = get(row);
    m.quotationCount = Number(row.quotation_count);
    m.quotationsWonCount = Number(row.quotations_won_count);
    m.quotationsExpiredCount = Number(row.quotations_expired_count);
    m.quotationsWonValue = money(row.quotations_won_value);
  }
  for (const row of paymentRows) {
    const m = get(row);
    m.recordedReceiptCount = Number(row.recorded_receipt_count);
    m.recordedReceiptValue = money(row.recorded_receipt_value);
    m.unallocatedReceiptValue = money(row.unallocated_receipt_value);
  }
  for (const row of reversedRows) {
    const m = get(row);
    m.reversedReceiptCount = Number(row.reversed_receipt_count);
    m.reversedReceiptValue = money(row.reversed_receipt_value);
  }
  for (const row of outstandingRows) {
    const m = get(row);
    m.currentOutstandingBalance = money(row.current_outstanding_balance);
    m.currentOverdueBalance = money(row.current_overdue_balance);
    m.currentOverdueInvoiceCount = Number(row.current_overdue_invoice_count);
  }
  return {
    asOf: new Date().toISOString(),
    period: { from: filters.from, to: filters.to, dateBasis: "invoice_date / quotation issue_date / payment_date, falling back to creation date for unscheduled drafts" },
    metricDefinitionsStatus: "PENDING_FINANCE_APPROVAL",
    summaries: [...rows.values()].sort((a, b) => a.legalEntityName.localeCompare(b.legalEntityName) || a.currency.localeCompare(b.currency)),
  };
}

async function pagination<T extends RowDataPacket & { total_count: string | number }>(
  rows: T[], filters: ReportFilters, sql: string, values: unknown[],
) {
  let total = rows.length ? Number(rows[0].total_count) : 0;
  if (!rows.length && filters.offset > 0) {
    const orderBy = sql.lastIndexOf(" ORDER BY ");
    const countable = orderBy >= 0 ? sql.slice(0, orderBy) : sql;
    const [countRows] = await pool.query<(RowDataPacket & { total_count: string | number })[]>(
      "SELECT COUNT(*) AS total_count FROM (" + countable + ") AS report_count",
      values.slice(0, -2),
    );
    total = Number(countRows[0]?.total_count ?? 0);
  }
  return { limit: filters.limit, offset: filters.offset, total, hasMore: filters.offset + rows.length < total };
}

export async function getReportRows(kind: ReportKind, scope: string[], f: ReportFilters) {
  if (!scope.length) return { data: [], pagination: { limit: f.limit, offset: f.offset, total: 0, hasMore: false } };
  const marks = scope.map(() => "?").join(",");
  const params: unknown[] = [...scope, f.from, f.to];
  const clauses: string[] = [];
  if (f.query) {
    const pattern = safePattern(f.query);
    if (kind === "invoices") { clauses.push("(i.invoice_number LIKE ? OR c.name LIKE ?)"); params.push(pattern, pattern); }
    else if (kind === "quotations") { clauses.push("(q.quotation_number LIKE ? OR c.name LIKE ?)"); params.push(pattern, pattern); }
    else if (kind === "payments") { clauses.push("(p.receipt_reference LIKE ? OR p.reference LIKE ? OR c.name LIKE ? OR p.method LIKE ?)"); params.push(pattern, pattern, pattern, pattern); }
    else { clauses.push("(c.name LIKE ? OR c.customer_code LIKE ? OR c.email LIKE ?)"); params.push(pattern, pattern, pattern); }
  }
  if (kind === "invoices") {
    if (f.status !== "ALL") { clauses.push("i.lifecycle_status=?"); params.push(f.status); }
    const where = "i.legal_entity_id IN (" + marks + ") AND COALESCE(i.invoice_date,DATE(i.created_at)) BETWEEN ? AND ?" + (clauses.length ? " AND " + clauses.join(" AND ") : "");
    const sql = "SELECT i.id,i.legal_entity_id,le.display_name AS legal_entity_name,i.document_type,i.invoice_number,i.lifecycle_status," +
      " COALESCE(i.invoice_date,DATE(i.created_at)) AS report_date,i.due_date,i.currency,i.subtotal,i.discount_total,i.tax_total,i.grand_total," +
      " c.name AS current_customer_name,i.customer_snapshot,COALESCE(a.paid_total,0) AS paid_total,COUNT(*) OVER() AS total_count" +
      " FROM invoices i JOIN legal_entities le ON le.id=i.legal_entity_id JOIN customers c ON c.id=i.customer_id" +
      " LEFT JOIN (SELECT pa.invoice_id,SUM(pa.amount) AS paid_total FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id AND p.status='RECORDED' GROUP BY pa.invoice_id) a ON a.invoice_id=i.id" +
      " WHERE " + where + " ORDER BY COALESCE(i.invoice_date,DATE(i.created_at)) DESC,i.created_at DESC,i.id DESC LIMIT ? OFFSET ?";
    const rowValues: unknown[] = [...params, f.limit, f.offset];
    const [rows] = await pool.query<(RowDataPacket & {id:string;legal_entity_id:string;legal_entity_name:string;document_type:string;invoice_number:string|null;lifecycle_status:string;report_date:Date|string;due_date:Date|string|null;currency:string;subtotal:string|number;discount_total:string|number;tax_total:string|number;grand_total:string|number;current_customer_name:string;customer_snapshot:unknown;paid_total:string|number;total_count:string|number})[]>(sql,rowValues);
    const data = rows.map(r => {
      let customerName = r.current_customer_name;
      const snap = r.customer_snapshot;
      try { const x = typeof snap === "string" ? JSON.parse(snap) : snap; if (x && typeof x.name === "string" && x.name.trim()) customerName = x.name; } catch { /* fall back to the current display name for legacy rows */ }
      const paid = money(r.paid_total), total = money(r.grand_total);
      const totalUnits = BigInt(total.split(".")[0]) * 10000n + BigInt((total.split(".")[1] ?? "").padEnd(4,"0"));
      const paidUnits = BigInt(paid.split(".")[0]) * 10000n + BigInt((paid.split(".")[1] ?? "").padEnd(4,"0"));
      const dueUnits = totalUnits > paidUnits ? totalUnits - paidUnits : 0n;
      return { id:r.id, legalEntityId:r.legal_entity_id, legalEntityName:r.legal_entity_name, documentType:r.document_type,
        documentNumber:r.invoice_number, status:r.lifecycle_status, date:dateText(r.report_date),
        dueDate:dateText(r.due_date), customerName, currency:r.currency,
        subtotal:money(r.subtotal), discountTotal:money(r.discount_total), taxTotal:money(r.tax_total), total,
        allocatedPayment:paid, outstandingBalance:r.lifecycle_status === "ISSUED" ? (dueUnits / 10000n).toString()+"."+(dueUnits % 10000n).toString().padStart(4,"0") : null };
    });
    return { data, pagination: await pagination(rows, f, sql, rowValues) };
  }
  if (kind === "quotations") {
    const effective = "CASE WHEN q.status='SENT' AND q.valid_until IS NOT NULL AND q.valid_until < ? THEN 'EXPIRED' ELSE q.status END";
    const where = "q.legal_entity_id IN (" + marks + ") AND COALESCE(q.issue_date,DATE(q.created_at)) BETWEEN ? AND ?" +
      (clauses.length ? " AND " + clauses.join(" AND ") : "") + (f.status !== "ALL" ? " AND " + effective + " = ?" : "");
    const queryParams: unknown[] = [f.to, ...params];
    if (f.status !== "ALL") queryParams.push(f.to, f.status);
    const sql = "SELECT q.id,q.legal_entity_id,le.display_name AS legal_entity_name,q.quotation_number," + effective + " AS effective_status," +
      " COALESCE(q.issue_date,DATE(q.created_at)) AS report_date,q.valid_until,q.currency,q.grand_total,q.converted_invoice_id,c.name AS current_customer_name,q.customer_snapshot,COUNT(*) OVER() AS total_count" +
      " FROM quotations q JOIN legal_entities le ON le.id=q.legal_entity_id JOIN customers c ON c.id=q.customer_id WHERE " + where +
      " ORDER BY COALESCE(q.issue_date,DATE(q.created_at)) DESC,q.created_at DESC,q.id DESC LIMIT ? OFFSET ?";
    const rowValues: unknown[] = [...queryParams, f.limit, f.offset];
    const [rows] = await pool.query<(RowDataPacket & {id:string;legal_entity_id:string;legal_entity_name:string;quotation_number:string|null;effective_status:string;report_date:Date|string;valid_until:Date|string|null;currency:string;grand_total:string|number;converted_invoice_id:string|null;current_customer_name:string;customer_snapshot:unknown;total_count:string|number})[]>(sql,rowValues);
    const data = rows.map(r => {
      let customerName = r.current_customer_name;
      try { const x = typeof r.customer_snapshot === "string" ? JSON.parse(r.customer_snapshot) : r.customer_snapshot; if (x && typeof x.name === "string" && x.name.trim()) customerName = x.name; } catch { /* safe display fallback */ }
      return { id:r.id, legalEntityId:r.legal_entity_id, legalEntityName:r.legal_entity_name, quotationNumber:r.quotation_number,
        status:r.effective_status, date:dateText(r.report_date), validUntil:dateText(r.valid_until),
        currency:r.currency, total:money(r.grand_total), convertedInvoiceId:r.converted_invoice_id, customerName };
    });
    return { data, pagination: await pagination(rows, f, sql, rowValues) };
  }
  if (kind === "payments") {
    if (f.status !== "ALL") { clauses.push("p.status=?"); params.push(f.status); }
    const where = "p.legal_entity_id IN (" + marks + ") AND p.payment_date BETWEEN ? AND ?" + (clauses.length ? " AND " + clauses.join(" AND ") : "");
    const sql = "SELECT p.id,p.legal_entity_id,le.display_name AS legal_entity_name,p.receipt_reference,p.customer_id,c.name AS customer_name," +
      " p.amount,p.currency,p.payment_date,p.method,p.reference,p.status,p.reversed_at," +
      " CASE WHEN p.status='RECORDED' THEN COALESCE(a.allocated_total,0) ELSE 0 END AS allocated_total," +
      " CASE WHEN p.status='RECORDED' THEN GREATEST(p.amount-COALESCE(a.allocated_total,0),0) ELSE 0 END AS unallocated_total,COUNT(*) OVER() AS total_count" +
      " FROM payments p JOIN legal_entities le ON le.id=p.legal_entity_id JOIN customers c ON c.id=p.customer_id" +
      " LEFT JOIN (SELECT payment_id,SUM(amount) allocated_total FROM payment_allocations GROUP BY payment_id) a ON a.payment_id=p.id" +
      " WHERE " + where + " ORDER BY p.payment_date DESC,p.created_at DESC,p.id DESC LIMIT ? OFFSET ?";
    const rowValues: unknown[] = [...params, f.limit, f.offset];
    const [rows] = await pool.query<(RowDataPacket & {id:string;legal_entity_id:string;legal_entity_name:string;receipt_reference:string|null;customer_id:string;customer_name:string;amount:string|number;currency:string;payment_date:Date|string;method:string;reference:string|null;status:string;reversed_at:Date|string|null;allocated_total:string|number;unallocated_total:string|number;total_count:string|number})[]>(sql,rowValues);
    return { data: rows.map(r => ({ id:r.id, legalEntityId:r.legal_entity_id, legalEntityName:r.legal_entity_name,
      receiptReference:r.receipt_reference, customerId:r.customer_id, customerName:r.customer_name, amount:money(r.amount), currency:r.currency,
      paymentDate:dateText(r.payment_date), method:r.method, reference:r.reference, status:r.status,
      reversedAt:r.reversed_at, allocatedAmount:money(r.allocated_total), unallocatedAmount:money(r.unallocated_total) })), pagination:await pagination(rows,f,sql,rowValues) };
  }
  if (f.status !== "ALL" && !["ACTIVE","ARCHIVED"].includes(f.status)) throw new Error("Unsupported customer report status.");
  const statusClause = f.status === "ACTIVE" ? " AND c.is_active=1" : f.status === "ARCHIVED" ? " AND c.is_active=0" : "";
  const queryClause = f.query ? " AND (c.name LIKE ? OR c.customer_code LIKE ? OR c.email LIKE ?)" : "";
  const pattern = safePattern(f.query);
  const sql =
    "WITH scoped_documents AS (" +
    " SELECT i.legal_entity_id,i.customer_id,i.currency FROM invoices i WHERE i.legal_entity_id IN (" + marks + ") AND COALESCE(i.invoice_date,DATE(i.created_at)) BETWEEN ? AND ?" +
    " UNION SELECT q.legal_entity_id,q.customer_id,q.currency FROM quotations q WHERE q.legal_entity_id IN (" + marks + ") AND COALESCE(q.issue_date,DATE(q.created_at)) BETWEEN ? AND ?" +
    "), invoice_agg AS (" +
    " SELECT i.legal_entity_id,i.customer_id,i.currency," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' THEN 1 ELSE 0 END) AS issued_invoice_count," +
    " SUM(CASE WHEN i.document_type='INVOICE' AND i.lifecycle_status='ISSUED' THEN i.grand_total ELSE 0 END) AS issued_invoice_value" +
    " FROM invoices i WHERE i.legal_entity_id IN (" + marks + ") AND COALESCE(i.invoice_date,DATE(i.created_at)) BETWEEN ? AND ? GROUP BY i.legal_entity_id,i.customer_id,i.currency" +
    "), quotation_agg AS (" +
    " SELECT q.legal_entity_id,q.customer_id,q.currency,COUNT(*) AS quotation_count," +
    " SUM(CASE WHEN q.status IN ('ACCEPTED','CONVERTED') THEN 1 ELSE 0 END) AS won_count" +
    " FROM quotations q WHERE q.legal_entity_id IN (" + marks + ") AND COALESCE(q.issue_date,DATE(q.created_at)) BETWEEN ? AND ? GROUP BY q.legal_entity_id,q.customer_id,q.currency" +
    ") SELECT s.legal_entity_id,le.display_name AS legal_entity_name,s.currency,c.id AS customer_id,c.customer_code,c.name,c.email,c.phone,c.is_active," +
    " COALESCE(i.issued_invoice_count,0) AS issued_invoice_count,COALESCE(i.issued_invoice_value,0) AS issued_invoice_value," +
    " COALESCE(q.quotation_count,0) AS quotation_count,COALESCE(q.won_count,0) AS won_count,COUNT(*) OVER() AS total_count" +
    " FROM scoped_documents s JOIN legal_entities le ON le.id=s.legal_entity_id JOIN customers c ON c.id=s.customer_id" +
    " LEFT JOIN invoice_agg i ON i.legal_entity_id=s.legal_entity_id AND i.customer_id=s.customer_id AND i.currency=s.currency" +
    " LEFT JOIN quotation_agg q ON q.legal_entity_id=s.legal_entity_id AND q.customer_id=s.customer_id AND q.currency=s.currency" +
    " WHERE 1=1" + statusClause + queryClause +
    " ORDER BY le.display_name,c.name,s.currency,c.id LIMIT ? OFFSET ?";
  const customerParams: unknown[] = [...scope, f.from, f.to, ...scope, f.from, f.to, ...scope, f.from, f.to, ...scope, f.from, f.to];
  if (f.query) customerParams.push(pattern, pattern, pattern);
  customerParams.push(f.limit, f.offset);
  const [customerRows] = await pool.query<(RowDataPacket & {legal_entity_id:string;legal_entity_name:string;currency:string;customer_id:string;customer_code:string|null;name:string;email:string|null;phone:string|null;is_active:number;issued_invoice_count:string|number;issued_invoice_value:string|number;quotation_count:string|number;won_count:string|number;total_count:string|number})[]>(sql, customerParams);
  const customerValues = customerParams;
  return { data: customerRows.map(r => ({ legalEntityId:r.legal_entity_id, legalEntityName:r.legal_entity_name, currency:r.currency,
    customerId:r.customer_id, customerCode:r.customer_code, name:r.name, email:r.email, phone:r.phone, status:Number(r.is_active) ? "ACTIVE" : "ARCHIVED",
    issuedInvoiceCount:Number(r.issued_invoice_count), issuedInvoiceValue:money(r.issued_invoice_value), quotationCount:Number(r.quotation_count), quotationsWonCount:Number(r.won_count) })),
    pagination: await pagination(customerRows,f,sql,customerValues) };
}
