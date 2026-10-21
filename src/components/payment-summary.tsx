"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";

type Summary = {
  legalEntityId: string; legalEntityName: string; currency: string;
  issuedInvoiceCount: number; issuedInvoiceTotal: string; allocatedInvoiceTotal: string;
  outstandingBalance: string; overpaidInvoiceCount: number; recordedReceiptCount: number;
  recordedReceiptTotal: string; allocatedReceiptTotal: string; unallocatedReceiptTotal: string;
  reversedReceiptCount: number;
};
type ApiResponse = { data?: { summaries?: Summary[] }; error?: { message?: string } };

export function PaymentSummary() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/payments/summary", { cache: "no-store" });
      const body = await response.json() as ApiResponse;
      if (response.status === 401 || response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load the receivables snapshot.");
      setSummaries(Array.isArray(body.data?.summaries) ? body.data.summaries : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);
  useEffect(() => { Promise.resolve().then(() => refresh()); }, [refresh]);

  if (state === "loading") return <div className="payment-summary__state"><LoadingState label="Loading scoped receivables and receipts…" /></div>;
  if (state === "forbidden") return <InlineAlert tone="info" title="Payment summary is permission-scoped">Your role needs payment-history access and an assigned legal-entity scope to view these totals.</InlineAlert>;
  if (state === "error") return <InlineAlert tone="danger" title="Receivables snapshot unavailable">The current totals could not be loaded. Refresh the page and retry; no cached financial values are shown.</InlineAlert>;
  if (!summaries.length) return <EmptyState icon="wallet" title="No receivables to summarise" description="An issued invoice or recorded receipt in your assigned scope will appear here when one exists." />;

  return <div className="payment-summary">
    {summaries.map(summary => (
      <section className="payment-summary__entity" key={summary.legalEntityId + ":" + summary.currency}>
        <div className="payment-summary__entity-heading">
          <div><h3>{summary.legalEntityName}</h3><p>{summary.currency} · {summary.issuedInvoiceCount} issued {summary.issuedInvoiceCount === 1 ? "invoice" : "invoices"} · {summary.recordedReceiptCount} recorded {summary.recordedReceiptCount === 1 ? "receipt" : "receipts"}</p></div>
          <div className="payment-summary__statuses">
            {summary.reversedReceiptCount > 0 ? <StatusBadge tone="warning">{summary.reversedReceiptCount} reversed</StatusBadge> : null}
            {summary.overpaidInvoiceCount > 0 ? <StatusBadge tone="danger">{summary.overpaidInvoiceCount} reconciliation issue</StatusBadge> : null}
          </div>
        </div>
        <dl className="payment-summary__metrics">
          <div><dt>Issued invoice total</dt><dd>{summary.currency} {summary.issuedInvoiceTotal}</dd></div>
          <div><dt>Allocated to invoices</dt><dd>{summary.currency} {summary.allocatedInvoiceTotal}</dd></div>
          <div><dt>Outstanding balance</dt><dd>{summary.currency} {summary.outstandingBalance}</dd></div>
          <div><dt>Recorded receipt total</dt><dd>{summary.currency} {summary.recordedReceiptTotal}</dd></div>
          <div><dt>Allocated receipts</dt><dd>{summary.currency} {summary.allocatedReceiptTotal}</dd></div>
          <div><dt>Unallocated receipts</dt><dd>{summary.currency} {summary.unallocatedReceiptTotal}</dd></div>
        </dl>
        {summary.overpaidInvoiceCount > 0 ? <InlineAlert tone="danger" title="Invoice reconciliation needs review">At least one issued invoice has recorded allocations above its total. The snapshot exposes the discrepancy instead of hiding it.</InlineAlert> : null}
      </section>
    ))}
    <p className="payment-summary__footnote">Balances use recorded allocations and exclude reversed receipts. Totals are separated by legal entity and currency. A manually recorded receipt is not bank settlement confirmation.</p>
  </div>;
}
