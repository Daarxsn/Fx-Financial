"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Breadcrumbs, Button, EmptyState, InlineAlert, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { InvoiceCorrectionPanel } from "@/components/invoice-correction-panel";
import { DocumentHistoryPanel } from "@/components/document-history-panel";
import { EmailDeliveryPanel } from "@/components/email-delivery-panel";

type InvoiceLine = {
  id: string;
  catalogItemId: string | null;
  lineKind: string;
  milestone: string | null;
  description: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  discountType: string;
  discountValue: string;
  taxRatePercent: string;
  taxCode: string | null;
  taxAmount: string;
  lineTotal: string;
};

type InvoiceDetail = {
  id: string;
  legalEntityId: string;
  brandId: string | null;
  customerId: string;
  customerName: string;
  draftRecipientEmail: string | null;
  documentType: string;
  invoiceNumber: string | null;
  lifecycleStatus: "DRAFT" | "ISSUED" | "CANCELLED";
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxableValue: string;
  taxTotal: string;
  grandTotal: string;
  paidAmount: string;
  outstandingBalance: string;
  invoiceDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  taxMode: "LINE" | "COMPONENTS";
  cgstEnabled: boolean;
  cgstRate: string;
  cgstAmount: string;
  sgstEnabled: boolean;
  sgstRate: string;
  sgstAmount: string;
  paymentTermsDays: number;
  notes: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
  lines: InvoiceLine[];
};

type InvoicePayment = {
  id: string;
  invoiceId: string;
  receiptReference: string;
  customerId: string;
  amount: string;
  allocatedAmount: string;
  allocationCount: number;
  currency: string;
  paymentDate: string | null;
  method: string;
  reference: string | null;
  status: "RECORDED" | "REVERSED";
  notes: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
};

type Api = { data?: unknown; error?: { message?: string } };

function renderDeliverablesDescription(description: string) {
  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return <span style={{ color: "var(--muted)" }}>—</span>;
  const isNumbered = lines.every((l) => /^\d+\.\s+/.test(l));

  if (!isNumbered && !lines.some((l) => l.includes("Complimentary"))) {
    return <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.5" }}>{description}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {lines.map((line, idx) => {
        const textWithoutPrefix = isNumbered ? line.replace(/^\d+\.\s+/, "") : line.replace(/^[-•*]\s+/, "");
        const isPointComplimentary =
          textWithoutPrefix.includes("(Complimentary)") || textWithoutPrefix.includes("[Complimentary]");
        const cleanText = textWithoutPrefix
          .replace(/\(Complimentary\)/gi, "")
          .replace(/\[Complimentary\]/gi, "")
          .trim();

        return (
          <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "14px" }}>
            {isNumbered ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background: "var(--surface-subtle, #f1f5f9)",
                  border: "1px solid var(--line, #cbd5e1)",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--ink-strong)",
                  flexShrink: 0,
                  marginTop: "2px",
                }}
              >
                {idx + 1}
              </span>
            ) : lines.length > 1 ? (
              <span style={{ color: "var(--gold, #dcaf51)", fontWeight: "bold", fontSize: "14px", marginTop: "1px" }}>•</span>
            ) : null}
            <div style={{ flex: 1 }}>
              <span>{cleanText}</span>
              {isPointComplimentary && (
                <span
                  style={{
                    marginLeft: "8px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "#059669",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                  }}
                >
                  🎁 Complimentary
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params?.invoiceId as string;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPreview, setShowPreview] = useState(true);

  // Issuance State
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issuing, setIssuing] = useState(false);

  // Email State
  const [sendingEmail, setSendingEmail] = useState(false);

  // Payments State
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    method: "BANK_TRANSFER",
    reference: "",
    notes: "",
  });
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID() + crypto.randomUUID());

  // Reversal State
  const [reversingPaymentId, setReversingPaymentId] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const [reversalKey, setReversalKey] = useState(() => crypto.randomUUID() + crypto.randomUUID());

  const canIssue = permissions.includes("invoices:issue");
  const canUpdate = permissions.includes("invoices:draft:update");
  const canReadPayments = permissions.includes("payments:read");
  const canRecordPayment = permissions.includes("payments:record");
  const canReversePayment = permissions.includes("payments:reverse");
  const canSendEmail = permissions.includes("email:send");

  const csrf = async () => {
    const r = await fetch("/api/v1/auth/csrf", { cache: "no-store" });
    const b = (await r.json()) as { data?: { csrfToken?: string } };
    if (!r.ok || !b.data?.csrfToken) throw new Error("Validation expired. Refresh the page.");
    return b.data.csrfToken;
  };

  const loadPermissions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me", { cache: "no-store" });
      const body = (await res.json()) as { data?: { user?: { permissions?: string[] } } };
      if (res.ok) setPermissions(body.data?.user?.permissions ?? []);
    } catch {
      // Handled silently
    }
  }, []);

  const loadInvoice = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}`, { cache: "no-store" });
      const body = (await res.json()) as Api;
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to load invoice.");
      setInvoice(body.data as InvoiceDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  const loadPayments = useCallback(async () => {
    if (!invoiceId || !canReadPayments) return;
    setPaymentsLoading(true);
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/payments`, { cache: "no-store" });
      const body = (await res.json()) as Api;
      if (res.ok) setPayments(Array.isArray(body.data) ? (body.data as InvoicePayment[]) : []);
    } catch {
      // Handled silently
    } finally {
      setPaymentsLoading(false);
    }
  }, [invoiceId, canReadPayments]);

  useEffect(() => {
    void Promise.resolve().then(() => loadPermissions());
  }, [loadPermissions]);

  useEffect(() => {
    void Promise.resolve().then(() => loadInvoice());
  }, [loadInvoice]);

  useEffect(() => {
    if (invoice && canReadPayments) {
      void Promise.resolve().then(() => loadPayments());
    }
  }, [invoice, canReadPayments, loadPayments]);

  // Issue Action (Deliberate, verified flow)
  const handleIssueInvoice = async () => {
    if (!invoice || invoice.lifecycleStatus !== "DRAFT") return;
    setIssuing(true);
    setError("");
    setSuccess("");
    try {
      const token = await csrf();
      const issueKey = `fx-issue-${crypto.randomUUID()}-${crypto.randomUUID()}`;
      const res = await fetch(`/api/v1/invoices/${invoice.id}/issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Idempotency-Key": issueKey,
        },
        body: JSON.stringify({
          documentDate: invoice.invoiceDate || new Date().toISOString().slice(0, 10),
        }),
      });

      const body = (await res.json()) as Api;
      if (!res.ok) throw new Error(body.error?.message ?? "Invoice issuance failed.");

      setShowIssueModal(false);
      setSuccess("Invoice successfully issued! Sequential serial number allocated and immutable snapshot recorded.");
      await loadInvoice();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue invoice");
    } finally {
      setIssuing(false);
    }
  };

  // Send Transactional Email
  const handleSendEmail = async () => {
    if (!invoice || invoice.lifecycleStatus !== "ISSUED") return;
    const recipient = invoice.draftRecipientEmail;
    if (!recipient) {
      setError("No recipient email is saved on this invoice. Update customer email before sending.");
      return;
    }
    setSendingEmail(true);
    setError("");
    setSuccess("");
    try {
      const token = await csrf();
      const mailKey = crypto.randomUUID();
      const res = await fetch("/api/v1/email/outbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Idempotency-Key": mailKey,
        },
        body: JSON.stringify({
          sourceType: "INVOICE",
          sourceId: invoice.id,
          recipientEmail: recipient.trim(),
          recipientConfirmed: true,
        }),
      });

      const body = (await res.json()) as Api;
      if (!res.ok) throw new Error(body.error?.message ?? "Email delivery queue failed.");
      setSuccess(`Transactional email queued successfully for delivery to ${recipient}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue email");
    } finally {
      setSendingEmail(false);
    }
  };

  // Record Payment
  const handleRecordPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!invoice || invoice.lifecycleStatus !== "ISSUED") return;
    setRecordingPayment(true);
    setError("");
    setSuccess("");
    try {
      const token = await csrf();
      const res = await fetch(`/api/v1/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Idempotency-Key": paymentKey,
        },
        body: JSON.stringify({
          amount: paymentForm.amount,
          paymentDate: paymentForm.paymentDate,
          method: paymentForm.method,
          ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
          ...(paymentForm.notes.trim() ? { notes: paymentForm.notes.trim() } : {}),
        }),
      });

      const body = (await res.json()) as Api;
      if (!res.ok) throw new Error(body.error?.message ?? "Payment recording failed.");
      const receiptRef = (body.data as { receiptReference?: string })?.receiptReference || "Receipt";
      setPaymentForm((prev) => ({ ...prev, amount: "", reference: "", notes: "" }));
      setPaymentKey(crypto.randomUUID() + crypto.randomUUID());
      setSuccess(`Payment ${receiptRef} recorded and allocated to this invoice.`);
      await loadInvoice();
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setRecordingPayment(false);
    }
  };

  // Reverse Payment
  const handleReversePayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!reversingPaymentId || reversalReason.trim().length < 3) {
      setError("Please enter a reversal reason of at least 3 characters.");
      return;
    }
    setRecordingPayment(true);
    setError("");
    setSuccess("");
    try {
      const token = await csrf();
      const res = await fetch(`/api/v1/payments/${reversingPaymentId}/reverse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Idempotency-Key": reversalKey,
        },
        body: JSON.stringify({ reason: reversalReason.trim() }),
      });

      const body = (await res.json()) as Api;
      if (!res.ok) throw new Error(body.error?.message ?? "Reversal failed.");
      setReversingPaymentId("");
      setReversalReason("");
      setReversalKey(crypto.randomUUID() + crypto.randomUUID());
      setSuccess("Receipt reversed and ledger history retained.");
      await loadInvoice();
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reverse receipt");
    } finally {
      setRecordingPayment(false);
    }
  };

  const currencySymbol = invoice?.currency === "USD" ? "$" : invoice?.currency === "GBP" ? "£" : invoice?.currency === "EUR" ? "€" : "₹";

  if (loading) {
    return (
      <main className="page page--invoice-detail">
        <LoadingState label="Loading verified invoice records and snapshots…" />
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="page page--invoice-detail">
        <Breadcrumbs items={[{ label: "Workspace", href: "/" }, { label: "Invoices", href: "/invoices" }, { label: "Not Found" }]} />
        <div className="card" style={{ padding: "40px", textAlign: "center" }}>
          <EmptyState
            title="Invoice Not Found"
            description="The requested document does not exist or you do not have permission to view it."
            action={
              <Link href="/invoices" className="button button--primary button--md">
                Back to Invoices
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const isIssued = invoice.lifecycleStatus === "ISSUED";
  const isDraft = invoice.lifecycleStatus === "DRAFT";

  return (
    <main className="page page--invoice-detail">
      <Breadcrumbs
        items={[
          { label: "Workspace", href: "/" },
          { label: "Invoices", href: "/invoices" },
          { label: invoice.invoiceNumber || `Draft · ${invoice.id.slice(0, 8)}` },
        ]}
      />

      <PageHeader
        eyebrow={isIssued ? "OFFICIAL ISSUED INVOICE" : "PROFORMA INVOICE DRAFT"}
        title={invoice.invoiceNumber || `Draft · ${invoice.id.slice(0, 8)}`}
        description={`Customer: ${invoice.customerName} · Currency: ${invoice.currency} · Valid until: ${invoice.validUntil || "Not set"}`}
        action={
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
            <Link href="/invoices" className="button button--secondary button--md">
              ← Invoices List
            </Link>

            <a
              href={`/api/v1/invoices/${invoice.id}/preview?download=1&version=${invoice.recordVersion}`}
              className="button button--secondary button--md"
            >
              Download PDF
            </a>

            {isDraft && canIssue ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowIssueModal(true)}
              >
                ★ Issue Invoice
              </Button>
            ) : null}

            {isIssued && canSendEmail && invoice.draftRecipientEmail ? (
              <Button
                variant="secondary"
                size="md"
                disabled={sendingEmail}
                onClick={() => void handleSendEmail()}
              >
                {sendingEmail ? "Queueing Email…" : "Send PDF via Email"}
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <InlineAlert tone="danger" title="Notice">{error}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" title="Success">{success}</InlineAlert> : null}

      {/* DUAL STATUS BADGES (Exact CEO Requirement) */}
      <div className="card" style={{ padding: "18px 24px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Document Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--muted-strong)" }}>Document Status:</span>
            <StatusBadge tone={isIssued ? "success" : isDraft ? "warning" : "danger"}>
              {isIssued ? `ISSUED (${invoice.invoiceNumber})` : "DRAFT / NOT ISSUED"}
            </StatusBadge>
          </div>

          <div style={{ width: "1px", height: "20px", background: "var(--line)" }} />

          {/* Payment Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--muted-strong)" }}>Payment Status:</span>
            <StatusBadge tone={invoice.paymentStatus === "PAID" ? "success" : invoice.paymentStatus === "PARTIALLY_PAID" ? "warning" : "danger"}>
              {invoice.paymentStatus === "PAID" ? "PAID" : invoice.paymentStatus === "PARTIALLY_PAID" ? "PARTIALLY PAID" : "UNPAID"}
            </StatusBadge>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview((prev) => !prev)}
        >
          {showPreview ? "Hide PDF Preview" : "Show PDF Preview"}
        </Button>
      </div>

      {/* FINANCIAL CALCULATION SUMMARY CARD */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px", marginBottom: "24px" }}>
        <div className="card" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Subtotal (Net)</span>
          <strong style={{ display: "block", marginTop: "6px", fontSize: "20px", color: "var(--ink-strong)", fontVariantNumeric: "tabular-nums" }}>
            {currencySymbol} {parseFloat(invoice.subtotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="card" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            {invoice.taxMode === "COMPONENTS" && invoice.cgstEnabled && !invoice.sgstEnabled ? "IGST (18%)" : "CGST + SGST (18%)"}
          </span>
          <strong style={{ display: "block", marginTop: "6px", fontSize: "20px", color: "var(--ink-strong)", fontVariantNumeric: "tabular-nums" }}>
            {currencySymbol} {parseFloat(invoice.taxTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(145deg, var(--surface) 0%, var(--surface-subtle) 100%)", border: "1px solid color-mix(in srgb, var(--gold) 40%, var(--line))" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 800 }}>Grand Total</span>
          <strong style={{ display: "block", marginTop: "6px", fontSize: "24px", color: "var(--red)", fontWeight: 850, fontVariantNumeric: "tabular-nums" }}>
            {currencySymbol} {parseFloat(invoice.grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="card" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Total Paid</span>
          <strong style={{ display: "block", marginTop: "6px", fontSize: "20px", color: "var(--success)", fontVariantNumeric: "tabular-nums" }}>
            {currencySymbol} {parseFloat(invoice.paidAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div className="card" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Outstanding Balance</span>
          <strong style={{ display: "block", marginTop: "6px", fontSize: "20px", color: invoice.outstandingBalance === "0.0000" ? "var(--success)" : "var(--danger)", fontVariantNumeric: "tabular-nums" }}>
            {currencySymbol} {parseFloat(invoice.outstandingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>
      </div>

      {/* CLIENT PDF PREVIEW IFRAME */}
      {showPreview ? (
        <section className="card" style={{ padding: "20px", marginBottom: "26px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 750, color: "var(--ink-strong)" }}>Client PDF Document</h3>
              <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: "13px" }}>
                {isIssued ? "Official immutable A4 statutory invoice PDF." : "Official draft preview rendering with exact A4 template."}
              </p>
            </div>
            <a
              href={`/api/v1/invoices/${invoice.id}/preview?version=${invoice.recordVersion}`}
              target="_blank"
              rel="noreferrer"
              className="button button--secondary button--sm"
            >
              Open in New Tab ↗
            </a>
          </div>
          <iframe
            key={`${invoice.id}-${invoice.recordVersion}`}
            className="invoice-pdf-preview-frame"
            title="Invoice PDF"
            src={`/api/v1/invoices/${invoice.id}/preview?version=${invoice.recordVersion}`}
          />
        </section>
      ) : null}

      {/* LINE ITEMS TABLE */}
      <section className="card" style={{ padding: "24px", marginBottom: "26px" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 750, color: "var(--ink-strong)" }}>Line Items</h3>
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Service / Item</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Rate ({currencySymbol})</th>
                <th>Tax Amount</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, idx) => {
                const isZeroRate = parseFloat(l.unitPrice) === 0;
                const hasComplimentaryDeliverables =
                  l.description.includes("(Complimentary)") || l.description.includes("[Complimentary]");
                return (
                  <tr key={l.id || idx}>
                    <td>{idx + 1}</td>
                    <td>
                      <strong style={{ fontSize: "14px" }}>{l.milestone || "Service Item"}</strong>
                      {isZeroRate ? (
                        <div style={{ marginTop: "4px" }}>
                          <StatusBadge tone="success">COMPLIMENTARY</StatusBadge>
                        </div>
                      ) : hasComplimentaryDeliverables ? (
                        <div style={{ marginTop: "4px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 650,
                              padding: "2px 7px",
                              borderRadius: "4px",
                              background: "rgba(16, 185, 129, 0.08)",
                              color: "#059669",
                              border: "1px solid rgba(16, 185, 129, 0.2)",
                            }}
                          >
                            Includes Complimentary Items
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td style={{ maxWidth: "440px" }}>
                      {renderDeliverablesDescription(l.description)}
                    </td>
                    <td>{l.quantity}</td>
                    <td>{currencySymbol} {parseFloat(l.unitPrice).toFixed(2)}</td>
                    <td>{currencySymbol} {parseFloat(l.taxAmount).toFixed(2)}</td>
                    <td>
                      <strong>
                        {isZeroRate
                          ? "Complimentary"
                          : `${currencySymbol} ${parseFloat(l.lineTotal).toFixed(2)}`}
                      </strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* PAYMENTS & RECEIPT LEDGER (Only for Issued Invoices) */}
      {isIssued ? (
        <section className="card" style={{ padding: "24px", marginBottom: "26px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 750, color: "var(--ink-strong)" }}>Payments & Receipts Ledger</h3>
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px" }}>Traceable history of all receipts allocated to this invoice.</p>
            </div>
            <Link href="/payments" className="button button--secondary button--sm">
              Open Full Payment Ledger ↗
            </Link>
          </div>

          {paymentsLoading ? (
            <LoadingState label="Loading payment allocations…" />
          ) : payments.length ? (
            <div className="data-table-scroll" style={{ marginBottom: "20px" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt Reference</th>
                    <th>Date / Method</th>
                    <th>Amount</th>
                    <th>Allocated</th>
                    <th>Status</th>
                    <th>Reversal Reason</th>
                    {canReversePayment ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.receiptReference}</strong>
                        {p.allocationCount > 1 ? (
                          <div style={{ fontSize: "12px", color: "var(--muted)" }}>{p.allocationCount} chunks</div>
                        ) : null}
                      </td>
                      <td>{p.paymentDate || "—"} · {p.method}</td>
                      <td>{currencySymbol} {parseFloat(p.amount).toFixed(2)}</td>
                      <td>{currencySymbol} {parseFloat(p.allocatedAmount).toFixed(2)}</td>
                      <td>
                        <StatusBadge tone={p.status === "RECORDED" ? "success" : "danger"}>
                          {p.status}
                        </StatusBadge>
                      </td>
                      <td>{p.reversalReason || "—"}</td>
                      {canReversePayment ? (
                        <td>
                          {p.status === "RECORDED" ? (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => {
                                setReversingPaymentId(p.id);
                                setReversalReason("");
                              }}
                            >
                              Reverse Receipt
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "14px", margin: "14px 0" }}>No receipts recorded yet for this invoice.</p>
          )}

          {/* Record Payment Drawer / Form */}
          {canRecordPayment && invoice.outstandingBalance !== "0.0000" ? (
            <div style={{ marginTop: "20px", padding: "20px", borderRadius: "14px", border: "1px solid var(--line)", background: "var(--surface-subtle)" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: "15px", fontWeight: 750, color: "var(--ink-strong)" }}>
                Record Payment Received Against This Invoice
              </h4>
              <form onSubmit={handleRecordPayment}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
                  <div className="form-field">
                    <label className="form-label" htmlFor="pay-amount">
                      Amount ({currencySymbol}) <span className="form-required">*</span>
                    </label>
                    <input
                      id="pay-amount"
                      type="number"
                      step="0.01"
                      required
                      className="form-control"
                      placeholder={invoice.outstandingBalance}
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="pay-date">
                      Payment Date <span className="form-required">*</span>
                    </label>
                    <input
                      id="pay-date"
                      type="date"
                      required
                      className="form-control"
                      value={paymentForm.paymentDate}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentDate: e.target.value }))}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="pay-method">
                      Method
                    </label>
                    <select
                      id="pay-method"
                      className="form-control"
                      value={paymentForm.method}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, method: e.target.value }))}
                    >
                      <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Debit / Credit Card</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="pay-ref">
                      Transaction / UTR Reference
                    </label>
                    <input
                      id="pay-ref"
                      className="form-control"
                      placeholder="e.g. UTR12345678"
                      value={paymentForm.reference}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                  <Button type="submit" variant="primary" size="md" disabled={recordingPayment}>
                    {recordingPayment ? "Recording Payment…" : "Record Payment & Issue Receipt"}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {/* Reverse Payment Modal / Drawer */}
          {reversingPaymentId ? (
            <div style={{ marginTop: "20px", padding: "20px", borderRadius: "14px", border: "1px solid var(--danger)", background: "var(--danger-bg)" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: 750, color: "var(--danger)" }}>
                Confirm Receipt Reversal
              </h4>
              <p style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--muted-strong)" }}>
                This will reverse the receipt allocations and recalculate the outstanding balance.
              </p>
              <form onSubmit={handleReversePayment}>
                <div className="form-field">
                  <label className="form-label" htmlFor="rev-reason">
                    Reversal Reason (Required) <span className="form-required">*</span>
                  </label>
                  <textarea
                    id="rev-reason"
                    required
                    minLength={3}
                    className="form-control form-control--textarea"
                    placeholder="e.g. Cheque returned by bank / Incorrect amount received"
                    value={reversalReason}
                    onChange={(e) => setReversalReason(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "14px" }}>
                  <Button type="button" variant="secondary" onClick={() => setReversingPaymentId("")}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="danger" disabled={recordingPayment || reversalReason.trim().length < 3}>
                    {recordingPayment ? "Reversing…" : "Confirm Full Reversal"}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* CORRECTION REQUEST PANEL */}
      <InvoiceCorrectionPanel
        invoiceId={invoice.id}
        lifecycleStatus={invoice.lifecycleStatus}
        documentType={invoice.documentType}
        canRequest={canUpdate}
        canReview={permissions.includes("approvals:read")}
      />

      {/* DOCUMENT HISTORY & EMAIL DELIVERY (AUDIT TRAIL) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px", marginTop: "24px" }}>
        {isIssued ? <DocumentHistoryPanel sourceType="INVOICE" sourceId={invoice.id} /> : null}
        {isIssued ? <EmailDeliveryPanel sourceType="INVOICE" sourceId={invoice.id} /> : null}
      </div>

      {/* DELIBERATE ISSUANCE CONFIRMATION MODAL (Strictly on Review Page!) */}
      {showIssueModal ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="issue-modal-title">
          <div className="confirm-dialog" style={{ width: "min(100%, 540px)", borderRadius: "16px", padding: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "22px" }}>🏛️</span>
              <h2 id="issue-modal-title" style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "var(--ink-strong)" }}>
                Issue Official Statutory Invoice
              </h2>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: "1.6", margin: "0 0 16px" }}>
              Issuing this invoice will allocate the official sequential serial number (<strong>26001..2600n</strong>), establish statutory GST liability, and generate an immutable PDF audit record.
            </p>
            <div style={{ margin: "16px 0", padding: "16px", borderRadius: "12px", background: "var(--surface-subtle)", border: "1px solid var(--line)", fontSize: "13.5px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Legal Supplier:</span>
                <strong style={{ color: "var(--ink-strong)" }}>Falchion Xeniaa Pvt. Ltd.</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Client Name:</span>
                <strong style={{ color: "var(--ink-strong)" }}>{invoice.customerName}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Numbering Format:</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--primary)" }}>26001..2600n (Series 2026)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Tax Jurisdiction:</span>
                <span>{invoice.taxMode === "COMPONENTS" && invoice.cgstEnabled && !invoice.sgstEnabled ? "IGST 18%" : "CGST 9% + SGST 9%"}</span>
              </div>
              <div style={{ width: "100%", height: "1px", background: "var(--line)", margin: "4px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "var(--ink-strong)", fontWeight: 700 }}>Grand Total Payable:</span>
                <strong style={{ fontSize: "20px", color: "var(--red)", fontWeight: 850 }}>
                  {currencySymbol} {parseFloat(invoice.grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </strong>
              </div>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: "12px", color: "var(--muted)" }}>
              ⚠️ Note: Financial data and line items are locked upon issuance. Future changes require an audit-logged correction request.
            </p>
            <div className="confirm-dialog__actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <Button variant="secondary" onClick={() => setShowIssueModal(false)} disabled={issuing}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleIssueInvoice()} disabled={issuing}>
                {issuing ? "Allocating Number & Issuing…" : "Confirm & Issue Official Invoice"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
