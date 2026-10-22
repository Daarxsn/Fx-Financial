"use client";

import { useEffect, useState, type FormEvent } from "react";

type EventRow = {
  id: string; source: string; action: string; resourceType: string; resourceId: string;
  outcome: string; actorDisplayName: string | null; reason: string | null; createdAt: string | Date;
};
type AuditFilters = { from: string; to: string; query: string; resourceType: string; legalEntityId: string };
const resources = [
  ["", "All resource types"], ["invoice", "Invoice"], ["quotation", "Quotation"], ["payment", "Payment"],
  ["customer", "Customer"], ["catalog_item", "Item / service"], ["legal_entity", "Legal entity"],
  ["brand", "Brand"], ["tax_rule", "Tax rule"], ["invoice_numbering_config", "Numbering configuration"],
  ["invoice_document_template", "Document template"], ["business_policy_decision", "Policy decision"],
  ["invoice_correction_request", "Correction request"], ["generated_document", "Generated document"],
  ["email_outbox", "Email delivery"], ["reminder_policy", "Reminder policy"], ["report_export", "Report export"],
];
function dateString(date: Date) { return date.toISOString().slice(0, 10); }
function initialFilters(): AuditFilters {
  const end = new Date(), start = new Date(end.getTime() - 29 * 86400000);
  return { from: dateString(start), to: dateString(end), query: "", resourceType: "", legalEntityId: "" };
}
function queryString(filters: AuditFilters, offset: number) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, limit: "25", offset: String(offset) });
  if (filters.query.trim()) params.set("query", filters.query.trim());
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  if (filters.legalEntityId.trim()) params.set("legalEntityId", filters.legalEntityId.trim());
  return params.toString();
}
function displayDate(value: string | Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
async function readResponse(response: Response) {
  try { return await response.json() as { data?: EventRow[]; meta?: { pagination?: { total?: number; hasMore?: boolean } }; error?: { message?: string } }; }
  catch { return null; }
}

export function AuditWorkspace() {
  const [draft, setDraft] = useState<AuditFilters>(() => initialFilters());
  const [applied, setApplied] = useState<AuditFilters>(() => initialFilters());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/v1/audit?" + queryString(applied, offset), {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        const payload = await readResponse(response);
        if (!active) return;
        if (!response.ok) throw new Error(payload?.error?.message ?? "The audit trail could not be loaded.");
        setEvents(Array.isArray(payload?.data) ? payload.data : []);
        setTotal(Number(payload?.meta?.pagination?.total ?? 0));
        setHasMore(Boolean(payload?.meta?.pagination?.hasMore));
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setEvents([]);
        setTotal(0);
        setHasMore(false);
        setError(cause instanceof Error ? cause.message : "The audit trail could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [applied, offset, refresh]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...draft });
  }

  return (
    <section className="audit-workspace" aria-label="Audit event search">
      <div className="report-notice report-notice--info" role="note">
        <strong>Append-only event history</strong>
        <span>This view returns event metadata and a limited reason only. It deliberately omits before/after payloads, provider payloads, credentials and session tokens.</span>
      </div>
      <form className="report-filter-panel audit-filter-panel" onSubmit={apply}>
        <label className="form-field"><span>From date</span><input className="form-control" type="date" required value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></label>
        <label className="form-field"><span>To date</span><input className="form-control" type="date" required value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></label>
        <label className="form-field"><span>Resource type</span><select className="form-control" value={draft.resourceType} onChange={event => setDraft(current => ({ ...current, resourceType: event.target.value }))}>{resources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="form-field"><span>Search</span><input className="form-control" maxLength={100} value={draft.query} onChange={event => setDraft(current => ({ ...current, query: event.target.value }))} placeholder="Action, resource ID or actor" /></label>
        <label className="form-field"><span>Legal entity ID (optional)</span><input className="form-control" maxLength={36} value={draft.legalEntityId} onChange={event => setDraft(current => ({ ...current, legalEntityId: event.target.value }))} placeholder="Narrow your assigned scope" /></label>
        <div className="report-filter-actions"><button className="button button--primary" type="submit">Search history</button><button className="button button--secondary" type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      </form>
      {error ? <div className="report-notice report-notice--error" role="alert"><strong>Audit events unavailable</strong><span>{error}</span></div> : null}
      <div className="report-section-heading"><div><h2>Recorded actions</h2><p>{loading ? "Searching the selected period…" : total + " matching event" + (total === 1 ? "" : "s") + " · newest first · 25 per page"}</p></div></div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th><th>Reason</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>Loading audit events…</td></tr>
              : error ? <tr><td colSpan={6}>Audit events could not be loaded. Check access or connection, then retry.</td></tr>
              : events.length ? events.map(row => <tr key={row.source + ":" + row.id}>
                <td>{displayDate(row.createdAt)}</td><td>{row.actorDisplayName || "System / unavailable"}</td>
                <td><strong>{row.action}</strong><small className="audit-source">{row.source}</small></td>
                <td><span>{row.resourceType}</span><small className="audit-source">{row.resourceId}</small></td>
                <td><span className={"audit-outcome " + (row.outcome === "SUCCESS" ? "audit-outcome--success" : "audit-outcome--failure")}>{row.outcome}</span></td>
                <td>{row.reason || "—"}</td>
              </tr>)
              : <tr><td colSpan={6}>No events match the selected scope and period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="report-pagination"><span>Showing {events.length ? offset + 1 : 0}–{offset + events.length} of {total}</span><div>
        <button className="button button--secondary" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button>
        <button className="button button--secondary" disabled={!hasMore || loading} onClick={() => setOffset(value => value + 25)}>Next</button>
      </div></div>
    </section>
  );
}
