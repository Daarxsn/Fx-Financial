"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";

type LineKind = "ITEM" | "CHARGE";
type DiscountType = "AMOUNT" | "PERCENT";
type LineDraft = {
  key: string; catalogItemId: string; lineKind: LineKind; description: string; unitCode: string;
  quantity: string; unitPrice: string; discountType: DiscountType; discountValue: string; taxCode: string;
};
type Entity = { id: string; name: string; currency: string; taxSetupStatus: string };
type Customer = { id: string; name: string; customerCode: string | null; email: string | null; paymentTermsDays: number | null };
type CatalogItem = { id: string; itemCode: string | null; itemType: string; name: string; description: string; unitCode: string; defaultUnitPrice: string; currency: string; defaultTaxCode: string | null };
type TaxRule = { id: string; legalEntityId: string; taxCode: string; displayName: string; ratePercent: string; calculationMode: "EXCLUSIVE" | "INCLUSIVE"; effectiveFrom: string; effectiveUntil: string | null };
type Options = { legalEntities: Entity[]; customers: Customer[]; catalogItems: CatalogItem[]; taxRules: TaxRule[] };
type Quotation = {
  id: string; legalEntityId: string; brandId: string | null; customerId: string; customerName: string;
  quotationNumber: string | null; status: string; issueDate: string | null; validUntil: string | null; currency: string;
  subtotal: string; discountTotal: string; taxableValue: string; taxTotal: string; grandTotal: string;
  notes?: string | null; paymentTermsDays?: number; recordVersion: number; convertedInvoiceId: string | null;
  createdAt?: string; updatedAt?: string; lines?: Array<Record<string, unknown>>;
};
type ApiPayload = {
  data?: unknown; meta?: { pagination?: { total: number; limit: number; offset: number; hasMore: boolean } };
  error?: { code?: string; message?: string; fields?: Record<string, string> };
};
type FormState = {
  legalEntityId: string; brandId: string; customerId: string; currency: string;
  quotationDate: string; validUntil: string; paymentTermsDays: string; notes: string;
};
type PendingStatus = { quotation: Quotation; status: "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED" };

const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const freshLine = (): LineDraft => ({
  key: crypto.randomUUID(), catalogItemId: "", lineKind: "ITEM", description: "", unitCode: "unit",
  quantity: "1.0000", unitPrice: "0.0000", discountType: "AMOUNT", discountValue: "0.0000", taxCode: "",
});
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
const dateValue = (value: unknown): string => {
  const text = str(value);
  return text.length >= 10 ? text.slice(0, 10) : "";
};
const linesFrom = (value: unknown): LineDraft[] => Array.isArray(value) && value.length
  ? value.map(item => {
    const line = record(item);
    return {
      key: crypto.randomUUID(), catalogItemId: str(line.catalogItemId), lineKind: line.lineKind === "CHARGE" ? "CHARGE" : "ITEM",
      description: str(line.description), unitCode: str(line.unitCode) || "unit",
      quantity: str(line.quantity) || "1.0000", unitPrice: str(line.unitPrice) || "0.0000",
      discountType: line.discountType === "PERCENT" ? "PERCENT" : "AMOUNT",
      discountValue: str(line.discountValue) || "0.0000", taxCode: str(line.taxCode),
    };
  })
  : [freshLine()];

export function QuotationWorkspace() {
  const router = useRouter();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [options, setOptions] = useState<Options>({ legalEntities: [], customers: [], catalogItems: [], taxRules: [] });
  const [rows, setRows] = useState<Quotation[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Quotation | null>(null);
  const [form, setForm] = useState<FormState>({
    legalEntityId: "", brandId: "", customerId: "", currency: "", quotationDate: today(),
    validUntil: daysFromToday(30), paymentTermsDays: "0", notes: "",
  });
  const [lines, setLines] = useState<LineDraft[]>([freshLine()]);
  const [pendingStatus, setPendingStatus] = useState<PendingStatus | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [createKey, setCreateKey] = useState(() => "q-" + crypto.randomUUID());
  const limit = 25;
  const canRead = permissions.includes("quotations:read");
  const canWrite = permissions.includes("quotations:write");
  const selectedEntity = options.legalEntities.find(entity => entity.id === form.legalEntityId);
  const applicableTaxRules = useMemo(
    () => options.taxRules.filter(rule => rule.legalEntityId === form.legalEntityId),
    [options.taxRules, form.legalEntityId],
  );
  const missingSetup = !optionsLoading && canWrite && (!options.legalEntities.length || !options.customers.length);

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init, cache: "no-store",
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    let body: ApiPayload = {};
    try { body = await response.json() as ApiPayload; } catch { /* use a safe fallback below */ }
    return { response, body };
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
      const body = await response.json() as { data?: { user?: { permissions?: string[] } } };
      if (response.ok) setPermissions(body.data?.user?.permissions ?? []);
    } catch { /* APIs remain authoritative if the profile request fails */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await request(
        "/api/v1/quotations?status=" + encodeURIComponent(status) +
        "&query=" + encodeURIComponent(query) + "&limit=" + limit + "&offset=" + offset,
      );
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Quotations could not be loaded.");
      const data = Array.isArray(result.body.data) ? result.body.data as Quotation[] : [];
      setRows(data);
      setTotal(Number(result.body.meta?.pagination?.total ?? 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quotations could not be loaded.");
    } finally { setLoading(false); }
  }, [offset, query, request, status]);

  const refreshOptions = useCallback(async () => {
    if (!canWrite) return;
    setOptionsLoading(true);
    try {
      const result = await request("/api/v1/quotations/draft-options");
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Quotation options could not be loaded.");
      setOptions((result.body.data ?? { legalEntities: [], customers: [], catalogItems: [], taxRules: [] }) as Options);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quotation options could not be loaded.");
    } finally { setOptionsLoading(false); }
  }, [canWrite, request]);

  useEffect(() => { Promise.resolve().then(refreshProfile); }, [refreshProfile]);
  useEffect(() => { Promise.resolve().then(refresh); }, [refresh]);
  useEffect(() => { Promise.resolve().then(refreshOptions); }, [refreshOptions]);

  const getCsrf = async (): Promise<string> => {
    const response = await fetch("/api/v1/auth/csrf", { cache: "no-store" });
    const body = await response.json() as { data?: { csrfToken?: string }; error?: { message?: string } };
    if (!response.ok || !body.data?.csrfToken) {
      throw new Error(body.error?.message ?? "Security verification failed. Refresh the page and retry.");
    }
    return body.data.csrfToken;
  };
  const mutate = async (url: string, method: string, payload: unknown, idempotencyKey?: string) => {
    const token = await getCsrf();
    return request(url, {
      method,
      headers: { "X-CSRF-Token": token, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: JSON.stringify(payload),
    });
  };

  const setFormValue = (key: keyof FormState, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
    if (key === "legalEntityId") {
      const entity = options.legalEntities.find(item => item.id === value);
      setForm(current => ({ ...current, legalEntityId: value, currency: entity?.currency ?? current.currency }));
      setLines(current => current.map(line => ({ ...line, taxCode: "" })));
    }
    setCreateKey("q-" + crypto.randomUUID());
  };

  const startNew = () => {
    const entity = options.legalEntities[0];
    const customer = options.customers[0];
    setSelected(null);
    setForm({
      legalEntityId: entity?.id ?? "", brandId: "", customerId: customer?.id ?? "",
      currency: entity?.currency ?? "", quotationDate: today(), validUntil: daysFromToday(30),
      paymentTermsDays: String(customer?.paymentTermsDays ?? 0), notes: "",
    });
    setLines([freshLine()]);
    setEditorOpen(true);
    setPendingStatus(null);
    setActionReason("");
    setSuccess("");
    setError("");
    setCreateKey("q-" + crypto.randomUUID());
  };

  const openQuotation = async (id: string) => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const result = await request("/api/v1/quotations/" + id);
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Quotation could not be opened.");
      const quote = record(result.body.data) as unknown as Quotation;
      setSelected(quote);
      setForm({
        legalEntityId: quote.legalEntityId, brandId: quote.brandId ?? "", customerId: quote.customerId,
        currency: quote.currency, quotationDate: quote.issueDate ?? today(), validUntil: quote.validUntil ?? "",
        paymentTermsDays: String(quote.paymentTermsDays ?? 0), notes: quote.notes ?? "",
      });
      setLines(linesFrom(quote.lines));
      setEditorOpen(false);
      setPendingStatus(null);
      setActionReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quotation could not be opened.");
    } finally { setSaving(false); }
  };

  const payload = () => ({
    legalEntityId: form.legalEntityId, brandId: form.brandId || null, customerId: form.customerId,
    currency: form.currency, invoiceDate: form.quotationDate || null, dueDate: null,
    validUntil: form.validUntil || null, paymentTermsDays: Number(form.paymentTermsDays), notes: form.notes || null,
    lines: lines.map(line => ({
      ...(line.catalogItemId ? { catalogItemId: line.catalogItemId } : {}),
      lineKind: line.lineKind, description: line.description.trim(), unitCode: line.unitCode.trim(),
      quantity: line.quantity, unitPrice: line.unitPrice, discountType: line.discountType,
      discountValue: line.discountValue, taxCode: line.taxCode.trim() || null,
    })),
  });

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.legalEntityId || !form.customerId) {
      setError("Select a legal entity and customer before saving this quotation.");
      return;
    }
    if (!lines.length || lines.some(line => !line.description.trim())) {
      setError("Each quotation line needs a description.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await mutate(
        selected ? "/api/v1/quotations/" + selected.id : "/api/v1/quotations",
        selected ? "PATCH" : "POST",
        selected ? { ...payload(), expectedVersion: selected.recordVersion } : payload(),
        selected ? undefined : createKey,
      );
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Quotation draft could not be saved.");
      const saved = record(result.body.data);
      const id = str(saved.id) || selected?.id || "";
      setEditorOpen(false);
      await refresh();
      if (id) await openQuotation(id);
      setSuccess(selected ? "Quotation draft saved." : "Quotation draft created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quotation draft could not be saved.");
    } finally { setSaving(false); }
  };

  const changeStatus = async () => {
    if (!pendingStatus) return;
    const pending = pendingStatus;
    if (["REJECTED", "CANCELLED", "EXPIRED"].includes(pending.status) && actionReason.trim().length < 3) {
      setError("Enter a reason of at least 3 characters for this action.");
      return;
    }
    setActionBusy(pending.quotation.id);
    setError("");
    setSuccess("");
    try {
      const payloadValue: Record<string, unknown> = {
        status: pending.status, expectedVersion: pending.quotation.recordVersion,
      };
      if (actionReason.trim()) payloadValue.reason = actionReason.trim();
      const result = await mutate(
        "/api/v1/quotations/" + pending.quotation.id + "/status", "POST", payloadValue,
      );
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Quotation status could not be changed.");
      const data = record(result.body.data);
      setSuccess(str(data.message) || "Quotation status changed.");
      setPendingStatus(null);
      setActionReason("");
      await refresh();
      await openQuotation(pending.quotation.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quotation status could not be changed.");
    } finally { setActionBusy(""); }
  };

  const convertToInvoice = async (quote: Quotation) => {
    setActionBusy(quote.id);
    setError("");
    setSuccess("");
    try {
      const result = await mutate(
        "/api/v1/quotations/" + quote.id + "/convert", "POST", {},
        "qconv-" + crypto.randomUUID(),
      );
      if (!result.response.ok) throw new Error(result.body.error?.message ?? "Quotation could not be converted to an invoice draft.");
      const data = record(result.body.data);
      setSuccess("Invoice draft created from the accepted quotation (" + str(data.invoiceId).slice(0, 8) + ").");
      await refresh();
      await openQuotation(quote.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quotation could not be converted.");
    } finally { setActionBusy(""); }
  };

  const openEditor = (quote: Quotation) => {
    setSelected(quote);
    setEditorOpen(true);
    setError("");
    setSuccess("");
    setForm({
      legalEntityId: quote.legalEntityId, brandId: quote.brandId ?? "", customerId: quote.customerId,
      currency: quote.currency, quotationDate: quote.issueDate ?? today(), validUntil: quote.validUntil ?? "",
      paymentTermsDays: String(quote.paymentTermsDays ?? 0), notes: quote.notes ?? "",
    });
    setLines(linesFrom(quote.lines));
  };
  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  const money = (currency: string, value: unknown) => currency + " " + (str(value) || "0.0000");
  const currentStatus = (quote: Quotation) => quote.status;
  const statusTone = (value: string) =>
    value === "ACCEPTED" || value === "CONVERTED" ? "success" as const :
    value === "REJECTED" || value === "CANCELLED" || value === "EXPIRED" ? "danger" as const :
    value === "SENT" ? "info" as const : "warning" as const;

  return <div className="invoice-workspace quotation-workspace">
    <div className="invoice-workspace-toolbar">
      <div className="invoice-workspace-search">
        <label className="form-label" htmlFor="quotation-search">Search quotations</label>
        <input id="quotation-search" className="form-control" value={query} placeholder="Quotation number or customer"
          onChange={event => { setQuery(event.target.value); setOffset(0); }} />
      </div>
      <div>
        <label className="form-label" htmlFor="quotation-status">Status</label>
        <select id="quotation-status" className="form-control" value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }}>
          <option value="all">All statuses</option><option value="DRAFT">Draft</option><option value="SENT">Sent</option>
          <option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option><option value="CANCELLED">Cancelled</option><option value="CONVERTED">Converted</option>
        </select>
      </div>
      {canWrite ? <Button disabled={optionsLoading || !options.legalEntities.length || !options.customers.length} onClick={startNew}>+ New quotation</Button> : null}
    </div>

    <InlineAlert tone="info" title="Quotation lifecycle">
      Create and edit drafts here, mark a quote as sent to freeze its approved numbering and configuration, record the customer decision, and convert accepted quotations into invoice drafts. PDF generation and actual email delivery are not available yet.
    </InlineAlert>
    {error ? <InlineAlert tone="danger" title="Quotation action needs attention">{error}</InlineAlert> : null}
    {success ? <InlineAlert tone="success" title="Quotation updated">{success}</InlineAlert> : null}
    {missingSetup ? <InlineAlert tone="warning" title="Quotation creation is not configured">
      No active legal entity or customer is available to your account. An administrator must grant a legal-entity scope and ensure the customer directory has active records. No fake defaults are created.
    </InlineAlert> : null}
    {optionsLoading ? <LoadingState label="Loading legal entities, customers, catalog and approved tax rules…" /> : null}
    {!canRead ? <InlineAlert tone="warning" title="Quotation read permission required">
      Your role does not have quotations:read. The API enforces this permission even when the workspace is open.
    </InlineAlert> : null}
    <div className="invoice-workspace-summary">
      <strong>{loading ? "Loading quotations…" : total + " " + (total === 1 ? "quotation" : "quotations")}</strong>
      <span>Drafts do not consume official quotation numbers. Numbering is allocated only when the quote is marked sent.</span>
    </div>

    <div className="data-table-scroll">
      <table className="data-table">
        <thead><tr><th>Quotation</th><th>Customer</th><th>Status</th><th>Quote date</th><th>Valid until</th><th>Total</th><th>Actions</th></tr></thead>
        <tbody>
          {!loading && !rows.length ? <tr><td colSpan={7}><EmptyState title="No quotations found"
            description="Create a quotation from approved customer and legal-entity data. Totals are calculated by the server and no sample amounts are fabricated."
            icon="quote" action={canWrite ? <Button onClick={startNew} disabled={optionsLoading || missingSetup}>+ New quotation</Button> : null} /></td></tr> : null}
          {rows.map(quote => <tr key={quote.id}>
            <td><strong>{quote.quotationNumber || "Draft · " + quote.id.slice(0, 8)}</strong><div className="invoice-workspace-muted">{quote.currency}</div></td>
            <td>{quote.customerName}</td>
            <td><StatusBadge tone={statusTone(currentStatus(quote))}>{currentStatus(quote)}</StatusBadge></td>
            <td>{quote.issueDate || "Draft"}</td>
            <td>{quote.validUntil || "No expiry"}</td>
            <td>{money(quote.currency, quote.grandTotal)}</td>
            <td><div className="master-data-actions">
              <Button variant="secondary" size="sm" disabled={saving || Boolean(actionBusy)} onClick={() => void openQuotation(quote.id)}>Details</Button>
              {canWrite && quote.status === "DRAFT" ? <Button size="sm" variant="secondary" disabled={saving || Boolean(actionBusy)} onClick={() => void openQuotation(quote.id).then(() => setEditorOpen(true))}>Edit</Button> : null}
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="master-data-pagination">
      <span>Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + rows.length, total)} of {total}</span>
      <div><Button variant="secondary" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={loading || offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button></div>
    </div>

    {editorOpen ? <section className="invoice-editor" aria-labelledby="quotation-editor-title">
      <div className="invoice-editor__heading"><div><p className="page-eyebrow">{selected ? "EDIT QUOTATION DRAFT" : "NEW QUOTATION"}</p>
        <h2 id="quotation-editor-title">{selected ? "Edit quotation draft" : "Create quotation"}</h2>
        <p>All prices and tax calculations are revalidated by the server. An accepted or sent quotation cannot be edited.</p></div>
        <Button variant="ghost" onClick={() => setEditorOpen(false)}>Close</Button></div>
      <form onSubmit={saveDraft}>
        <div className="invoice-form-grid">
          <div className="invoice-form-field"><label className="form-label" htmlFor="quotation-entity">Legal entity</label>
            <select id="quotation-entity" className="form-control" required disabled={Boolean(selected)} value={form.legalEntityId}
              onChange={event => setFormValue("legalEntityId", event.target.value)}>
              <option value="">Select legal entity</option>{options.legalEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.name} · {entity.currency}</option>)}
            </select></div>
          <div className="invoice-form-field"><label className="form-label" htmlFor="quotation-customer">Customer</label>
            <select id="quotation-customer" className="form-control" required value={form.customerId} onChange={event => {
              const customer = options.customers.find(item => item.id === event.target.value);
              setForm(current => ({ ...current, customerId: event.target.value, paymentTermsDays: String(customer?.paymentTermsDays ?? current.paymentTermsDays) }));
            }}><option value="">Select customer</option>{options.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.customerCode ? " · " + customer.customerCode : ""}</option>)}</select></div>
          <div className="invoice-form-field"><label className="form-label" htmlFor="quotation-currency">Currency</label>
            <input id="quotation-currency" className="form-control" readOnly aria-readonly="true" value={form.currency} /></div>
          <div className="invoice-form-field"><label className="form-label" htmlFor="quotation-date">Quotation date</label>
            <input id="quotation-date" className="form-control" type="date" value={form.quotationDate} onChange={event => setFormValue("quotationDate", event.target.value)} /></div>
          <div className="invoice-form-field"><label className="form-label" htmlFor="quotation-valid-until">Valid until</label>
            <input id="quotation-valid-until" className="form-control" type="date" min={form.quotationDate || undefined} value={form.validUntil}
              onChange={event => setFormValue("validUntil", event.target.value)} /></div>
          <div className="invoice-form-field"><label className="form-label" htmlFor="quotation-payment-terms">Payment terms (days)</label>
            <input id="quotation-payment-terms" className="form-control" type="number" min="0" max="3650" step="1" value={form.paymentTermsDays}
              onChange={event => setFormValue("paymentTermsDays", event.target.value)} /></div>
          <div className="invoice-form-field invoice-form-field--wide"><label className="form-label" htmlFor="quotation-notes">Notes</label>
            <textarea id="quotation-notes" className="form-control form-control--textarea" maxLength={5000} value={form.notes}
              onChange={event => setFormValue("notes", event.target.value)} /></div>
        </div>

        <div className="invoice-editor__lines-heading"><div><h3>Quote lines and additional charges</h3>
          <p className="form-hint">Select approved tax codes only. Do not use customer-specific or unapproved rates.</p></div>
          <Button type="button" variant="secondary" disabled={lines.length >= 500} onClick={() => setLines(current => [...current, freshLine()])}>+ Add line</Button></div>
        {lines.map((line, index) => <div className="invoice-line-card" key={line.key}>
          <div className="invoice-line-card__head"><strong>Line {index + 1}</strong>
            <select aria-label={"Line " + (index + 1) + " type"} className="form-control" value={line.lineKind}
              onChange={event => updateLine(line.key, { lineKind: event.target.value as LineKind })}>
              <option value="ITEM">Item / service</option><option value="CHARGE">Additional charge</option></select>
            {lines.length > 1 ? <Button type="button" variant="ghost" size="sm" onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>Remove</Button> : null}</div>
          {line.lineKind === "ITEM" ? <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-catalog-" + line.key}>Catalog item (optional)</label>
            <select id={"quotation-catalog-" + line.key} className="form-control" value={line.catalogItemId} onChange={event => {
              const item = options.catalogItems.find(entry => entry.id === event.target.value);
              updateLine(line.key, item ? { catalogItemId: item.id, description: item.name, unitCode: item.unitCode,
                unitPrice: item.defaultUnitPrice, taxCode: item.defaultTaxCode ?? "" } : { catalogItemId: "" });
            }}><option value="">Manual line</option>{options.catalogItems.filter(item => item.currency === form.currency).map(item =>
              <option key={item.id} value={item.id}>{item.itemCode ? item.itemCode + " · " : ""}{item.name}</option>)}</select></div> : null}
          <div className="invoice-line-grid">
            <div className="invoice-form-field invoice-form-field--wide"><label className="form-label" htmlFor={"quotation-description-" + line.key}>Description</label>
              <input id={"quotation-description-" + line.key} className="form-control" required maxLength={1000} value={line.description}
                onChange={event => updateLine(line.key, { description: event.target.value })} /></div>
            <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-unit-" + line.key}>Unit</label>
              <input id={"quotation-unit-" + line.key} className="form-control" required maxLength={40} value={line.unitCode}
                onChange={event => updateLine(line.key, { unitCode: event.target.value })} /></div>
            <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-quantity-" + line.key}>Quantity</label>
              <input id={"quotation-quantity-" + line.key} className="form-control" required inputMode="decimal" value={line.quantity}
                onChange={event => updateLine(line.key, { quantity: event.target.value })} /></div>
            <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-rate-" + line.key}>Unit rate</label>
              <input id={"quotation-rate-" + line.key} className="form-control" required inputMode="decimal" value={line.unitPrice}
                onChange={event => updateLine(line.key, { unitPrice: event.target.value })} /></div>
            <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-discount-type-" + line.key}>Discount type</label>
              <select id={"quotation-discount-type-" + line.key} className="form-control" value={line.discountType}
                onChange={event => updateLine(line.key, { discountType: event.target.value as DiscountType })}><option value="AMOUNT">Fixed amount</option><option value="PERCENT">Percent</option></select></div>
            <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-discount-value-" + line.key}>{line.discountType === "PERCENT" ? "Discount (%)" : "Discount amount"}</label>
              <input id={"quotation-discount-value-" + line.key} className="form-control" required inputMode="decimal" value={line.discountValue}
                onChange={event => updateLine(line.key, { discountValue: event.target.value })} /></div>
            <div className="invoice-form-field"><label className="form-label" htmlFor={"quotation-tax-" + line.key}>Approved tax code</label>
              <select id={"quotation-tax-" + line.key} className="form-control" value={line.taxCode} onChange={event => updateLine(line.key, { taxCode: event.target.value })}>
                <option value="">No tax code</option>{applicableTaxRules.map(rule => <option key={rule.id} value={rule.taxCode}>{rule.taxCode} · {rule.ratePercent}% · {rule.calculationMode.toLowerCase()}</option>)}
              </select></div>
          </div>
        </div>)}
        <div className="invoice-editor__calculation"><p>Totals are not estimated in the browser. Save this draft to see exact server-calculated amounts.</p></div>
        <div className="invoice-editor__actions"><Button variant="secondary" type="button" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</Button>
          <Button type="submit" disabled={saving || optionsLoading || !canWrite || !form.legalEntityId || !form.customerId}>
            {saving ? "Saving…" : selected ? "Save quotation draft" : "Create quotation draft"}
          </Button></div>
      </form>
    </section> : null}

    {selected && !editorOpen ? <section className="invoice-editor" aria-labelledby="quotation-detail-title">
      <div className="invoice-editor__heading"><div><p className="page-eyebrow">QUOTATION DETAILS</p>
        <h2 id="quotation-detail-title">{selected.quotationNumber || "Draft · " + selected.id.slice(0, 8)}</h2>
        <p>{selected.customerName} · {selected.status} · Valid until {selected.validUntil || "not set"}</p></div>
        <Button variant="ghost" onClick={() => { setSelected(null); setPendingStatus(null); }}>Close details</Button></div>
      <div className="invoice-editor__calculation">
        <div><span>Subtotal</span><strong>{money(selected.currency, selected.subtotal)}</strong></div>
        <div><span>Discount total</span><strong>− {money(selected.currency, selected.discountTotal)}</strong></div>
        <div><span>Taxable value</span><strong>{money(selected.currency, selected.taxableValue)}</strong></div>
        <div><span>Tax</span><strong>{money(selected.currency, selected.taxTotal)}</strong></div>
        <div className="invoice-editor__grand"><span>Grand total</span><strong>{money(selected.currency, selected.grandTotal)}</strong></div>
      </div>
      {Array.isArray(selected.lines) ? <div className="data-table-scroll"><table className="data-table">
        <thead><tr><th>Description</th><th>Quantity</th><th>Unit rate</th><th>Discount</th><th>Tax</th><th>Line total</th></tr></thead>
        <tbody>{selected.lines.map((unknownLine, index) => {
          const line = record(unknownLine);
          return <tr key={str(line.id) || String(index)}><td>{str(line.description)}</td><td>{str(line.quantity)} {str(line.unitCode)}</td>
            <td>{money(selected.currency, line.unitPrice)}</td><td>{str(line.discountType) === "PERCENT" ? str(line.discountValue) + "%" : money(selected.currency, line.discountValue)}</td>
            <td>{str(line.taxCode) || "No tax"} · {money(selected.currency, line.taxAmount)}</td><td>{money(selected.currency, line.lineTotal)}</td></tr>;
        })}</tbody>
      </table></div> : null}
      {selected.convertedInvoiceId ? <InlineAlert tone="success" title="Converted to invoice">
        Invoice draft ID: {selected.convertedInvoiceId}. Open the Invoices workspace to review it.
        <div className="invoice-editor__actions"><Button onClick={() => router.push("/invoices")}>Open invoices</Button></div>
      </InlineAlert> : null}
      {canWrite && selected.status === "DRAFT" ? <div className="invoice-editor__actions">
        <Button variant="secondary" onClick={() => openEditor(selected)}>Edit draft</Button>
        <Button onClick={() => { setPendingStatus({ quotation: selected, status: "SENT" }); setActionReason(""); }}>Mark as sent</Button>
        <Button variant="danger" onClick={() => { setPendingStatus({ quotation: selected, status: "CANCELLED" }); setActionReason(""); }}>Cancel draft</Button>
      </div> : null}
      {canWrite && selected.status === "SENT" ? <div className="invoice-editor__actions">
        <Button onClick={() => { setPendingStatus({ quotation: selected, status: "ACCEPTED" }); setActionReason(""); }}>Mark accepted</Button>
        <Button variant="secondary" onClick={() => { setPendingStatus({ quotation: selected, status: "REJECTED" }); setActionReason(""); }}>Mark rejected</Button>
        <Button variant="danger" onClick={() => { setPendingStatus({ quotation: selected, status: "CANCELLED" }); setActionReason(""); }}>Cancel quotation</Button>
        {selected.validUntil && selected.validUntil < today() ? <Button variant="secondary" onClick={() => { setPendingStatus({ quotation: selected, status: "EXPIRED" }); setActionReason(""); }}>Mark expired</Button> : null}
      </div> : null}
      {canWrite && selected.status === "ACCEPTED" && !selected.convertedInvoiceId ? <div className="invoice-editor__actions">
        <Button disabled={Boolean(actionBusy)} onClick={() => void convertToInvoice(selected)}>{actionBusy === selected.id ? "Converting…" : "Convert to invoice draft"}</Button>
      </div> : null}
      {selected.status === "SENT" ? <InlineAlert tone="warning" title="Delivery is not automated yet">
        “Mark as sent” records the quotation lifecycle and freezes the approved configuration snapshot. It does not send email or produce a PDF; those are the next delivery phase.
      </InlineAlert> : null}
      {pendingStatus?.quotation.id === selected.id ? <section className="master-data-panel master-data-panel--narrow" aria-labelledby="quotation-status-action-title">
        <div className="master-data-panel__heading"><div><p className="page-eyebrow">CONFIRM QUOTATION ACTION</p>
          <h3 id="quotation-status-action-title">{pendingStatus.status === "SENT" ? "Mark quotation as sent?" : "Change quotation to " + pendingStatus.status.toLowerCase() + "?"}</h3>
          <p>{pendingStatus.status === "SENT" ? "This reserves the official quotation number and saves the issuer, customer and configuration snapshot. It will not email a document." : "This action is recorded in the audit trail."}</p>
        </div></div>
        {["REJECTED", "CANCELLED", "EXPIRED"].includes(pendingStatus.status) ? <div className="form-field">
          <label className="form-label" htmlFor="quotation-status-reason">Reason (required)</label>
          <textarea id="quotation-status-reason" className="form-control form-control--textarea" minLength={3} maxLength={500}
            value={actionReason} onChange={event => setActionReason(event.target.value)} />
        </div> : null}
        <div className="master-data-form-actions">
          <Button variant="secondary" disabled={Boolean(actionBusy)} onClick={() => setPendingStatus(null)}>Back</Button>
          <Button disabled={Boolean(actionBusy) || (["REJECTED", "CANCELLED", "EXPIRED"].includes(pendingStatus.status) && actionReason.trim().length < 3)}
            onClick={() => void changeStatus()}>{actionBusy === selected.id ? "Updating…" : "Confirm action"}</Button>
        </div>
      </section> : null}
    </section> : null}
  </div>;
}
