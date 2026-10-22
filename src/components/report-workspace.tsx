"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type ReportKind = "invoices" | "quotations" | "payments" | "customers";
type ReportRow = Record<string, string | number | boolean | null | undefined>;
type SummaryRow = {
  legalEntityId: string; legalEntityName: string; currency: string;
  issuedInvoiceCount: number; issuedInvoiceValue: string; cancelledInvoiceCount: number; cancelledInvoiceValue: string;
  creditNoteIssuedValue: string; debitNoteIssuedValue: string; quotationCount: number; quotationsWonCount: number;
  quotationsExpiredCount: number; quotationsWonValue: string; recordedReceiptCount: number; recordedReceiptValue: string;
  unallocatedReceiptValue: string; reversedReceiptCount: number; reversedReceiptValue: string;
  currentOutstandingBalance: string; currentOverdueBalance: string; currentOverdueInvoiceCount: number;
};
type Filters = { from: string; to: string; status: string; query: string; legalEntityId: string };
type Column = { key: string; label: string };

const reportOptions: Array<{ value: ReportKind; label: string }> = [
  { value: "invoices", label: "Invoice report" },
  { value: "quotations", label: "Quotation report" },
  { value: "payments", label: "Payment report" },
  { value: "customers", label: "Customer activity" },
];
const statusOptions: Record<ReportKind, Array<{ value: string; label: string }>> = {
  invoices: [{ value: "ALL", label: "All statuses" }, { value: "DRAFT", label: "Draft" }, { value: "ISSUED", label: "Issued" }, { value: "CANCELLED", label: "Cancelled" }],
  quotations: [{ value: "ALL", label: "All statuses" }, { value: "DRAFT", label: "Draft" }, { value: "SENT", label: "Sent" }, { value: "ACCEPTED", label: "Accepted" }, { value: "CONVERTED", label: "Converted" }, { value: "EXPIRED", label: "Expired" }, { value: "REJECTED", label: "Rejected" }, { value: "CANCELLED", label: "Cancelled" }],
  payments: [{ value: "ALL", label: "All statuses" }, { value: "RECORDED", label: "Recorded" }, { value: "REVERSED", label: "Reversed" }],
  customers: [{ value: "ALL", label: "All customers" }, { value: "ACTIVE", label: "Active" }, { value: "ARCHIVED", label: "Archived" }],
};
const columns: Record<ReportKind, Column[]> = {
  invoices: [
    { key: "documentType", label: "Type" }, { key: "documentNumber", label: "Document number" },
    { key: "status", label: "Status" }, { key: "date", label: "Date" }, { key: "dueDate", label: "Due date" },
    { key: "customerName", label: "Customer" }, { key: "currency", label: "Currency" }, { key: "total", label: "Total" },
    { key: "allocatedPayment", label: "Allocated" }, { key: "outstandingBalance", label: "Outstanding" },
  ],
  quotations: [
    { key: "quotationNumber", label: "Quotation number" }, { key: "status", label: "Status" },
    { key: "date", label: "Date" }, { key: "validUntil", label: "Valid until" }, { key: "customerName", label: "Customer" },
    { key: "currency", label: "Currency" }, { key: "total", label: "Total" },
  ],
  payments: [
    { key: "receiptReference", label: "Receipt" }, { key: "paymentDate", label: "Payment date" },
    { key: "customerName", label: "Customer" }, { key: "currency", label: "Currency" }, { key: "amount", label: "Amount" },
    { key: "status", label: "Status" }, { key: "allocatedAmount", label: "Allocated" }, { key: "unallocatedAmount", label: "Unallocated" },
  ],
  customers: [
    { key: "legalEntityName", label: "Legal entity" }, { key: "currency", label: "Currency" },
    { key: "customerCode", label: "Code" }, { key: "name", label: "Customer" }, { key: "status", label: "Status" },
    { key: "issuedInvoiceCount", label: "Issued invoices" }, { key: "issuedInvoiceValue", label: "Issued value" },
    { key: "quotationCount", label: "Quotations" }, { key: "quotationsWonCount", label: "Won" },
  ],
};
const summaryColumns: Array<{ key: keyof SummaryRow; label: string }> = [
  { key: "issuedInvoiceCount", label: "Issued invoices" }, { key: "issuedInvoiceValue", label: "Issued invoice value" },
  { key: "cancelledInvoiceCount", label: "Cancelled invoices" }, { key: "cancelledInvoiceValue", label: "Cancelled invoice value" },
  { key: "creditNoteIssuedValue", label: "Issued credit notes" }, { key: "debitNoteIssuedValue", label: "Issued debit notes" },
  { key: "quotationsWonCount", label: "Won quotations" }, { key: "quotationsWonValue", label: "Won quotation value" },
  { key: "quotationsExpiredCount", label: "Expired quotations" }, { key: "recordedReceiptCount", label: "Recorded receipts" },
  { key: "recordedReceiptValue", label: "Recorded receipt value" }, { key: "unallocatedReceiptValue", label: "Unallocated receipt value" },
  { key: "reversedReceiptCount", label: "Reversed receipts" }, { key: "reversedReceiptValue", label: "Reversed receipt value" },
  { key: "currentOutstandingBalance", label: "Current outstanding (snapshot)" },
  { key: "currentOverdueBalance", label: "Current overdue (snapshot)" },
  { key: "currentOverdueInvoiceCount", label: "Overdue invoice count (snapshot)" },
];

function dateString(date: Date) { return date.toISOString().slice(0, 10); }
function initialFilters(): Filters {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400000);
  return { from: dateString(start), to: dateString(end), status: "ALL", query: "", legalEntityId: "" };
}
function queryString(filters: Filters, kind?: ReportKind, offset = 0) {
  const query = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.legalEntityId.trim()) query.set("legalEntityId", filters.legalEntityId.trim());
  if (filters.query.trim()) query.set("query", filters.query.trim());
  if (kind) {
    query.set("status", filters.status);
    query.set("limit", "25");
    query.set("offset", String(offset));
  }
  return query.toString();
}
function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
async function readJson(response: Response) {
  try { return await response.json() as { data?: unknown; meta?: { pagination?: { total?: number; hasMore?: boolean } }; error?: { message?: string } }; }
  catch { return null; }
}

export function ReportWorkspace() {
  const [kind, setKind] = useState<ReportKind>("invoices");
  const [draft, setDraft] = useState<Filters>(() => initialFilters());
  const [applied, setApplied] = useState<Filters>(() => initialFilters());
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const visibleColumns = useMemo(() => columns[kind], [kind]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const summaryUrl = "/api/v1/reports/summary?" + queryString(applied);
        const listUrl = "/api/v1/reports/" + kind + "?" + queryString(applied, kind, offset);
        const [summaryResponse, listResponse] = await Promise.all([
          fetch(summaryUrl, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
          fetch(listUrl, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
        ]);
        const [summaryBody, listBody] = await Promise.all([readJson(summaryResponse), readJson(listResponse)]);
        if (!active) return;
        if (!summaryResponse.ok) throw new Error(summaryBody?.error?.message ?? "The reporting summary could not be loaded.");
        if (!listResponse.ok) throw new Error(listBody?.error?.message ?? "The selected report could not be loaded.");
        const summaryData = summaryBody?.data as { summaries?: SummaryRow[]; asOf?: string } | undefined;
        setSummary(Array.isArray(summaryData?.summaries) ? summaryData.summaries : []);
        setAsOf(summaryData?.asOf ?? "");
        setRows(Array.isArray(listBody?.data) ? listBody.data as ReportRow[] : []);
        setTotal(Number(listBody?.meta?.pagination?.total ?? 0));
        setHasMore(Boolean(listBody?.meta?.pagination?.hasMore));
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setSummary([]);
        setRows([]);
        setTotal(0);
        setHasMore(false);
        setError(cause instanceof Error ? cause.message : "The report could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [applied, kind, offset]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...draft });
    setNotice("");
  }

  async function exportCsv() {
    setExportBusy(true);
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams(queryString(applied, kind, 0));
      query.set("rowLimit", "10000");
      let csrfToken = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("fx_csrf="))?.slice("fx_csrf=".length) ?? "";
      if (!csrfToken) {
        const bootstrap = await fetch("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
        const bootstrapBody = await readJson(bootstrap);
        if (!bootstrap.ok || typeof (bootstrapBody as { data?: { csrfToken?: unknown } } | null)?.data?.csrfToken !== "string") {
          throw new Error("Could not verify the export request. Refresh the page and try again.");
        }
        csrfToken = (bootstrapBody as { data: { csrfToken: string } }).data.csrfToken;
      }
      const response = await fetch("/api/v1/reports/" + kind + "/export?" + query.toString(), {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body: "{}",
        cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) {
        const body = await readJson(response);
        throw new Error(body?.error?.message ?? "CSV export failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "falchion-" + kind + "-report-" + applied.from + "-to-" + applied.to + ".csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("CSV export downloaded. The export action was recorded in the audit trail.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="report-workspace">
      <div className="report-notice report-notice--warning" role="note">
        <strong>Provisional metric definitions — finance approval pending.</strong>
        <span>Amounts are grouped by legal entity and currency. Period totals and current balance snapshots are separate; currencies are never combined.</span>
      </div>

      <form className="report-filter-panel" onSubmit={applyFilters}>
        <label className="form-field"><span>Report</span><select className="form-control" value={kind} onChange={event => { setKind(event.target.value as ReportKind); setOffset(0); setDraft(current => ({ ...current, status: "ALL" })); setApplied(current => ({ ...current, status: "ALL" })); }}><option value="invoices">Invoice report</option><option value="quotations">Quotation report</option><option value="payments">Payment report</option><option value="customers">Customer activity</option></select></label>
        <label className="form-field"><span>From date</span><input className="form-control" type="date" required value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></label>
        <label className="form-field"><span>To date</span><input className="form-control" type="date" required value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></label>
        <label className="form-field"><span>Status</span><select className="form-control" value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}>{statusOptions[kind].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="form-field"><span>Search</span><input className="form-control" value={draft.query} maxLength={100} onChange={event => setDraft(current => ({ ...current, query: event.target.value }))} placeholder="Document, receipt or customer" /></label>
        <label className="form-field"><span>Legal entity ID (optional)</span><input className="form-control" value={draft.legalEntityId} maxLength={36} onChange={event => setDraft(current => ({ ...current, legalEntityId: event.target.value }))} placeholder="Narrow your assigned scope" /></label>
        <div className="report-filter-actions"><button className="button button--primary" type="submit">Apply filters</button><button className="button button--secondary" type="button" disabled={exportBusy} onClick={() => void exportCsv()}>{exportBusy ? "Preparing CSV…" : "Export CSV"}</button></div>
      </form>

      {error ? <div className="report-notice report-notice--error" role="alert"><strong>Report unavailable</strong><span>{error}</span></div> : null}
      {notice ? <div className="report-notice report-notice--success" role="status"><span>{notice}</span></div> : null}
      <div className="report-section-heading"><div><h2>Business summary</h2><p>{applied.from} to {applied.to}. Current balance columns are an as-of snapshot{asOf ? " as of " + asOf : ""}.</p></div></div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead><tr><th>Legal entity</th><th>Currency</th>{summaryColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={summaryColumns.length + 2}>Loading reporting summary…</td></tr>
              : summary.length ? summary.map(row => <tr key={row.legalEntityId + ":" + row.currency}><td>{row.legalEntityName}</td><td>{row.currency}</td>{summaryColumns.map(column => <td key={column.key}>{valueText(row[column.key])}</td>)}</tr>)
              : <tr><td colSpan={summaryColumns.length + 2}>No report activity for the selected scope and period.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="report-section-heading report-section-heading--results"><div><h2>{reportOptions.find(option => option.value === kind)?.label}</h2><p>{loading ? "Retrieving rows…" : total + " matching row" + (total === 1 ? "" : "s") + " · page size 25"}</p></div></div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead><tr>{visibleColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={visibleColumns.length}>Loading report…</td></tr>
              : error ? <tr><td colSpan={visibleColumns.length}>Report rows are unavailable until access or connection issues are resolved.</td></tr>
              : rows.length ? rows.map((row, index) => <tr key={String(row.id ?? row.customerId ?? row.receiptReference ?? row.quotationNumber ?? index) + ":" + index}>{visibleColumns.map(column => <td key={column.key}>{valueText(row[column.key])}</td>)}</tr>)
              : <tr><td colSpan={visibleColumns.length}>No matching records. Try a wider date range or remove a filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="report-pagination"><span>Showing {rows.length ? offset + 1 : 0}–{offset + rows.length} of {total}</span><div><button className="button button--secondary" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button><button className="button button--secondary" disabled={!hasMore || loading} onClick={() => setOffset(value => value + 25)}>Next</button></div></div>
    </div>
  );
}
