"use client";

import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/components/icon";
import { Breadcrumbs, Card, PageHeader, StatusBadge } from "@/components/ui";
import { PaymentSummary } from "@/components/payment-summary";
import { DashboardReportSummary } from "@/components/dashboard-report-summary";

const modules = [
  { number: "01", title: "Invoices", description: "Prepare invoice drafts, review calculated totals and issue documents when required finance checks are satisfied.", href: "/invoices", icon: "invoice" as const, status: "Document workflow" },
  { number: "02", title: "Quotations", description: "Prepare quotations, record customer decisions and move accepted quotes into the invoice workflow.", href: "/quotations", icon: "quote" as const, status: "Document workflow" },
  { number: "03", title: "Customers", description: "Keep customer details consistent and reusable across your financial documents.", href: "/customers", icon: "users" as const, status: "Master data" },
  { number: "04", title: "Items & services", description: "Maintain reusable products, services, units and price defaults for new documents.", href: "/catalog", icon: "box" as const, status: "Master data" },
  { number: "05", title: "Payments", description: "Record receipts, allocate payments to invoices and preserve a traceable history.", href: "/payments", icon: "wallet" as const, status: "Payment workflow" },
];

export default function HomePage() {
  return (
    <div className="page page--overview">
      <Breadcrumbs items={[{ label: "Workspace" }, { label: "Overview" }]} />
      <PageHeader
        eyebrow="FINANCE OPERATIONS"
        title="Your finance, in focus."
        description="Create, preview, send and manage invoices from one clear workspace, with customer records and payment tracking close at hand."
        action={<Link className="button button--primary button--md" href="/invoices">+ Create new invoice</Link>}
      />
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-panel__content">
          <StatusBadge tone="info" icon="sparkles">Finance workspace</StatusBadge>
          <h2 id="welcome-title">Every financial detail, in its place.</h2>
          <p>Open Invoices to create a draft, preview the saved invoice, issue it when the required finance checks pass, and send it through the configured email service. Your role, legal-entity access and approved company setup determine which actions are available.</p>
          <div className="welcome-panel__foot">
            <span className="welcome-panel__live"><span aria-hidden="true" /> Workspace active</span>
            <span className="welcome-panel__separator" aria-hidden="true" />
            <span>Secure-by-design architecture</span>
          </div>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="welcome-art__halo" />
          <div className="welcome-art__paper welcome-art__paper--back" />
          <div className="welcome-art__paper">
            <Image className="welcome-art__paper-mark" src="/brand/falchion-xeniaa-mark.svg" alt="" width={29} height={28} unoptimized />
            <span className="welcome-art__line welcome-art__line--long" />
            <span className="welcome-art__line" />
            <span className="welcome-art__line welcome-art__line--mid" />
            <span className="welcome-art__rule" />
            <span className="welcome-art__line welcome-art__line--short" />
            <span className="welcome-art__stamp"><Icon name="check" size={17} /></span>
          </div>
          <span className="welcome-art__spark welcome-art__spark--one">✦</span>
          <span className="welcome-art__spark welcome-art__spark--two">✧</span>
        </div>
      </section>

      <div className="section-heading">
        <div><p className="eyebrow">YOUR WORKSPACE</p><h2>Start with the essentials</h2></div>
        <span className="section-heading__hint">Built for day-to-day clarity</span>
      </div>

      <section className="module-grid" aria-label="Workspace modules">
        {modules.map((module) => (
          <Link className="module-card" href={module.href} key={module.href}>
            <div className="module-card__top">
              <span className="module-card__icon"><Icon name={module.icon} size={21} /></span>
              <span className="module-card__number">{module.number}</span>
            </div>
            <h3>{module.title}</h3>
            <p>{module.description}</p>
            <div className="module-card__bottom">
              <span>{module.status}</span>
              <span className="module-card__arrow"><Icon name="arrow-up-right" size={17} /></span>
            </div>
          </Link>
        ))}
      </section>

      <DashboardReportSummary />

      <div className="overview-lower-grid">
        <Card className="activity-card">
          <div className="card-heading">
            <div><h2>Receivables snapshot</h2><p>Scoped invoice and receipt totals, reconciled from recorded allocations.</p></div>
            <span className="card-heading__icon"><Icon name="wallet" size={19} /></span>
          </div>
          <PaymentSummary />
        </Card>
        <Card className="readiness-card">
          <div className="card-heading">
            <div><h2>Workspace readiness</h2><p>A transparent view of what is available today.</p></div>
            <span className="card-heading__icon"><Icon name="shield" size={19} /></span>
          </div>
          <div className="readiness-list">
            <div><span className="readiness-list__icon readiness-list__icon--success"><Icon name="check" size={15} /></span><span><strong>Design system</strong><small>Tokens and shared components</small></span><StatusBadge tone="success">Ready</StatusBadge></div>
            <div><span className="readiness-list__icon readiness-list__icon--success"><Icon name="check" size={15} /></span><span><strong>Responsive shell</strong><small>Desktop, tablet and mobile</small></span><StatusBadge tone="success">Ready</StatusBadge></div>
            <div><span className="readiness-list__icon"><Icon name="clock" size={15} /></span><span><strong>Reports &amp; delivery</strong><small>PDF/email need approved issuer setup and a verified sender configuration</small></span><StatusBadge tone="warning">In progress</StatusBadge></div>
          </div>
          <div className="readiness-note"><Icon name="lock" size={15} /><span>Unreleased workflows are not presented as active.</span></div>
        </Card>
      </div>
    </div>
  );
}
