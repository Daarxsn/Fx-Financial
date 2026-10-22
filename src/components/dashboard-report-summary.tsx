"use client";

import { useEffect, useState } from "react";

type SummaryRow = {
  legalEntityId: string;
  legalEntityName: string;
  currency: string;
  issuedInvoiceCount: number;
  issuedInvoiceValue: string;
  quotationsWonCount: number;
  quotationsWonValue: string;
  recordedReceiptCount: number;
  recordedReceiptValue: string;
  reversedReceiptCount: number;
  reversedReceiptValue: string;
  currentOutstandingBalance: string;
  currentOverdueBalance: string;
  currentOverdueInvoiceCount: number;
};
type SummaryPayload = { data?: { summaries?: SummaryRow[]; asOf?: string; metricDefinitionsStatus?: string } };

function day(value: Date) { return value.toISOString().slice(0, 10); }

export function DashboardReportSummary() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      const end = new Date();
      const start = new Date(end.getTime() - 29 * 86400000);
      const from = day(start), to = day(end);
      setPeriod({ from, to });
      try {
        const response = await fetch("/api/v1/reports/summary?from=" + from + "&to=" + to, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          setHidden(true);
          return;
        }
        let body: SummaryPayload | null = null;
        try { body = await response.json() as SummaryPayload; } catch { /* handled below */ }
        if (!response.ok) throw new Error("Reporting summary is temporarily unavailable.");
        if (!active) return;
        setRows(Array.isArray(body?.data?.summaries) ? body.data.summaries : []);
        setAsOf(body?.data?.asOf ?? "");
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : "Reporting summary is temporarily unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, []);

  if (hidden) return null;
  return (
    <section className="dashboard-report-summary" aria-labelledby="dashboard-report-summary-title">
      <div className="dashboard-report-summary__header">
        <div>
          <p className="eyebrow">OPERATIONAL SNAPSHOT</p>
          <h2 id="dashboard-report-summary-title">Reporting snapshot</h2>
          <p>{period.from && period.to ? period.from + " to " + period.to : "Last 30 calendar days"} · current balances shown as a separate snapshot{asOf ? " as of " + new Date(asOf).toLocaleString() : ""}</p>
        </div>
        <span className="dashboard-report-summary__provisional">Finance approval pending</span>
      </div>
      <p className="dashboard-report-summary__note">Provisional operational metrics. Records are grouped by legal entity and currency; amounts in different currencies are never combined.</p>
      {loading ? <p className="dashboard-report-summary__state" role="status">Loading scoped reporting metrics…</p>
        : error ? <p className="dashboard-report-summary__state dashboard-report-summary__state--error" role="alert">{error}</p>
        : rows.length ? <div className="dashboard-report-summary__grid">
          {rows.map(row => {
            const visualRows = [
              { label: "Issued invoice value", raw: row.issuedInvoiceValue, amount: Number.parseFloat(row.issuedInvoiceValue) || 0, tone: "" },
              { label: "Recorded receipts", raw: row.recordedReceiptValue, amount: Number.parseFloat(row.recordedReceiptValue) || 0, tone: " dashboard-report-card__bar-fill--receipt" },
              { label: "Current outstanding", raw: row.currentOutstandingBalance, amount: Number.parseFloat(row.currentOutstandingBalance) || 0, tone: " dashboard-report-card__bar-fill--outstanding" },
              { label: "Current overdue", raw: row.currentOverdueBalance, amount: Number.parseFloat(row.currentOverdueBalance) || 0, tone: " dashboard-report-card__bar-fill--overdue" },
            ];
            const maxAmount = Math.max(0, ...visualRows.map(item => item.amount));
            return (
              <article className="dashboard-report-card" key={row.legalEntityId + ":" + row.currency}>
                <header><div><h3>{row.legalEntityName}</h3><p>Legal entity scope</p></div><span>{row.currency}</span></header>
                <dl>
                  <div><dt>Issued invoice value</dt><dd>{row.currency} {row.issuedInvoiceValue}</dd><small>{row.issuedInvoiceCount} invoices in period</small></div>
                  <div><dt>Recorded receipt value</dt><dd>{row.currency} {row.recordedReceiptValue}</dd><small>{row.recordedReceiptCount} receipts in period</small></div>
                  <div><dt>Current outstanding</dt><dd>{row.currency} {row.currentOutstandingBalance}</dd><small>As-of snapshot</small></div>
                  <div><dt>Current overdue</dt><dd>{row.currency} {row.currentOverdueBalance}</dd><small>{row.currentOverdueInvoiceCount} overdue invoices</small></div>
                  <div><dt>Won quotations</dt><dd>{row.quotationsWonCount}</dd><small>{row.currency} {row.quotationsWonValue} provisional value</small></div>
                  <div><dt>Reversed receipts</dt><dd>{row.reversedReceiptCount}</dd><small>{row.currency} {row.reversedReceiptValue} by reversal date</small></div>
                </dl>
                <section className="dashboard-report-card__visual" aria-label={row.legalEntityName + " amount comparison"}>
                  <div className="dashboard-report-card__visual-head">
                    <strong>Amount profile</strong>
                    <span>Relative scale · this entity and currency</span>
                  </div>
                  <div className="dashboard-report-card__bars">
                    {visualRows.map(item => {
                      const ratio = maxAmount > 0 ? Math.min(100, (item.amount / maxAmount) * 100) : 0;
                      return (
                        <div className="dashboard-report-card__bar-row" key={item.label}>
                          <div className="dashboard-report-card__bar-label">
                            <span>{item.label}</span>
                            <strong>{row.currency} {item.raw}</strong>
                          </div>
                          <div className="dashboard-report-card__bar-track" role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={Math.max(maxAmount, 1)} aria-valuenow={Math.max(0, item.amount)}>
                            <span className={"dashboard-report-card__bar-fill" + item.tone} style={{ width: ratio + "%" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="dashboard-report-card__visual-foot">Issued invoices and receipts use the selected period. Outstanding and overdue balances are a current snapshot. Bars compare amounts only within the same entity and currency.</p>
                </section>
              </article>
            );
          })}
        </div>
        : <p className="dashboard-report-summary__state">No reporting activity is available for this period and your assigned entity scope.</p>}
    </section>
  );
}
