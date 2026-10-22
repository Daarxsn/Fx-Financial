"use client";

import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/components/icon";
import { Breadcrumbs, Card, PageHeader, StatusBadge } from "@/components/ui";
import { PaymentSummary } from "@/components/payment-summary";
import { DashboardReportSummary } from "@/components/dashboard-report-summary";

const modules = [
  { number: "01", title: "Invoices", description: "Create drafts, review server-calculated totals and issue after required finance checks.", href: "/invoices", icon: "invoice" as const, status: "Document workflow" },
  { number: "02", title: "Quotations", description: "Create drafts, track customer decisions and convert accepted quotes into invoice drafts.", href: "/quotations", icon: "quote" as const, status: "Document workflow" },
  { number: "03", title: "Customers", description: "Manage customer records that can be reused across invoices and quotations.", href: "/customers", icon: "users" as const, status: "Master data" },
  { number: "04", title: "Items & services", description: "Manage reusable products and services, units and exact-decimal price defaults.", href: "/catalog", icon: "box" as const, status: "Master data" },
  { number: "05", title: "Payments", description: "Record receipts, allocate payments to issued invoices, and preserve reversal history.", href: "/payments", icon: "wallet" as const, status: "Payment workflow" },
];

export default function HomePage() {
  return (
    <div className="page page--overview">
      <Breadcrumbs items={[{ label: "Workspace" }, { label: "Overview" }]} />
      <PageHeader
        eyebrow="FINANCE OPERATIONS"
        title="Your finance, in focus."
        description="A considered workspace for document creation, customer records and payment tracking—built around accurate data and accountable actions."
      />
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-panel__content">
          <StatusBadge tone="info" icon="sparkles">Workspace foundation</StatusBadge>
          <h2 id="welcome-title">A better way to keep business moving.</h2>
          <p>Use Invoices to create drafts and issue financial documents, or Quotations to prepare quotes, record customer decisions and convert accepted quotes into invoice drafts. Your role, legal-entity access and approved company setup determine which actions are available. PDF generation and email delivery are not enabled yet.</p>
          <div className="welcome-panel__foot">
            <span className="welcome-panel__live"><span aria-hidden="true" /> UI foundation active</span>
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
        <span className="section-heading__hint">Explore the foundation</span>
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
            <div><h2>Foundation status</h2><p>The shared experience, at a glance.</p></div>
            <span className="card-heading__icon"><Icon name="shield" size={19} /></span>
          </div>
          <div className="readiness-list">
            <div><span className="readiness-list__icon readiness-list__icon--success"><Icon name="check" size={15} /></span><span><strong>Design system</strong><small>Tokens and shared components</small></span><StatusBadge tone="success">Ready</StatusBadge></div>
            <div><span className="readiness-list__icon readiness-list__icon--success"><Icon name="check" size={15} /></span><span><strong>Responsive shell</strong><small>Desktop, tablet and mobile</small></span><StatusBadge tone="success">Ready</StatusBadge></div>
            <div><span className="readiness-list__icon"><Icon name="clock" size={15} /></span><span><strong>Reports &amp; delivery</strong><small>Reporting, PDF generation and email remain planned</small></span><StatusBadge tone="warning">In progress</StatusBadge></div>
          </div>
          <div className="readiness-note"><Icon name="lock" size={15} /><span>Unreleased workflows are not presented as active.</span></div>
        </Card>
      </div>
    </div>
  );
}
