"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { AgingCurveChart } from "./aging-curve-chart";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

export function AccountantDashboard({ data }: Props) {
  const { accountant } = data;

  return (
    <div className="role-dashboard-container">
      {/* Accountant KPI Grid */}
      <div className="analytics-kpi-grid">
        <div className="analytics-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Due for Collection</span>
            <span className="kpi-icon"><Icon name="clock" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(accountant.dueForCollection)}</div>
          <div className="kpi-trend">
            <span>All unsettled issued proformas</span>
          </div>
        </div>

        <div className="analytics-kpi-card analytics-kpi-card--danger">
          <div className="kpi-top">
            <span className="kpi-label">Overdue Balance (&gt;15 Days)</span>
            <span className="kpi-icon"><Icon name="alert" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(accountant.overdueBalance)}</div>
          <div className="kpi-trend kpi-trend--negative">
            <span>Past proforma validity limit</span>
          </div>
        </div>

        <div className="analytics-kpi-card analytics-kpi-card--emerald">
          <div className="kpi-top">
            <span className="kpi-label">Collected Today</span>
            <span className="kpi-icon"><Icon name="check" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(accountant.collectedToday)}</div>
          <div className="kpi-trend kpi-trend--positive">
            <span>Real-time NEFT / UPI receipts</span>
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Cash Collected (MTD)</span>
            <span className="kpi-icon"><Icon name="wallet" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(accountant.collectedMtd)}</div>
          <div className="kpi-trend">
            <span>Month-to-date cleared funds</span>
          </div>
        </div>
      </div>

      {/* Visual Receivables Aging Curve */}
      <AgingCurveChart
        buckets={accountant.agingBuckets}
        totalOutstanding={accountant.dueForCollection}
      />

      {/* Accountant Quick Workflow Hub */}
      <div className="accountant-actions-card">
        <div className="action-card-left">
          <div className="action-icon-wrapper">
            <Icon name="wallet" size={24} />
          </div>
          <div>
            <h4 className="action-title">Daily Reconciliation & Receipt Posting</h4>
            <p className="action-subtitle">
              Post client payments, allocate receipts against open invoices, and generate filtered CSV audit statements.
            </p>
          </div>
        </div>
        <div className="action-card-buttons">
          <Link href="/payments" className="button button--primary button--md">
            + Record Payment
          </Link>
          <Link href="/invoices" className="button button--secondary button--md">
            Accountant Invoices (CSV) ↗
          </Link>
          <Link href="/customers" className="button button--ghost button--md">
            Client Ledgers ↗
          </Link>
        </div>
      </div>
    </div>
  );
}
