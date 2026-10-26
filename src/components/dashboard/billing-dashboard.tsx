"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { PipelineFunnel } from "./pipeline-funnel";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
}

export function BillingDashboard({ data }: Props) {
  const { billing } = data;

  return (
    <div className="role-dashboard-container">
      {/* Billing Hero Action Banner */}
      <div className="billing-hero-banner">
        <div className="billing-hero-content">
          <span className="billing-badge">Billing Operations</span>
          <h3 className="billing-title">Compose &amp; Issue Proformas in Minutes</h3>
          <p className="billing-desc">
            New multi-page invoice builder featuring instant commercial brand selection (MyFX POS, FX Digitech, FX Coworks), automatic +15-day proforma validity calculation, single-tick GST/IGST calculation, and multi-point structured descriptions.
          </p>
          <div className="billing-hero-actions">
            <Link href="/invoices/new" className="button button--primary button--lg">
              + Create New Invoice (New Page)
            </Link>
            <Link href="/invoices" className="button button--secondary button--lg">
              View All Invoices ↗
            </Link>
          </div>
        </div>
        <div className="billing-hero-art" aria-hidden="true">
          <div className="billing-art-card">
            <span className="art-line art-line--1" />
            <span className="art-line art-line--2" />
            <span className="art-pill">COMPLIMENTARY</span>
            <span className="art-line art-line--3" />
          </div>
        </div>
      </div>

      {/* Visual Pipeline Funnel */}
      <PipelineFunnel
        draftCount={billing.draftCount}
        expiringSoonCount={billing.expiringSoonCount}
        issued30dCount={billing.issued30dCount}
        settledCount={billing.settledCount}
      />

      {/* Quick Access Grid */}
      <div className="billing-shortcuts-grid">
        <Link href="/customers" className="billing-shortcut-card">
          <span className="shortcut-icon"><Icon name="users" size={20} /></span>
          <div>
            <strong>Customer Master Data</strong>
            <p>Look up client billing addresses, GSTINs, and verified contact numbers.</p>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </Link>

        <Link href="/catalog" className="billing-shortcut-card">
          <span className="shortcut-icon"><Icon name="box" size={20} /></span>
          <div>
            <strong>Product &amp; Service Catalog</strong>
            <p>Manage items, unit descriptions, and default GST rates.</p>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </Link>

        <Link href="/quotations" className="billing-shortcut-card">
          <span className="shortcut-icon"><Icon name="quote" size={20} /></span>
          <div>
            <strong>Customer Quotations</strong>
            <p>Track proposals and convert accepted quotes directly into draft invoices.</p>
          </div>
          <Icon name="arrow-up-right" size={16} />
        </Link>
      </div>
    </div>
  );
}
