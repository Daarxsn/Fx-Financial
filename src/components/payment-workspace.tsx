"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, EmptyState, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";

type Entity = { id: string; legalName: string; name: string; currency: string };
type Customer = { id: string; customerCode: string | null; name: string; email: string | null };
type Allocation = { id: string; invoiceId: string; invoiceNumber: string | null; invoiceStatus: string; amount: string; createdAt: string };
type Reversal = { id: string; amount: string; currency: string; reason: string; reversedBy: string; reversedAt: string; idempotencyKey: string };
type Receipt = {
  id: string; receiptReference: string; legalEntityId: string; customerId: string; amount: string;
  allocatedAmount: string; unallocatedAmount: string; currency: string; paymentDate: string; method: string;
  reference: string | null; status: "RECORDED" | "REVERSED"; notes: string | null; createdAt: string;
  reversedAt: string | null; reversalReason: string | null; customerSnapshot: Record<string, unknown> | null;
  legalEntitySnapshot: Record<string, unknown> | null; allocations?: Allocation[]; reversalEvents?: Reversal[];
};
type Invoice = { id: string; invoiceNumber: string | null; customerId: string; legalEntityId: string; currency: string; grandTotal: string; outstandingBalance: string; lifecycleStatus: string; paymentStatus: string };
type Api = { data?: unknown; meta?: { pagination?: { limit: number; offset: number; total: number; hasMore: boolean } }; error?: { code?: string; message?: string } };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const today = () => {
  const value = new Date();
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
};
const key = () => crypto.randomUUID() + "-" + crypto.randomUUID();
const SCALE = 10_000n;
function units(value: string): bigint {
  const parts = value.split(".");
  return BigInt(parts[0]) * SCALE + BigInt(((parts[1] ?? "") + "0000").slice(0, 4));
}
function money(value: bigint): string { return (value / SCALE).toString() + "." + (value % SCALE).toString().padStart(4, "0"); }
function minimumMoney(a: string, b: string): string { return money(units(a) < units(b) ? units(a) : units(b)); }

export function PaymentWorkspace() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [queryStatus, setQueryStatus] = useState("all");
  const [form, setForm] = useState({ legalEntityId: "", customerId: "", amount: "", currency: "", paymentDate: today(), method: "BANK_TRANSFER", reference: "", notes: "" });
  const [createKey, setCreateKey] = useState(() => key());
  const [availableInvoices, setAvailableInvoices] = useState<Invoice[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");
  const [allocationKey, setAllocationKey] = useState(() => key());
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseKey, setReverseKey] = useState(() => key());
  const canRead = permissions.includes("payments:read");
  const canRecord = permissions.includes("payments:record");
  const canReverse = permissions.includes("payments:reverse");

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init, cache: "no-store",
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    let body: Api = {};
    try { body = await response.json() as Api; } catch { /* a safe generic error is shown below */ }
    return { response, body };
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
      const body = await response.json() as { data?: { user?: { permissions?: string[] } } };
      if (response.ok) setPermissions(body.data?.user?.permissions ?? []);
    } catch { setError("Your access profile could not be loaded. Refresh the page and try again."); }
  }, []);

  const refreshReceipts = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const result = await request("/api/v1/payments?limit=25&offset=" + offset + "&status=" + encodeURIComponent(queryStatus === "all" ? "" : queryStatus));
      // The empty status is omitted in the next request so that unfiltered history is truly unfiltered.
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Receipts could not be loaded.");
      setReceipts(Array.isArray(result.body.data) ? result.body.data as Receipt[] : []);
      setTotal(Number(result.body.meta?.pagination?.total ?? 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipts could not be loaded.");
    } finally { setLoading(false); }
  }, [canRead, offset, queryStatus, request]);

  const refreshOptions = useCallback(async () => {
    if (!canRecord) return;
    setOptionsLoading(true);
    try {
      const result = await request("/api/v1/payments/options");
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Receipt options could not be loaded.");
      const data = record(result.body.data);
      const entityItems = Array.isArray(data.legalEntities) ? data.legalEntities as Entity[] : [];
      const customerItems = Array.isArray(data.customers) ? data.customers as Customer[] : [];
      setEntities(entityItems);
      setCustomers(customerItems);
      if (!form.legalEntityId && entityItems.length) {
        setForm(current => ({ ...current, legalEntityId: entityItems[0].id, currency: entityItems[0].currency }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt options could not be loaded.");
    } finally { setOptionsLoading(false); }
  }, [canRecord, form.legalEntityId, request]);

  useEffect(() => { void refreshProfile(); }, [refreshProfile]);
  useEffect(() => { void refreshReceipts(); }, [refreshReceipts]);
  useEffect(() => { void refreshOptions(); }, [refreshOptions]);

  const csrf = async () => {
    const response = await fetch("/api/v1/auth/csrf", { cache: "no-store" });
    const body = await response.json() as { data?: { csrfToken?: string } };
    if (!response.ok || !body.data?.csrfToken) throw new Error("Security verification expired. Refresh the page and try again.");
    return body.data.csrfToken;
  };
  const post = async (url: string, body: Record<string, unknown>, idempotencyKey: string) => {
    const token = await csrf();
    return request(url, { method: "POST", headers: { "X-CSRF-Token": token, "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  };

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm(current => {
      const next = { ...current, [field]: value };
      if (field === "legalEntityId") next.currency = entities.find(entity => entity.id === value)?.currency ?? "";
      return next;
    });
    setCreateKey(key());
  };

  const receiptName = (receipt: Receipt) => str(receipt.customerSnapshot?.name) || customers.find(customer => customer.id === receipt.customerId)?.name || receipt.customerId.slice(0, 8);
  const openReceipt = async (id: string) => {
    setError("");
    setActionBusy(id);
    try {
      const result = await request("/api/v1/payments/" + id);
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Receipt detail could not be loaded.");
      const receipt = record(result.body.data) as unknown as Receipt;
      setSelected(receipt);
      setReverseOpen(false);
      setReverseReason("");
      setReverseKey(key());
      const unallocated = str(receipt.unallocatedAmount) || "0.0000";
      if (receipt.status === "RECORDED" && units(unallocated) > 0n) {
        setInvoiceLoading(true);
        try {
          const invoicesResult = await request("/api/v1/invoices?status=ISSUED&legalEntityId=" + encodeURIComponent(receipt.legalEntityId) +
            "&customerId=" + encodeURIComponent(receipt.customerId) + "&limit=100&offset=0");
          if (!invoicesResult.response.ok) throw new Error(invoicesResult.body.error?.message ?? "Eligible invoices could not be loaded.");
          const invoiceItems = Array.isArray(invoicesResult.body.data) ? invoicesResult.body.data as Invoice[] : [];
          const eligible = invoiceItems.filter(invoice => invoice.lifecycleStatus === "ISSUED" && invoice.currency === receipt.currency &&
            invoice.customerId === receipt.customerId && units(invoice.outstandingBalance) > 0n);
          setAvailableInvoices(eligible);
          setInvoiceId(eligible[0]?.id ?? "");
          if (eligible[0]) setAllocationAmount(minimumMoney(unallocated, eligible[0].outstandingBalance));
          else setAllocationAmount(unallocated);
        } catch (cause) {
          setAvailableInvoices([]);
          setInvoiceId("");
          setAllocationAmount(unallocated);
          setError(cause instanceof Error ? cause.message : "Eligible invoices could not be loaded.");
        } finally { setInvoiceLoading(false); }
      } else {
        setAvailableInvoices([]);
        setInvoiceId("");
        setAllocationAmount("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt detail could not be loaded.");
    } finally { setActionBusy(""); }
  };

  const createReceipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setError(""); setSuccess("");
    try {
      const result = await post("/api/v1/payments", {
        legalEntityId: form.legalEntityId, customerId: form.customerId, amount: form.amount,
        currency: form.currency, paymentDate: form.paymentDate, method: form.method,
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }, createKey);
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Receipt could not be recorded.");
      const data = record(result.body.data);
      setSuccess("Receipt " + str(data.receiptReference) + " recorded. Invoice balances change only when an allocation is made.");
      setForm(current => ({ ...current, amount: "", reference: "", notes: "" }));
      setCreateKey(key());
      await refreshReceipts();
      if (str(data.id)) await openReceipt(str(data.id));
      setSuccess("Receipt " + str(data.receiptReference) + " recorded. Invoice balances change only when an allocation is made.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt could not be recorded."); }
    finally { setSaving(false); }
  };

  const allocateReceipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !invoiceId) { setError("Select an eligible issued invoice."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const result = await post("/api/v1/invoices/" + invoiceId + "/allocations", { paymentId: selected.id, amount: allocationAmount }, allocationKey);
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Receipt allocation failed.");
      setSuccess("Receipt allocation saved. The server updated the invoice balance using recorded allocations.");
      setAllocationKey(key());
      await refreshReceipts();
      await openReceipt(selected.id);
      setSuccess("Receipt allocation saved. The server updated the invoice balance using recorded allocations.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt allocation failed."); }
    finally { setSaving(false); }
  };

  const reverseReceipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || reverseReason.trim().length < 3) { setError("Enter a reversal reason of at least 3 characters."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const result = await post("/api/v1/payments/" + selected.id + "/reverse", { reason: reverseReason.trim() }, reverseKey);
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Receipt reversal failed.");
      setReverseOpen(false);
      await refreshReceipts();
      await openReceipt(selected.id);
      setSuccess("Receipt reversed. Its allocation history remains available and linked invoice balances have been restored.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt reversal failed."); }
    finally { setSaving(false); }
  };

  const selectedInvoice = availableInvoices.find(invoice => invoice.id === invoiceId);
  const statusTone = (status: string) => status === "RECORDED" ? "success" as const : "danger" as const;
  const pagination = useMemo(() => ({ start: total ? offset + 1 : 0, end: Math.min(total, offset + receipts.length) }), [offset, receipts.length, total]);

  return <div className="invoice-workspace payment-workspace">
    <div className="invoice-workspace-toolbar">
      <div><p className="page-eyebrow">RECEIPTS AND ALLOCATIONS</p><h2>Payment ledger</h2><p className="form-hint">Receipts are not bank confirmations. Allocations change invoice balances; reversals preserve ledger history.</p></div>
      <div>
        <label className="form-label" htmlFor="payments-status">Receipt status</label>
        <select id="payments-status" className="form-control" value={queryStatus} onChange={event => { setQueryStatus(event.target.value); setOffset(0); }}>
          <option value="all">All statuses</option><option value="RECORDED">Recorded</option><option value="REVERSED">Reversed</option>
        </select>
      </div>
    </div>
    {!canRead ? <InlineAlert tone="warning" title="Payment history access is not assigned">Assign payments:read and the appropriate legal-entity scope to view receipts and allocations.</InlineAlert> : null}
    {canRead && !canRecord ? <InlineAlert tone="info" title="Read-only payment access">You can review receipts, allocations and reversals, but cannot record or change them.</InlineAlert> : null}
    {error ? <InlineAlert tone="danger" title="Payment action needs attention">{error}</InlineAlert> : null}
    {success ? <InlineAlert tone="success" title="Payment ledger updated">{success}</InlineAlert> : null}

    {canRecord ? <section className="invoice-editor" aria-labelledby="receipt-create-title">
      <div className="invoice-editor__heading"><div><p className="page-eyebrow">NEW RECEIPT</p><h3 id="receipt-create-title">Record payment received</h3>
        <p>A receipt is recorded manually. It remains unallocated until you apply it to an issued invoice.</p></div></div>
      {optionsLoading ? <LoadingState label="Loading legal entities and customers…" /> : null}
      {!optionsLoading && (!entities.length || !customers.length) ? <InlineAlert tone="warning" title="Receipt setup is unavailable">An active legal entity and customer are required. Ask an administrator to set up the relevant records and access scope.</InlineAlert> : null}
      <form onSubmit={createReceipt}>
        <div className="invoice-form-grid">
          <div className="invoice-form-field"><label htmlFor="receipt-entity" className="form-label">Legal entity</label>
            <select id="receipt-entity" className="form-control" required value={form.legalEntityId} onChange={event => updateForm("legalEntityId", event.target.value)}>
              <option value="">Select legal entity</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name} · {entity.currency}</option>)}
            </select></div>
          <div className="invoice-form-field"><label htmlFor="receipt-customer" className="form-label">Customer</label>
            <select id="receipt-customer" className="form-control" required value={form.customerId} onChange={event => updateForm("customerId", event.target.value)}>
              <option value="">Select customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.customerCode ? " · " + customer.customerCode : ""}</option>)}
            </select></div>
          <div className="invoice-form-field"><label htmlFor="receipt-amount" className="form-label">Amount</label>
            <input id="receipt-amount" className="form-control" required inputMode="decimal" value={form.amount} onChange={event => updateForm("amount", event.target.value)} placeholder="0.0000" /></div>
          <div className="invoice-form-field"><label htmlFor="receipt-currency" className="form-label">Currency</label>
            <input id="receipt-currency" className="form-control" readOnly aria-readonly="true" value={form.currency} /></div>
          <div className="invoice-form-field"><label htmlFor="receipt-date" className="form-label">Payment date</label>
            <input id="receipt-date" className="form-control" type="date" required value={form.paymentDate} onChange={event => updateForm("paymentDate", event.target.value)} /></div>
          <div className="invoice-form-field"><label htmlFor="receipt-method" className="form-label">Payment method</label>
            <select id="receipt-method" className="form-control" value={form.method} onChange={event => updateForm("method", event.target.value)}>
              <option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="UPI">UPI</option>
              <option value="CARD">Card</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option>
            </select></div>
          <div className="invoice-form-field"><label htmlFor="receipt-reference" className="form-label">External reference (optional)</label>
            <input id="receipt-reference" className="form-control" maxLength={160} value={form.reference} onChange={event => updateForm("reference", event.target.value)} /></div>
          <div className="invoice-form-field invoice-form-field--wide"><label htmlFor="receipt-notes" className="form-label">Notes (optional)</label>
            <textarea id="receipt-notes" className="form-control form-control--textarea" maxLength={2000} value={form.notes} onChange={event => updateForm("notes", event.target.value)} /></div>
        </div>
        <div className="invoice-editor__actions"><Button type="submit" disabled={saving || optionsLoading || !form.legalEntityId || !form.customerId}>{saving ? "Recording…" : "Record receipt"}</Button></div>
      </form>
    </section> : null}

    <div className="invoice-workspace-summary"><strong>{loading ? "Loading receipts…" : total + " " + (total === 1 ? "receipt" : "receipts")}</strong>
      <span>Reference is immutable. Totals are exact to four decimal places; a reversed receipt remains visible.</span></div>
    <div className="data-table-scroll"><table className="data-table">
      <thead><tr><th>Receipt</th><th>Customer</th><th>Payment date</th><th>Amount</th><th>Allocated</th><th>Unallocated</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {!loading && !receipts.length ? <tr><td colSpan={8}><EmptyState icon="wallet" title="No receipts found" description="Record a manually received payment, then allocate it to one or more eligible issued invoices when appropriate." /></td></tr> : null}
        {receipts.map(receipt => <tr key={receipt.id}>
          <td><strong>{receipt.receiptReference}</strong><div className="invoice-workspace-muted">{receipt.currency} · {receipt.method}</div></td>
          <td>{receiptName(receipt)}</td><td>{receipt.paymentDate}</td><td>{receipt.currency} {receipt.amount}</td><td>{receipt.currency} {receipt.allocatedAmount}</td><td>{receipt.currency} {receipt.unallocatedAmount}</td>
          <td><StatusBadge tone={statusTone(receipt.status)}>{receipt.status}</StatusBadge></td>
          <td><Button size="sm" variant="secondary" disabled={Boolean(actionBusy)} onClick={() => void openReceipt(receipt.id)}>{actionBusy === receipt.id ? "Loading…" : "Details"}</Button></td>
        </tr>)}
      </tbody>
    </table></div>
    <div className="master-data-pagination"><span>Showing {pagination.start}–{pagination.end} of {total}</span><div>
      <Button size="sm" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button>
      <Button size="sm" variant="secondary" disabled={loading || offset + receipts.length >= total} onClick={() => setOffset(offset + 25)}>Next</Button>
    </div></div>

    {selected ? <section className="invoice-editor" aria-labelledby="receipt-detail-title">
      <div className="invoice-editor__heading"><div><p className="page-eyebrow">RECEIPT DETAILS</p><h3 id="receipt-detail-title">{selected.receiptReference}</h3>
        <p>{receiptName(selected)} · {selected.status} · {selected.currency} {selected.amount}</p></div>
        <Button variant="ghost" onClick={() => { setSelected(null); setReverseOpen(false); }}>Close details</Button>
      </div>
      <div className="invoice-editor__calculation">
        <div><span>Receipt amount</span><strong>{selected.currency} {selected.amount}</strong></div>
        <div><span>Allocated total</span><strong>{selected.currency} {selected.allocatedAmount}</strong></div>
        <div className="invoice-editor__grand"><span>Unallocated balance</span><strong>{selected.currency} {selected.unallocatedAmount}</strong></div>
        <div><span>Payment date / method</span><strong>{selected.paymentDate} · {selected.method}</strong></div>
        <div><span>Reference</span><strong>{selected.reference || "Not supplied"}</strong></div>
      </div>
      {selected.customerSnapshot ? <InlineAlert tone="info" title="Customer identity captured on receipt">{str(selected.customerSnapshot.name)} · {str(selected.customerSnapshot.email) || "No email recorded"} · Billing details retained as an immutable receipt snapshot.</InlineAlert> : null}
      {Array.isArray(selected.allocations) && selected.allocations.length ? <div className="data-table-scroll"><table className="data-table">
        <thead><tr><th>Invoice</th><th>Current invoice status</th><th>Allocation amount</th><th>Created at</th></tr></thead>
        <tbody>{selected.allocations.map(allocation => <tr key={allocation.id}><td>{allocation.invoiceNumber || allocation.invoiceId}</td><td>{allocation.invoiceStatus}</td><td>{selected.currency} {allocation.amount}</td><td>{String(allocation.createdAt)}</td></tr>)}</tbody>
      </table></div> : <p className="form-hint">This receipt has no allocations. It has not changed any invoice balance.</p>}

      {canRecord && selected.status === "RECORDED" && units(selected.unallocatedAmount) > 0n ? <section className="master-data-panel master-data-panel--narrow" aria-labelledby="receipt-allocation-title">
        <div className="master-data-panel__heading"><div><h4 id="receipt-allocation-title">Allocate receipt</h4><p>Only active issued invoices for the same customer, entity and currency are eligible.</p></div></div>
        {invoiceLoading ? <LoadingState label="Loading eligible invoices…" /> : null}
        {!invoiceLoading && !availableInvoices.length ? <InlineAlert tone="warning" title="No eligible invoice">There is no visible issued invoice with an outstanding balance for this receipt. You can leave the receipt unallocated.</InlineAlert> : null}
        {availableInvoices.length ? <form onSubmit={allocateReceipt}>
          <div className="invoice-form-grid">
            <div className="invoice-form-field invoice-form-field--wide"><label htmlFor="receipt-invoice" className="form-label">Issued invoice</label>
              <select id="receipt-invoice" className="form-control" required value={invoiceId} onChange={event => {
                const target = availableInvoices.find(item => item.id === event.target.value);
                setInvoiceId(event.target.value);
                if (target) setAllocationAmount(minimumMoney(selected.unallocatedAmount, target.outstandingBalance));
                setAllocationKey(key());
              }}>
                <option value="">Select invoice</option>{availableInvoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber || invoice.id.slice(0, 8)} · {invoice.currency} {invoice.outstandingBalance} outstanding</option>)}
              </select></div>
            <div className="invoice-form-field"><label htmlFor="receipt-allocation-amount" className="form-label">Amount to allocate</label>
              <input id="receipt-allocation-amount" className="form-control" required inputMode="decimal" value={allocationAmount} onChange={event => { setAllocationAmount(event.target.value); setAllocationKey(key()); }} /></div>
          </div>
          {selectedInvoice ? <p className="form-hint">This invoice currently has {selectedInvoice.currency} {selectedInvoice.outstandingBalance} outstanding. The server enforces all limits.</p> : null}
          <div className="invoice-editor__actions"><Button type="submit" disabled={saving || invoiceLoading || !invoiceId}>{saving ? "Allocating…" : "Save allocation"}</Button></div>
        </form> : null}
      </section> : null}

      {canReverse && selected.status === "RECORDED" ? <div className="invoice-editor__actions">
        {!reverseOpen ? <Button variant="danger" onClick={() => { setReverseOpen(true); setReverseReason(""); setReverseKey(key()); }}>Reverse receipt</Button> : null}
      </div> : null}
      {reverseOpen && canReverse && selected.status === "RECORDED" ? <section className="master-data-panel master-data-panel--narrow" aria-labelledby="receipt-reversal-title">
        <div className="master-data-panel__heading"><div><h4 id="receipt-reversal-title">Confirm full receipt reversal</h4>
          <p>This reverses the entire receipt. Linked invoice balances are recalculated from the remaining recorded allocations; no receipt or allocation rows are deleted.</p></div></div>
        <form onSubmit={reverseReceipt}>
          <div className="invoice-form-field"><label htmlFor="receipt-reversal-reason" className="form-label">Reason (required)</label>
            <textarea id="receipt-reversal-reason" className="form-control form-control--textarea" required minLength={3} maxLength={1000} value={reverseReason}
              onChange={event => { setReverseReason(event.target.value); setReverseKey(key()); }} /></div>
          <div className="invoice-editor__actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => setReverseOpen(false)}>Keep receipt</Button>
            <Button type="submit" variant="danger" disabled={saving || reverseReason.trim().length < 3}>{saving ? "Reversing…" : "Confirm reversal"}</Button></div>
        </form>
      </section> : null}
      {selected.status === "REVERSED" ? <InlineAlert tone="warning" title="Receipt reversed">{selected.reversalReason || "No reason stored"}. The receipt and allocation history remain retained.</InlineAlert> : null}
      {Array.isArray(selected.reversalEvents) && selected.reversalEvents.length ? <div className="data-table-scroll"><table className="data-table">
        <thead><tr><th>Reversal event</th><th>Amount</th><th>Reason</th><th>Reversed at</th></tr></thead>
        <tbody>{selected.reversalEvents.map(event => <tr key={event.id}><td>{event.id}</td><td>{event.currency} {event.amount}</td><td>{event.reason}</td><td>{String(event.reversedAt)}</td></tr>)}</tbody>
      </table></div> : null}
    </section> : null}
  </div>;
}
