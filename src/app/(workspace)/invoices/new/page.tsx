"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Breadcrumbs, Button, InlineAlert, LoadingState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icon";

type LineKind = "ITEM" | "CHARGE";
type DiscountType = "AMOUNT" | "PERCENT";

type StructuredPoint = {
  id: string;
  text: string;
  isComplimentary: boolean;
};

type CreateLineDraft = {
  key: string;
  catalogItemId: string;
  lineKind: LineKind;
  serviceName: string; // Formerly milestone (renamed per CEO requirements)
  description: string;
  structuredPoints: StructuredPoint[]; // For 1. _____, 2. _____ input mode with per-point complimentary flags
  useStructuredMode: boolean; // Toggle between structured point inputs and freeform textarea
  unitCode: string;
  quantity: string;
  unitPrice: string;
  discountType: DiscountType;
  discountValue: string;
  taxCode: string;
  complimentary: boolean; // whole line complimentary toggle if user specifically creates a standalone complimentary line
};

type Entity = { id: string; name: string; currency: string; taxSetupStatus: string };
type Customer = {
  id: string;
  name: string;
  customerCode: string | null;
  email: string | null;
  phone: string | null;
  taxIdentifier?: string | null;
  billingAddress?: { line1?: string; city?: string; state?: string; postalCode?: string; countryCode?: string } | null;
  paymentTermsDays: number | null;
};

type BrandChoice = {
  id: string;
  name: string;
  code: string;
  logoReference: string | null;
  defaultTemplateKey: string | null;
  theme?: Record<string, unknown>;
  legalEntityId: string;
  legalEntityName: string;
  legalEntityDisplayName?: string;
  issuerIdentityReady: boolean;
  currency: string;
  taxSetupStatus: string;
  defaultTaxCode: string | null;
  canAutoMap: boolean;
};

type QuickCustomer = {
  name: string;
  phone: string;
  email: string;
  taxIdentifier: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
};

type Item = { id: string; itemCode: string | null; itemType: string; name: string; description: string; unitCode: string; defaultUnitPrice: string; currency: string; defaultTaxCode: string | null };
type TaxRule = { id: string; legalEntityId: string; taxCode: string; displayName: string; ratePercent: string; calculationMode: "EXCLUSIVE" | "INCLUSIVE"; effectiveFrom: string; effectiveUntil: string | null };
type Options = { legalEntities: Entity[]; brands: BrandChoice[]; customers: Customer[]; catalogItems: Item[]; taxRules: TaxRule[] };
type Api = { data?: unknown; error?: { message?: string; code?: string; fields?: Record<string, string> } };

const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};

const fifteenDaysFromToday = () => {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};

const formatPointsToDescription = (points: StructuredPoint[]): string => {
  return points
    .map((pt, idx) => {
      const clean = pt.text.trim().replace(/\s*\(Complimentary\)$/i, "");
      if (!clean) return "";
      return pt.isComplimentary
        ? `${idx + 1}. ${clean} (Complimentary)`
        : `${idx + 1}. ${clean}`;
    })
    .filter(Boolean)
    .join("\n");
};

const freshLine = (taxCode = ""): CreateLineDraft => {
  const defaultPoints: StructuredPoint[] = [
    { id: crypto.randomUUID(), text: "Core service deliverables", isComplimentary: false },
  ];
  return {
    key: crypto.randomUUID(),
    catalogItemId: "",
    lineKind: "ITEM",
    serviceName: "",
    description: "1. Core service deliverables",
    structuredPoints: defaultPoints,
    useStructuredMode: true,
    unitCode: "unit",
    quantity: "1.0000",
    unitPrice: "0.0000",
    discountType: "AMOUNT",
    discountValue: "0.0000",
    taxCode,
    complimentary: false,
  };
};

export default function CreateInvoicePage() {
  const router = useRouter();
  const [options, setOptions] = useState<Options>({ legalEntities: [], brands: [], customers: [], catalogItems: [], taxRules: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Form State
  const [brandId, setBrandId] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [invoiceDate] = useState(today());
  const [validUntil, setValidUntil] = useState(fifteenDaysFromToday());
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [existingCustPhoneOverride, setExistingCustPhoneOverride] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isInterstate, setIsInterstate] = useState(false); // Single-tick IGST toggle

  // Quick Customer with required phone
  const [quickCustomer, setQuickCustomer] = useState<QuickCustomer>({
    name: "",
    phone: "",
    email: "",
    taxIdentifier: "",
    line1: "",
    city: "",
    state: "",
    postalCode: "",
    countryCode: "IN",
  });

  const [lines, setLines] = useState<CreateLineDraft[]>([freshLine()]);
  const [createKey] = useState(() => crypto.randomUUID() + crypto.randomUUID());

  // Load Form Options
  useEffect(() => {
    let active = true;
    async function loadOptions() {
      try {
        const res = await fetch("/api/v1/invoices/draft-options", { cache: "no-store" });
        const body = (await res.json()) as Api;
        if (!res.ok) throw new Error(body.error?.message ?? "Invoice form options could not be loaded.");
        if (!active) return;
        const data = (body.data ?? { legalEntities: [], brands: [], customers: [], catalogItems: [], taxRules: [] }) as Options;
        setOptions(data);

        // Auto-select first valid brand
        const autoBrand = data.brands.find((b) => b.canAutoMap);
        if (autoBrand) {
          setBrandId(autoBrand.id);
          setLegalEntityId(autoBrand.legalEntityId);
          setCurrency(autoBrand.currency || "INR");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load options");
      } finally {
        if (active) setOptionsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  const validBrands = options.brands.filter((b) => b.canAutoMap);
  const selectedBrand = options.brands.find((b) => b.id === brandId);
  const selectedCustomer = options.customers.find((c) => c.id === customerId);

  const chooseBrand = (id: string) => {
    const brand = validBrands.find((b) => b.id === id);
    setBrandId(id);
    setLegalEntityId(brand?.legalEntityId ?? "");
    setCurrency(brand?.currency ?? "INR");
  };

  const logoForBrand = (brand: BrandChoice) => {
    const code = (brand.code + " " + brand.name).toUpperCase();
    if (code.includes("COWORK")) return "/brand/fx-coworks.webp";
    if (code.includes("DIGI")) return "/brand/fx-digitech.webp";
    if (code.includes("MYFX") || code.includes("POS")) return "/brand/myfx-pos.webp";
    return brand.logoReference?.startsWith("/brand/") ? brand.logoReference : "/brand/falchion-xeniaa-logo.webp";
  };

  const csrf = async () => {
    const r = await fetch("/api/v1/auth/csrf", { cache: "no-store" });
    const b = (await r.json()) as { data?: { csrfToken?: string } };
    if (!r.ok || !b.data?.csrfToken) throw new Error("Request validation expired. Refresh the page and try again.");
    return b.data.csrfToken;
  };

  // Line item helpers
  const updateLine = (key: string, patch: Partial<CreateLineDraft>) => {
    setLines((old) =>
      old.map((line) => {
        if (line.key !== key) return line;
        const updated = { ...line, ...patch };
        if (patch.complimentary !== undefined && patch.complimentary) {
          updated.unitPrice = "0.0000";
        }
        return updated;
      }),
    );
  };

  // Structured multi-point description helpers with per-point complimentary tags
  const updateStructuredPoint = (lineKey: string, pointId: string, text: string) => {
    setLines((old) =>
      old.map((line) => {
        if (line.key !== lineKey) return line;
        const newPoints = line.structuredPoints.map((pt) =>
          pt.id === pointId ? { ...pt, text } : pt
        );
        return {
          ...line,
          structuredPoints: newPoints,
          description: formatPointsToDescription(newPoints),
        };
      }),
    );
  };

  const togglePointComplimentary = (lineKey: string, pointId: string) => {
    setLines((old) =>
      old.map((line) => {
        if (line.key !== lineKey) return line;
        const newPoints = line.structuredPoints.map((pt) =>
          pt.id === pointId ? { ...pt, isComplimentary: !pt.isComplimentary } : pt
        );
        return {
          ...line,
          structuredPoints: newPoints,
          description: formatPointsToDescription(newPoints),
        };
      }),
    );
  };

  const addPointToLine = (lineKey: string) => {
    setLines((old) =>
      old.map((line) => {
        if (line.key !== lineKey) return line;
        const newPoints = [
          ...line.structuredPoints,
          { id: crypto.randomUUID(), text: "", isComplimentary: false },
        ];
        return {
          ...line,
          structuredPoints: newPoints,
          description: formatPointsToDescription(newPoints),
        };
      }),
    );
  };

  const removePointFromLine = (lineKey: string, pointId: string) => {
    setLines((old) =>
      old.map((line) => {
        if (line.key !== lineKey) return line;
        const newPoints = line.structuredPoints.filter((pt) => pt.id !== pointId);
        const fallback = newPoints.length > 0
          ? newPoints
          : [{ id: crypto.randomUUID(), text: "", isComplimentary: false }];
        return {
          ...line,
          structuredPoints: fallback,
          description: formatPointsToDescription(fallback),
        };
      }),
    );
  };

  const toggleStructuredMode = (lineKey: string) => {
    setLines((old) =>
      old.map((line) => {
        if (line.key !== lineKey) return line;
        const nextMode = !line.useStructuredMode;
        if (nextMode) {
          // Parse lines from raw description, preserving any (Complimentary) tag
          const parsed = line.description
            .split("\n")
            .map((l) => {
              const withoutNum = l.replace(/^\d+[\.\)]\s*/, "").trim();
              const isComplimentary = /\(Complimentary\)$/i.test(withoutNum);
              const cleanText = withoutNum.replace(/\s*\(Complimentary\)$/i, "").trim();
              return {
                id: crypto.randomUUID(),
                text: cleanText,
                isComplimentary,
              };
            })
            .filter((p) => Boolean(p.text));

          const points = parsed.length > 0 ? parsed : [
            { id: crypto.randomUUID(), text: line.description || "Service deliverable", isComplimentary: false }
          ];

          return {
            ...line,
            useStructuredMode: true,
            structuredPoints: points,
          };
        } else {
          return {
            ...line,
            useStructuredMode: false,
          };
        }
      }),
    );
  };

  // Live Reactive Calculations (0ms client math)
  const calculation = useMemo(() => {
    let subtotal = 0;
    for (const line of lines) {
      if (line.complimentary) continue;
      const q = parseFloat(line.quantity) || 0;
      const p = parseFloat(line.unitPrice) || 0;
      subtotal += q * p;
    }
    const taxRate = 0.18; // 18% standard GST
    const cgstRate = isInterstate ? 0 : 0.09;
    const sgstRate = isInterstate ? 0 : 0.09;
    const igstRate = isInterstate ? 0.18 : 0;

    const cgstAmount = subtotal * cgstRate;
    const sgstAmount = subtotal * sgstRate;
    const igstAmount = subtotal * igstRate;
    const taxTotal = subtotal * taxRate;
    const grandTotal = subtotal + taxTotal;

    return {
      subtotal,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxTotal,
      grandTotal,
    };
  }, [lines, isInterstate]);

  const currencySymbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "₹";

  const resolveCustomerId = async (): Promise<string> => {
    if (customerMode === "existing") {
      if (!customerId) throw new Error("Please select an existing customer or add new customer details.");
      if (selectedCustomer && !selectedCustomer.phone && !existingCustPhoneOverride.trim()) {
        throw new Error("Customer phone number is strictly mandatory for proforma and GST issuance. Please provide a phone number.");
      }
      return customerId;
    }

    if (!quickCustomer.name.trim()) throw new Error("Customer name is required.");
    if (!quickCustomer.phone.trim() || quickCustomer.phone.trim().length < 6) {
      throw new Error("Customer phone number is required (mandatory minimum 6 digits).");
    }

    const token = await csrf();
    const hasAddress = Boolean(quickCustomer.line1.trim() || quickCustomer.city.trim() || quickCustomer.state.trim() || quickCustomer.postalCode.trim());
    const address = hasAddress
      ? {
          line1: quickCustomer.line1.trim(),
          city: quickCustomer.city.trim(),
          state: quickCustomer.state.trim(),
          postalCode: quickCustomer.postalCode.trim(),
          countryCode: quickCustomer.countryCode.trim().toUpperCase() || "IN",
        }
      : undefined;

    const res = await fetch("/api/v1/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({
        name: quickCustomer.name.trim(),
        phone: quickCustomer.phone.trim(),
        ...(quickCustomer.email.trim() ? { email: quickCustomer.email.trim() } : {}),
        ...(quickCustomer.taxIdentifier.trim() ? { taxIdentifier: quickCustomer.taxIdentifier.trim().toUpperCase() } : {}),
        ...(address ? { billingAddress: address } : {}),
      }),
    });

    const body = (await res.json()) as Api;
    if (!res.ok) throw new Error(body.error?.message ?? "Failed to save customer details.");
    const id = (body.data as { id?: string })?.id;
    if (!id) throw new Error("Customer created but no ID was returned.");
    return id;
  };

  const handleSaveDraft = async (e?: FormEvent, showPreviewAfter = false) => {
    e?.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!brandId || !legalEntityId) throw new Error("Please select an invoice brand.");
      if (!validUntil) throw new Error("Expiry date is required.");
      if (!lines.length || lines.some((l) => !l.description.trim())) {
        throw new Error("Each invoice line requires a description.");
      }

      const resolvedCustId = await resolveCustomerId();
      const token = await csrf();

      const payload = {
        legalEntityId,
        brandId: brandId || null,
        customerId: resolvedCustId,
        currency,
        invoiceDate: invoiceDate || null,
        dueDate: null,
        validUntil: validUntil || null,
        taxMode: "COMPONENTS",
        cgstEnabled: true,
        cgstRate: isInterstate ? "18.000000" : "9.000000",
        sgstEnabled: !isInterstate,
        sgstRate: isInterstate ? "0.000000" : "9.000000",
        paymentTermsDays: 15,
        notes: notes || null,
        recipientEmail: recipientEmail.trim(),
        lines: lines.map((l) => ({
          lineKind: "ITEM",
          milestone: l.serviceName.trim() || null,
          description: l.complimentary && !l.description.includes("(Complimentary)") ? `${l.description.trim()} (Complimentary)` : l.description.trim(),
          unitCode: "unit",
          quantity: l.quantity,
          unitPrice: l.complimentary ? "0.0000" : l.unitPrice,
          discountType: "AMOUNT",
          discountValue: "0.0000",
          taxCode: null,
        })),
      };

      const res = await fetch("/api/v1/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Idempotency-Key": createKey,
        },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as Api;
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save invoice draft.");
      const newId = (body.data as { id?: string })?.id;
      if (!newId) throw new Error("Invoice saved but no ID was returned.");

      setSuccess("Invoice draft saved successfully!");

      if (showPreviewAfter) {
        setPreviewId(newId);
      } else {
        router.push(`/invoices/${newId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page page--create-invoice">
      <Breadcrumbs
        items={[
          { label: "Workspace", href: "/" },
          { label: "Invoices", href: "/invoices" },
          { label: "Create Invoice" },
        ]}
      />

      <PageHeader
        eyebrow="NEW INVOICE COMPOSER"
        title="Create Invoice"
        description="Draft customer invoices with instant live pricing, single-tick GST handling, and multi-point deliverables."
        action={
          <div style={{ display: "flex", gap: "10px" }}>
            <Link href="/invoices" className="button button--secondary button--md">
              Cancel
            </Link>
            <Button
              variant="secondary"
              size="md"
              disabled={saving || optionsLoading}
              onClick={() => void handleSaveDraft(undefined, true)}
            >
              {saving ? "Saving…" : "Save Draft & Preview"}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={saving || optionsLoading}
              onClick={() => void handleSaveDraft(undefined, false)}
            >
              {saving ? "Saving…" : "Save Draft"}
            </Button>
          </div>
        }
      />

      {error ? <InlineAlert tone="danger" title="Validation Note">{error}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" title="Success">{success}</InlineAlert> : null}

      {optionsLoading ? (
        <LoadingState label="Loading billing configuration and customer records…" />
      ) : (
        <form onSubmit={(e) => void handleSaveDraft(e, false)}>
          {/* SECTION 1: Commercial Brand Cards & Auto Dates */}
          <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
            <div style={{ marginBottom: "16px" }}>
              <label className="form-label" style={{ fontSize: "14px", fontWeight: 750, color: "var(--ink-strong)" }}>
                Select Commercial Product Brand <span className="form-required">*</span>
              </label>
              <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: "12px" }}>
                Select the approved commercial identity that will appear on the customer invoice.
              </p>

              {/* Visual Brand Choice Cards */}
              <div className="brand-card-grid">
                {validBrands.map((b) => {
                  const isSelected = brandId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`brand-card ${isSelected ? "brand-card--selected" : ""}`}
                      onClick={() => chooseBrand(b.id)}
                    >
                      <Image
                        src={logoForBrand(b)}
                        alt={b.name}
                        width={60}
                        height={38}
                        unoptimized
                        className="brand-card-logo"
                      />
                      <div className="brand-card-info">
                        <span className="brand-card-title">{b.name}</span>
                        <span className="brand-card-sub">{b.legalEntityName}</span>
                      </div>
                      {isSelected && (
                        <span className="brand-card-check" aria-hidden="true">
                          <Icon name="check" size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Accessible fallback select */}
              <div style={{ marginTop: "10px" }}>
                <select
                  id="brand-select"
                  className="form-control"
                  style={{ display: "none" }}
                  value={brandId}
                  onChange={(e) => chooseBrand(e.target.value)}
                  required
                >
                  <option value="">Select Brand</option>
                  {validBrands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {selectedBrand && (
                  <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--fg-muted, #64748b)" }}>
                    <span>Active: <strong>{selectedBrand.name}</strong> · Registered Legal Supplier: {selectedBrand.legalEntityName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Currency & Dates Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px", borderTop: "1px solid var(--line)", paddingTop: "18px" }}>
              {/* Currency Selector */}
              <div className="form-field">
                <label className="form-label" htmlFor="currency-select">
                  Billing Currency
                </label>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  {(["INR", "USD", "GBP", "EUR"] as const).map((curr) => (
                    <button
                      key={curr}
                      type="button"
                      className={`button ${currency === curr ? "button--primary" : "button--secondary"}`}
                      style={{ flex: 1 }}
                      onClick={() => setCurrency(curr)}
                    >
                      {curr === "INR" ? "₹ INR" : curr === "USD" ? "$ USD" : curr === "GBP" ? "£ GBP" : "€ EUR"}
                    </button>
                  ))}
                </div>
                <p className="form-hint">Selected: {currency}</p>
              </div>

              {/* Auto Invoice Date (Today) */}
              <div className="form-field">
                <label className="form-label" htmlFor="invoice-date">
                  Invoice Date (Auto - Today)
                </label>
                <input
                  id="invoice-date"
                  className="form-control"
                  type="date"
                  value={invoiceDate}
                  readOnly
                  style={{ background: "var(--surface-subtle)" }}
                />
                <p className="form-hint">Server-enforced issuance date.</p>
              </div>

              {/* Auto Expiry Date (+15 Days) */}
              <div className="form-field">
                <label className="form-label" htmlFor="valid-until">
                  Valid Until / Expiry (Auto +15 Days) <span className="form-required">*</span>
                </label>
                <input
                  id="valid-until"
                  className="form-control"
                  type="date"
                  min={invoiceDate}
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  required
                />
                <p className="form-hint">Default 15-day proforma validity.</p>
              </div>
            </div>
          </div>

          {/* SECTION 2: Customer Information (Sketch Top Left) */}
          <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 750, color: "var(--ink-strong)" }}>Customer Details</h3>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px" }}>
                  Select an existing customer or enter new billing coordinates. Phone number is strictly mandatory.
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className={`button button--sm ${customerMode === "existing" ? "button--primary" : "button--secondary"}`}
                  onClick={() => setCustomerMode("existing")}
                >
                  Existing Customer
                </button>
                <button
                  type="button"
                  className={`button button--sm ${customerMode === "new" ? "button--primary" : "button--secondary"}`}
                  onClick={() => setCustomerMode("new")}
                >
                  + Add New Customer
                </button>
              </div>
            </div>

            {customerMode === "existing" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                  <div className="form-field">
                    <label className="form-label" htmlFor="customer-select">
                      Select Customer <span className="form-required">*</span>
                    </label>
                    <select
                      id="customer-select"
                      className="form-control"
                      value={customerId}
                      onChange={(e) => {
                        setCustomerId(e.target.value);
                        const found = options.customers.find((c) => c.id === e.target.value);
                        if (found?.email) setRecipientEmail(found.email);
                      }}
                      required
                    >
                      <option value="">-- Choose Client --</option>
                      {options.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.customerCode ? `(${c.customerCode})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="recipient-email">
                      Invoice Email Delivery
                    </label>
                    <input
                      id="recipient-email"
                      type="email"
                      className="form-control"
                      placeholder="billing@client.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                    />
                    <p className="form-hint">Auto-filled from customer profile; editable.</p>
                  </div>
                </div>

                {/* Selected Customer Preview Card */}
                {selectedCustomer && (
                  <div className="customer-summary-box">
                    <div className="customer-summary-item">
                      <span className="customer-summary-label">Client Name</span>
                      <span className="customer-summary-val">{selectedCustomer.name}</span>
                    </div>
                    <div className="customer-summary-item">
                      <span className="customer-summary-label">Phone (Mandatory)</span>
                      {selectedCustomer.phone ? (
                        <span className="customer-summary-val">📞 {selectedCustomer.phone}</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span className="customer-summary-val customer-summary-val--missing">Missing phone number</span>
                          <input
                            type="tel"
                            className="form-control"
                            placeholder="Enter required phone (+91 ...)"
                            value={existingCustPhoneOverride}
                            onChange={(e) => setExistingCustPhoneOverride(e.target.value)}
                            required
                          />
                        </div>
                      )}
                    </div>
                    <div className="customer-summary-item">
                      <span className="customer-summary-label">GSTIN</span>
                      <span className="customer-summary-val">
                        {selectedCustomer.taxIdentifier || "Unregistered"}
                      </span>
                    </div>
                    <div className="customer-summary-item">
                      <span className="customer-summary-label">Billing Location</span>
                      <span className="customer-summary-val">
                        {selectedCustomer.billingAddress?.city || "Pune"}, {selectedCustomer.billingAddress?.state || "Maharashtra"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-name">
                    Customer / Company Name <span className="form-required">*</span>
                  </label>
                  <input
                    id="new-cust-name"
                    className="form-control"
                    required
                    placeholder="e.g. MyFX POS Merchant Ltd."
                    value={quickCustomer.name}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-phone">
                    Phone Number <span className="form-required">*</span>
                  </label>
                  <input
                    id="new-cust-phone"
                    type="tel"
                    className="form-control"
                    required
                    placeholder="+91 98765 43210"
                    value={quickCustomer.phone}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                  <p className="form-hint">Mandatory client contact number.</p>
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-email">
                    Email Address
                  </label>
                  <input
                    id="new-cust-email"
                    type="email"
                    className="form-control"
                    placeholder="accounts@client.com"
                    value={quickCustomer.email}
                    onChange={(e) => {
                      setQuickCustomer((prev) => ({ ...prev, email: e.target.value }));
                      setRecipientEmail(e.target.value);
                    }}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-gst">
                    Customer GSTIN (Optional)
                  </label>
                  <input
                    id="new-cust-gst"
                    className="form-control"
                    placeholder="27ABCDE1234F1Z5"
                    value={quickCustomer.taxIdentifier}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, taxIdentifier: e.target.value }))}
                  />
                </div>
                <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="form-label" htmlFor="new-cust-address">
                    Billing Address
                  </label>
                  <input
                    id="new-cust-address"
                    className="form-control"
                    placeholder="Building, Street, Landmark"
                    value={quickCustomer.line1}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, line1: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-city">
                    City
                  </label>
                  <input
                    id="new-cust-city"
                    className="form-control"
                    placeholder="Pune"
                    value={quickCustomer.city}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-state">
                    State
                  </label>
                  <input
                    id="new-cust-state"
                    className="form-control"
                    placeholder="Maharashtra"
                    value={quickCustomer.state}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, state: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cust-pin">
                    Postal PIN
                  </label>
                  <input
                    id="new-cust-pin"
                    className="form-control"
                    placeholder="411002"
                    value={quickCustomer.postalCode}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, postalCode: e.target.value }))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: Line Items (Matching CEO Handwritten Sketch) */}
          <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 750, color: "var(--ink-strong)" }}>Line Items &amp; Deliverables</h3>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px" }}>
                  Add items, service names, structured numbered deliverables (1. 2.), and complimentary flags.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setLines((prev) => [...prev, freshLine()])}
              >
                + Add Line Item
              </Button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              {lines.map((line, idx) => {
                const lineTotal = line.complimentary ? 0 : (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0);

                return (
                  <div
                    key={line.key}
                    style={{
                      padding: "20px",
                      borderRadius: "14px",
                      border: line.complimentary ? "2px solid rgba(16, 185, 129, 0.4)" : "1px solid var(--line)",
                      background: line.complimentary ? "rgba(16, 185, 129, 0.04)" : "var(--surface-subtle)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 750, color: "var(--ink-strong)" }}>
                        Line Item #{idx + 1}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        {/* Standalone Complimentary Line Item Toggle */}
                        <label className={`complimentary-toggle-wrapper ${line.complimentary ? "complimentary-toggle-wrapper--active" : ""}`}>
                          <input
                            type="checkbox"
                            checked={line.complimentary}
                            onChange={(e) => updateLine(line.key, { complimentary: e.target.checked })}
                          />
                          <span>Standalone Complimentary Item (₹0.00)</span>
                        </label>

                        {lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 2.4fr 0.8fr 1fr 1.1fr", gap: "14px", alignItems: "start" }}>
                      {/* Renamed Milestone -> Service / Item Name */}
                      <div className="form-field">
                        <label className="form-label">
                          Service / Item Name
                        </label>
                        <input
                          className="form-control"
                          placeholder="e.g. POS Setup / Web Dev / Support"
                          value={line.serviceName}
                          onChange={(e) => updateLine(line.key, { serviceName: e.target.value })}
                        />
                        <p className="form-hint">Item identifier</p>
                      </div>

                      {/* Structured Multi-Point Description (1. ____, 2. ____) with Per-Deliverable Complimentary Tag */}
                      <div className="form-field">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <label className="form-label" style={{ margin: 0 }}>
                            Deliverables &amp; Scope <span className="form-required">*</span>
                          </label>
                          <button
                            type="button"
                            className="mode-switch-btn"
                            onClick={() => toggleStructuredMode(line.key)}
                          >
                            {line.useStructuredMode ? "Switch to Plain Text" : "Switch to Point List (1. 2.)"}
                          </button>
                        </div>

                        {line.useStructuredMode ? (
                          <div className="structured-points-container">
                            {line.structuredPoints.map((pt, pIdx) => (
                              <div key={pt.id} className="structured-point-row">
                                <span className="point-number-badge">{pIdx + 1}</span>
                                <input
                                  className="form-control point-input"
                                  placeholder={`Point ${pIdx + 1} description`}
                                  value={pt.text}
                                  onChange={(e) => updateStructuredPoint(line.key, pt.id, e.target.value)}
                                  required={pIdx === 0}
                                />
                                <button
                                  type="button"
                                  className={`point-complimentary-tag ${pt.isComplimentary ? "point-complimentary-tag--active" : ""}`}
                                  title={pt.isComplimentary ? "Marked as complimentary inclusion" : "Mark this deliverable as a complimentary inclusion with this service"}
                                  onClick={() => togglePointComplimentary(line.key, pt.id)}
                                >
                                  <span className="point-complimentary-icon">🎁</span>
                                  <span>{pt.isComplimentary ? "Complimentary" : "+ Complimentary"}</span>
                                </button>
                                {line.structuredPoints.length > 1 && (
                                  <button
                                    type="button"
                                    className="point-remove-btn"
                                    title="Remove point"
                                    onClick={() => removePointFromLine(line.key, pt.id)}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ))}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", flexWrap: "wrap", gap: "6px" }}>
                              <button
                                type="button"
                                className="add-point-btn"
                                onClick={() => addPointToLine(line.key)}
                              >
                                + Add Deliverable Point ({line.structuredPoints.length + 1}.)
                              </button>
                              <span style={{ fontSize: "11px", color: "var(--fg-muted, #64748b)" }}>
                                Click <strong>[+ Complimentary]</strong> to provide specific items free with this service
                              </span>
                            </div>
                          </div>
                        ) : (
                          <textarea
                            className="form-control form-control--textarea"
                            required
                            style={{ minHeight: "84px", fontSize: "14px" }}
                            placeholder={"1. Core deliverables\n2. Service scope\n3. Value-add item (Complimentary)"}
                            value={line.description}
                            onChange={(e) => updateLine(line.key, { description: e.target.value })}
                          />
                        )}
                      </div>

                      {/* Quantity */}
                      <div className="form-field">
                        <label className="form-label">
                          Quantity <span className="form-required">*</span>
                        </label>
                        <input
                          type="number"
                          min="0.0001"
                          step="any"
                          required
                          className="form-control"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        />
                      </div>

                      {/* Rate / Unit Price */}
                      <div className="form-field">
                        <label className="form-label">
                          Rate ({currencySymbol}) <span className="form-required">*</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          disabled={line.complimentary}
                          className="form-control"
                          value={line.complimentary ? "0.00" : line.unitPrice}
                          onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                        />
                      </div>

                      {/* Line Total (Live Computed) */}
                      <div className="form-field">
                        <label className="form-label">Line Total</label>
                        {line.complimentary ? (
                          <div className="complimentary-total-box">
                            COMPLIMENTARY
                          </div>
                        ) : (
                          <div
                            style={{
                              minHeight: "44px",
                              padding: "10px 14px",
                              borderRadius: "10px",
                              background: "var(--surface)",
                              border: "1px solid var(--line)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              fontWeight: 750,
                              fontSize: "15px",
                              color: "var(--ink-strong)",
                            }}
                          >
                            {currencySymbol} {lineTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECTION 4: Tax Mode (Single-Tick IGST) & Live Price Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px", marginBottom: "26px" }}>
            {/* Tax Mode Single-Tick Toggle (Sketch Requirement) */}
            <div className="card" style={{ padding: "24px" }}>
              <h3 style={{ margin: "0 0 10px", fontSize: "17px", fontWeight: 750, color: "var(--ink-strong)" }}>GST &amp; Tax Jurisdiction</h3>
              <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: "13px" }}>
                Default is Intrastate supply (9% CGST + 9% SGST = 18%). Single-tick for Interstate supply (18% IGST).
              </p>

              <div className="tax-toggle-box">
                <label className="tax-toggle-header">
                  <input
                    type="checkbox"
                    checked={isInterstate}
                    onChange={(e) => setIsInterstate(e.target.checked)}
                    style={{ width: "20px", height: "20px" }}
                  />
                  <span>Interstate Supply — Apply IGST (18%)</span>
                </label>
                <p className="tax-toggle-desc">
                  {isInterstate
                    ? "Applying Integrated Goods & Services Tax (18% IGST) for clients outside Maharashtra."
                    : "Applying Central GST (9% CGST) + State GST (9% SGST) for Maharashtra supply."}
                </p>
              </div>

              <div className="form-field" style={{ marginTop: "18px" }}>
                <label className="form-label" htmlFor="invoice-notes">
                  Invoice Notes &amp; Terms (Optional)
                </label>
                <textarea
                  id="invoice-notes"
                  className="form-control form-control--textarea"
                  style={{ minHeight: "80px" }}
                  placeholder="e.g. Please quote invoice number on all NEFT/RTGS bank transfers."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* LIVE FINAL PRICE SUMMARY (Sketch Bottom Right - Instant Reactive Feedback) */}
            <div className="live-summary-card">
              <div>
                <h3 style={{ margin: "0 0 14px", fontSize: "17px", fontWeight: 750, color: "var(--ink-strong)" }}>
                  Live Price Calculation
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="summary-row">
                    <span>Subtotal (Net)</span>
                    <strong>
                      {currencySymbol} {calculation.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </div>

                  {!isInterstate ? (
                    <>
                      <div className="summary-row">
                        <span>Central GST (9% CGST)</span>
                        <strong>
                          {currencySymbol} {calculation.cgstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>State GST (9% SGST)</span>
                        <strong>
                          {currencySymbol} {calculation.sgstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <div className="summary-row">
                      <span>Integrated GST (18% IGST)</span>
                      <strong>
                        {currencySymbol} {calculation.igstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  )}

                  <div className="summary-divider" />

                  <div className="summary-row">
                    <span>Total Tax (18%)</span>
                    <strong>
                      {currencySymbol} {calculation.taxTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              </div>

              {/* FINAL PRICE HERO CALLOUT (CEO Requirement: "on that page only i should be able to see the final price") */}
              <div className="final-price-callout">
                <span className="final-price-label">
                  Final Grand Total Price
                </span>
                <strong className="final-price-amount">
                  {currencySymbol} {calculation.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
                <span className="final-price-hint">
                  Calculated dynamically in real-time. Zero delay.
                </span>
              </div>
            </div>
          </div>

          {/* ACTIONS ROW (Strictly Decoupled: NO ISSUE BUTTON on create page!) */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "12px", padding: "18px 0", borderTop: "1px solid var(--line)" }}>
            <Link href="/invoices" className="button button--secondary button--md">
              Cancel
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={saving}
              onClick={() => void handleSaveDraft(undefined, true)}
            >
              {saving ? "Saving…" : "Save Draft & Preview"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={saving}
            >
              {saving ? "Saving Draft…" : "Save Draft"}
            </Button>
          </div>
        </form>
      )}

      {/* Draft Preview Modal / Frame */}
      {previewId ? (
        <section className="invoice-preview-wrap" style={{ marginTop: "30px" }}>
          <div className="invoice-preview-toolbar">
            <div>
              <strong style={{ fontSize: "16px" }}>Client PDF Draft Preview</strong>
              <p>Generated with the exact statutory A4 template using your live inputs.</p>
            </div>
            <div className="invoice-preview-toolbar__actions">
              <Link href={`/invoices/${previewId}`} className="button button--primary button--md">
                Go to Review &amp; Issuance →
              </Link>
              <Button variant="ghost" size="sm" onClick={() => setPreviewId(null)}>
                Close Preview
              </Button>
            </div>
          </div>
          <iframe
            key={previewId}
            className="invoice-pdf-preview-frame"
            title="Invoice draft PDF preview"
            src={`/api/v1/invoices/${previewId}/preview`}
          />
        </section>
      ) : null}
    </main>
  );
}
