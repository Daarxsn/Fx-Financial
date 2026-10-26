"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { MonthlyRevenueChart } from "./monthly-revenue-chart";
import { BrandDistributionChart } from "./brand-distribution-chart";
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

export function ExecutiveDashboard({ data }: Props) {
  const { executive } = data;

  return (
    <div className="role-dashboard-container">
      {/* Executive KPI Row */}
      <div className="analytics-kpi-grid">
        <div className="analytics-kpi-card analytics-kpi-card--gold">
          <div className="kpi-top">
            <span className="kpi-label">Total Billed Revenue</span>
            <span className="kpi-icon"><Icon name="wallet" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(executive.totalInvoiced)}</div>
          <div className="kpi-trend kpi-trend--positive">
            <Icon name="arrow-up-right" size={14} />
            <span>Across all active commercial brands</span>
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Outstanding Receivables</span>
            <span className="kpi-icon"><Icon name="clock" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(executive.totalOutstanding)}</div>
          <div className="kpi-trend">
            <span>Pending customer settlement</span>
          </div>
        </div>

        <div className="analytics-kpi-card analytics-kpi-card--emerald">
          <div className="kpi-top">
            <span className="kpi-label">Cash Collected (MTD)</span>
            <span className="kpi-icon"><Icon name="check" size={20} /></span>
          </div>
          <div className="kpi-value">{formatCurrency(executive.cashCollectedMtd)}</div>
          <div className="kpi-trend kpi-trend--positive">
            <Icon name="arrow-up-right" size={14} />
            <span>Reconciled bank deposits</span>
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Collection Velocity (DSO)</span>
            <span className="kpi-icon"><Icon name="chart" size={20} /></span>
          </div>
          <div className="kpi-value">{executive.dsoDays} <span className="kpi-unit">days</span></div>
          <div className="kpi-trend">
            <span>Average collection cycle time</span>
          </div>
        </div>
      </div>

      {/* Dual Visual Charts Grid */}
      <div className="analytics-charts-grid">
        <MonthlyRevenueChart data={executive.monthlyTrend} />
        <BrandDistributionChart data={executive.brandDistribution} />
      </div>

      {/* High-Value Client Invoices Table */}
      <div className="analytics-chart-card">
        <div className="chart-header">
          <div>
            <h3 className="chart-title">Top Value Invoices</h3>
            <p className="chart-subtitle">Largest client receivables requiring executive visibility</p>
          </div>
          <Link href="/invoices" className="button button--secondary button--sm">
            View All Invoices ↗
          </Link>
        </div>

        <div className="table-container" style={{ margin: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client Name</th>
                <th>Issue Date</th>
                <th>Total Value</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {executive.highValueInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--fg-muted)" }}>
                    No issued invoices recorded yet.
                  </td>
                </tr>
              ) : (
                executive.highValueInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <span className="code-badge">{inv.invoiceNumber}</span>
                    </td>
                    <td><strong>{inv.customerName}</strong></td>
                    <td style={{ color: "var(--fg-muted)" }}>{inv.invoiceDate}</td>
                    <td>
                      <strong style={{ color: "var(--accent-strong, #9C7723)" }}>
                        {formatCurrency(inv.grandTotal)}
                      </strong>
                    </td>
                    <td>
                      <span className={`status-pill status-pill--${inv.paymentStatus.toLowerCase().replace("_", "-")}`}>
                        {inv.paymentStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/invoices/${inv.id}`} className="button button--ghost button--sm">
                        Details ↗
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
