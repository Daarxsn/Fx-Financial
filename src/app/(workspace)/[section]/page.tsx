import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { MasterDataWorkspace } from "@/components/master-data-workspace";
import { InvoiceWorkspace } from "@/components/invoice-workspace";
import { QuotationWorkspace } from "@/components/quotation-workspace";
import { PaymentWorkspace } from "@/components/payment-workspace";
import { Breadcrumbs, Card, EmptyState, InlineAlert, PageHeader, StatusBadge } from "@/components/ui";

const sections = {
  invoices: {
    title: "Invoices",
    eyebrow: "DOCUMENT MANAGEMENT",
    description: "Prepare invoice drafts and preserve a clear, auditable record of every issued document.",
    icon: "invoice" as const,
    status: "Live draft workflow",
    emptyTitle: "Your invoice workspace is ready for real data",
    emptyDescription: "Draft creation, exact-decimal totals, payment-aware balances and guarded issuance are connected to secured APIs. Invoice numbering is allocated only at issuance, and totals are recalculated before issuing.",
    note: "Issued financial details must remain immutable; changes belong in an approved correction workflow.",
    details: ["Drafts and document status", "Issue-time snapshots", "Private document history"],
  },
  quotations: {
    title: "Quotations",
    eyebrow: "COMMERCIAL DOCUMENTS",
    description: "Create, manage and track quotations separately from invoices, then convert accepted quotes into invoice drafts.",
    icon: "quote" as const,
    status: "Live draft workflow",
    emptyTitle: "Quotation workflow",
    emptyDescription: "Create drafts, edit their lines, record a customer decision, and convert accepted quotations to invoice drafts.",
    note: "Marking a quotation as sent reserves its approved number and snapshots configuration. PDF generation and email delivery are not yet enabled.",
    details: ["Create and edit quotation drafts", "Track validity and customer decisions", "Convert accepted quotations to invoice drafts"],
  },
  customers: {
    title: "Customers",
    eyebrow: "CUSTOMER RELATIONSHIPS",
    description: "Keep customer records accurate and reusable without rewriting previously issued documents.",
    icon: "users" as const,
    status: "API foundation available",
    emptyTitle: "No customer records to show in this view",
    emptyDescription: "The customer list/create API is available, but a connected, permission-aware data table and customer detail workflows are not yet part of this UI foundation.",
    note: "Customer master-data changes must never alter the customer snapshot of an issued invoice.",
    details: ["Customer identity and contact data", "Billing address and identifiers", "Archive and reference safeguards"],
  },
  catalog: {
    title: "Items & services",
    eyebrow: "CATALOG MANAGEMENT",
    description: "Maintain reusable item descriptions, units and price defaults for future documents.",
    icon: "box" as const,
    status: "API foundation available",
    emptyTitle: "Your catalog view is ready to connect",
    emptyDescription: "The catalog item list/create API exists. This foundation page intentionally does not display invented products or claim the complete catalog workflow is live.",
    note: "Catalog defaults are for new drafts; existing and issued line values must be preserved.",
    details: ["Product and service types", "Unit and exact-decimal price defaults", "Approved tax-code references"],
  },
  payments: {
    title: "Payments",
    eyebrow: "RECEIVABLES",
    description: "Keep receipts, invoice allocations and reversals distinct, with a traceable history.",
    icon: "wallet" as const,
    status: "Live receipt workflow",
    emptyTitle: "Payment activity will appear here",
    emptyDescription: "Record manually received payments, allocate receipts to eligible issued invoices, and reverse a receipt with a reason while preserving the ledger history.",
    note: "Allocations must be checked transactionally against customer, currency and remaining balances.",
    details: ["Receipt ledger", "Partial and full allocations", "Reasoned reversal records"],
  },
  reports: {
    title: "Reports",
    eyebrow: "FINANCIAL INSIGHT",
    description: "A consistent home for verified, entity-scoped summaries and exports.",
    icon: "chart" as const,
    status: "Planned",
    emptyTitle: "Reports will be connected to verified data",
    emptyDescription: "Receivables summaries, period filters and export jobs depend on secured reporting APIs and approved financial definitions.",
    note: "A report must disclose its date range, legal-entity scope, currency and calculation basis.",
    details: ["Receivables and balances", "Date and entity filters", "Audited exports"],
  },
  audit: {
    title: "Audit trail",
    eyebrow: "ACCOUNTABILITY",
    description: "A clear and searchable history of important actions and document decisions.",
    icon: "shield" as const,
    status: "Planned",
    emptyTitle: "Audit events are not connected to this view yet",
    emptyDescription: "The database audit foundation exists. A scoped search, useful timeline and permission-aware details view will arrive with the audit API.",
    note: "Audit records must not expose credentials, session tokens or unnecessary sensitive data.",
    details: ["Actor, action and timestamp", "Resource and outcome", "Scoped, safe change history"],
  },
  settings: {
    title: "Workspace settings",
    eyebrow: "CONFIGURATION",
    description: "Company, brand, numbering, tax and access settings belong in one controlled place.",
    icon: "settings" as const,
    status: "Planned",
    emptyTitle: "Configuration workflows are not enabled",
    emptyDescription: "These settings must be connected to approved server-side workflows before users can change live company or financial rules.",
    note: "Do not enable invoice issuance until the business owner has approved the actual entity, tax, numbering and currency policies.",
    details: ["Legal entities and brand mappings", "Tax and numbering configuration", "Roles, permissions and access scope"],
  },
} satisfies Record<string, {
  title: string;
  eyebrow: string;
  description: string;
  icon: "invoice" | "quote" | "users" | "box" | "wallet" | "chart" | "shield" | "settings";
  status: string;
  emptyTitle: string;
  emptyDescription: string;
  note: string;
  details: string[];
}>;

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in sections)) notFound();
  const data = sections[section as keyof typeof sections];

  return (
    <div className="page page--section">
      <Breadcrumbs items={[{ label: "Workspace", href: "/" }, { label: data.title }]} />
      <PageHeader eyebrow={data.eyebrow} title={data.title} description={data.description} />
      <div className="section-overview-banner">
        <div className="section-overview-banner__icon"><Icon name={data.icon} size={23} /></div>
        <div className="section-overview-banner__copy">
          <strong>{data.title} workspace</strong>
          <p>{data.note}</p>
        </div>
        <StatusBadge tone={data.status.includes("available") ? "info" : data.status === "Planned" ? "warning" : "success"}>{data.status}</StatusBadge>
      </div>

      {section === "invoices" ? <InvoiceWorkspace />
        : section === "quotations" ? <QuotationWorkspace />
        : section === "payments" ? <PaymentWorkspace />
        : section === "customers" || section === "catalog" ? <MasterDataWorkspace resource={section} />
        : <div className="section-workspace-grid">
          <Card className="section-data-card">
            <div className="card-heading">
              <div><h2>{section === "settings" ? "Configuration areas" : section === "reports" ? "Available views" : "Workspace records"}</h2><p>Honest state, ready for implementation.</p></div>
              <span className="card-heading__icon"><Icon name="file" size={19} /></span>
            </div>
            <EmptyState icon={data.icon} title={data.emptyTitle} description={data.emptyDescription} />
          </Card>
          <Card className="section-guide-card">
            <div className="card-heading">
              <div><h2>What belongs here</h2><p>Scope of this workspace</p></div>
              <span className="card-heading__icon"><Icon name="sparkles" size={19} /></span>
            </div>
            <ul className="feature-list">
              {data.details.map((item) => <li key={item}><span><Icon name="check" size={15} /></span>{item}</li>)}
            </ul>
            <InlineAlert tone="info" title="Data integrity first">
              This screen does not bypass permissions or treat browser-side calculations as authoritative.
            </InlineAlert>
          </Card>
        </div>}
    </div>
  );
}
