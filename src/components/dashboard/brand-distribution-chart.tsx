"use client";

import { useState } from "react";
import type { BrandDistributionItem } from "./types";

interface Props {
  data: BrandDistributionItem[];
  currency?: string;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

const BRAND_PALETTE: Record<string, { fill: string; stroke: string; bg: string }> = {
  MYFXPOS: { fill: "#10B981", stroke: "#059669", bg: "rgba(16, 185, 129, 0.12)" },
  FX_DIGITECH: { fill: "#DCAF51", stroke: "#B38728", bg: "rgba(220, 175, 81, 0.12)" },
  FX_COWORKS: { fill: "#8B5CF6", stroke: "#6D28D9", bg: "rgba(139, 92, 246, 0.12)" },
};

export function BrandDistributionChart({ data }: Props) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  const totalRev = data.reduce((sum, item) => sum + item.revenue, 0);

  // Fallback if no brands or 0 revenue
  const items = data.length > 0 ? data : [
    { name: "MyFX POS", code: "MYFXPOS", revenue: 0, invoiceCount: 0, percent: 33.3 },
    { name: "FX Digitech", code: "FX_DIGITECH", revenue: 0, invoiceCount: 0, percent: 33.3 },
    { name: "FX Coworks", code: "FX_COWORKS", revenue: 0, invoiceCount: 0, percent: 33.4 },
  ];

  // Calculate SVG Donut slice paths immutably
  const size = 180;
  const center = size / 2;
  const radius = 72;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;

  // Pre-calculate cumulative percentages for offset
  const slices = items.reduce<
    Array<{
      name: string;
      code: string;
      revenue: number;
      invoiceCount: number;
      pct: number;
      strokeDasharray: string;
      strokeDashoffset: number;
      colors: { fill: string; stroke: string; bg: string };
    }>
  >((acc, item) => {
    const priorOffsetPct = acc.reduce((sum, prev) => sum + prev.pct, 0);
    const pct = totalRev > 0 ? (item.revenue / totalRev) * 100 : (100 / items.length);
    const strokeDasharray = `${(pct / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -((priorOffsetPct / 100) * circumference);
    const colors = BRAND_PALETTE[item.code] || { fill: "#64748B", stroke: "#475569", bg: "rgba(100, 116, 139, 0.12)" };

    acc.push({
      ...item,
      pct,
      strokeDasharray,
      strokeDashoffset,
      colors,
    });
    return acc;
  }, []);

  const activeItem = hoveredCode ? items.find((i) => i.code === hoveredCode) : null;

  return (
    <div className="analytics-chart-card">
      <div className="chart-header">
        <div>
          <h3 className="chart-title">Commercial Brand Distribution</h3>
          <p className="chart-subtitle">Revenue contribution across approved commercial product lines</p>
        </div>
      </div>

      <div className="brand-chart-layout">
        <div className="donut-wrapper">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="donut-svg"
            style={{ width: "160px", height: "160px", transform: "rotate(-90deg)" }}
            aria-label="Brand Distribution Donut Chart"
            role="img"
          >
            {/* Background ring track */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke="var(--surface-muted, #f1f5f9)"
              strokeWidth={strokeWidth}
            />

            {/* Slices */}
            {slices.map((slice) => {
              const isHovered = hoveredCode === slice.code;
              return (
                <circle
                  key={slice.code}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="transparent"
                  stroke={slice.colors.fill}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={slice.strokeDasharray}
                  strokeDashoffset={slice.strokeDashoffset}
                  strokeLinecap="butt"
                  style={{
                    transition: "stroke-width 0.2s ease, opacity 0.2s ease",
                    cursor: "pointer",
                    opacity: hoveredCode !== null && !isHovered ? 0.6 : 1,
                  }}
                  onMouseEnter={() => setHoveredCode(slice.code)}
                  onMouseLeave={() => setHoveredCode(null)}
                />
              );
            })}
          </svg>

          {/* Center text in donut */}
          <div className="donut-center-metric">
            <span className="donut-center-label">
              {activeItem ? activeItem.name : "Total Billed"}
            </span>
            <strong className="donut-center-value">
              {activeItem ? formatCurrency(activeItem.revenue) : formatCurrency(totalRev)}
            </strong>
            <span className="donut-center-sub">
              {activeItem ? `${activeItem.invoiceCount} invoices` : `${data.reduce((c, i) => c + i.invoiceCount, 0)} invoices`}
            </span>
          </div>
        </div>

        {/* Legend / Breakdown List */}
        <div className="brand-legend-list">
          {items.map((item) => {
            const colors = BRAND_PALETTE[item.code] || { fill: "#64748B", stroke: "#475569", bg: "rgba(100, 116, 139, 0.12)" };
            const isHovered = hoveredCode === item.code;
            const pct = totalRev > 0 ? ((item.revenue / totalRev) * 100).toFixed(1) : "0.0";

            return (
              <div
                key={item.code}
                className={`brand-legend-row ${isHovered ? "brand-legend-row--active" : ""}`}
                onMouseEnter={() => setHoveredCode(item.code)}
                onMouseLeave={() => setHoveredCode(null)}
                style={{
                  borderLeft: `4px solid ${colors.fill}`,
                  background: isHovered ? colors.bg : "var(--surface, #ffffff)",
                }}
              >
                <div className="brand-legend-info">
                  <span className="brand-legend-name">{item.name}</span>
                  <span className="brand-legend-invoices">{item.invoiceCount} {item.invoiceCount === 1 ? "invoice" : "invoices"}</span>
                </div>
                <div className="brand-legend-stats">
                  <strong className="brand-legend-amount">{formatCurrency(item.revenue)}</strong>
                  <span className="brand-legend-badge" style={{ backgroundColor: colors.bg, color: colors.stroke }}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
