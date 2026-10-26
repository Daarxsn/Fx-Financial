"use client";

import type { AgingBucket } from "./types";

interface Props {
  buckets: AgingBucket[];
  totalOutstanding: number;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

const BUCKET_THEMES = {
  success: {
    color: "#10B981",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.28)",
    label: "Within Proforma Terms",
  },
  warning: {
    color: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.28)",
    label: "Grace Period Overdue",
  },
  danger: {
    color: "#EF4444",
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.28)",
    label: "High Priority Recovery",
  },
  critical: {
    color: "#991B1B",
    bg: "rgba(153, 27, 27, 0.14)",
    border: "rgba(153, 27, 27, 0.35)",
    label: "Escalated Statutory Due",
  },
};

export function AgingCurveChart({ buckets, totalOutstanding }: Props) {
  return (
    <div className="analytics-chart-card">
      <div className="chart-header">
        <div>
          <h3 className="chart-title">Receivables Aging & Risk Exposure</h3>
          <p className="chart-subtitle">Aging timeline tracking unpaid balances against 15-day proforma validity windows</p>
        </div>
        <div className="aging-total-pill">
          <span>Total Outstanding:</span>
          <strong>{formatCurrency(totalOutstanding)}</strong>
        </div>
      </div>

      {/* Horizontal Stacked Distribution Bar */}
      <div className="aging-stacked-bar-container">
        <div className="aging-stacked-bar" role="progressbar" aria-label="Receivables Aging Distribution">
          {buckets.map((b) => {
            const theme = BUCKET_THEMES[b.tone] || BUCKET_THEMES.success;
            const pct = totalOutstanding > 0 ? (b.amount / totalOutstanding) * 100 : 0;
            if (pct <= 0) return null;

            return (
              <div
                key={b.label}
                className="aging-bar-segment"
                style={{
                  width: `${pct}%`,
                  backgroundColor: theme.color,
                }}
                title={`${b.label}: ${formatCurrency(b.amount)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* 4 Bucket Cards */}
      <div className="aging-grid">
        {buckets.map((b) => {
          const theme = BUCKET_THEMES[b.tone] || BUCKET_THEMES.success;
          const pct = totalOutstanding > 0 ? ((b.amount / totalOutstanding) * 100).toFixed(1) : "0.0";

          return (
            <div
              key={b.label}
              className="aging-bucket-card"
              style={{
                borderColor: theme.border,
                backgroundColor: "var(--surface, #ffffff)",
              }}
            >
              <div className="aging-bucket-top">
                <span className="aging-bucket-pill" style={{ backgroundColor: theme.bg, color: theme.color }}>
                  {b.label}
                </span>
                <span className="aging-bucket-pct">{pct}%</span>
              </div>
              <div className="aging-bucket-amount">{formatCurrency(b.amount)}</div>
              <div className="aging-bucket-desc">{theme.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
