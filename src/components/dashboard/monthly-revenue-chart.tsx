"use client";

import { useState } from "react";
import type { MonthlyTrendPoint } from "./types";

interface Props {
  data: MonthlyTrendPoint[];
  currency?: string;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

export function MonthlyRevenueChart({ data }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // If no trend data or only 1, display fallback/dummy padded
  const points = data.length > 0 ? data : [
    { month: "Current", invoiced: 0, collected: 0, count: 0 },
  ];

  const maxVal = Math.max(
    10000,
    ...points.map((p) => Math.max(p.invoiced, p.collected))
  );

  const chartHeight = 200;
  const chartWidth = 560;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 40;

  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  const barGroupWidth = innerWidth / points.length;
  const barWidth = Math.min(24, Math.max(12, (barGroupWidth - 20) / 2));

  // Y-axis grid levels (4 ticks)
  const yTicks = [0, 0.33, 0.66, 1].map((pct) => ({
    value: maxVal * pct,
    y: paddingTop + innerHeight * (1 - pct),
  }));

  return (
    <div className="analytics-chart-card">
      <div className="chart-header">
        <div>
          <h3 className="chart-title">Revenue Trajectory & Cash Velocity</h3>
          <p className="chart-subtitle">Chronological 6-month comparison of billed invoices vs settled cash receipts</p>
        </div>
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-dot legend-dot--gold" /> Invoiced
          </span>
          <span className="legend-item">
            <span className="legend-dot legend-dot--emerald" /> Collected
          </span>
        </div>
      </div>

      <div className="svg-chart-container" style={{ position: "relative", width: "100%", overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="analytics-svg"
          style={{ width: "100%", height: "auto", minWidth: "400px" }}
          aria-label="Monthly Revenue Trajectory Chart"
          role="img"
        >
          <defs>
            <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#DCAF51" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#9C7723" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0.8" />
            </linearGradient>
            <filter id="barShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.12" />
            </filter>
          </defs>

          {/* Grid lines & Y-axis labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={chartWidth - paddingRight}
                y2={tick.y}
                stroke="var(--border-subtle, #e2e8f0)"
                strokeDasharray={i === 0 ? "none" : "3,3"}
                strokeWidth={1}
              />
              <text
                x={paddingLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--fg-muted, #64748b)"
                fontFamily="inherit"
              >
                {tick.value >= 100000
                  ? `₹${(tick.value / 100000).toFixed(1)}L`
                  : tick.value >= 1000
                  ? `₹${(tick.value / 1000).toFixed(0)}k`
                  : `₹${tick.value.toFixed(0)}`}
              </text>
            </g>
          ))}

          {/* Bars */}
          {points.map((pt, idx) => {
            const groupCenterX = paddingLeft + idx * barGroupWidth + barGroupWidth / 2;
            const invoicedHeight = Math.max(2, (pt.invoiced / maxVal) * innerHeight);
            const collectedHeight = Math.max(2, (pt.collected / maxVal) * innerHeight);

            const invoicedX = groupCenterX - barWidth - 2;
            const collectedX = groupCenterX + 2;

            const invoicedY = paddingTop + innerHeight - invoicedHeight;
            const collectedY = paddingTop + innerHeight - collectedHeight;

            const isHovered = hoveredIdx === idx;

            return (
              <g
                key={pt.month}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: "pointer" }}
              >
                {/* Active highlight background column */}
                {isHovered && (
                  <rect
                    x={paddingLeft + idx * barGroupWidth + 4}
                    y={paddingTop}
                    width={barGroupWidth - 8}
                    height={innerHeight}
                    fill="var(--surface-active, rgba(220, 175, 81, 0.08))"
                    rx={6}
                  />
                )}

                {/* Invoiced Bar */}
                <rect
                  x={invoicedX}
                  y={invoicedY}
                  width={barWidth}
                  height={invoicedHeight}
                  fill="url(#goldGradient)"
                  rx={3}
                  filter="url(#barShadow)"
                  style={{
                    transition: "transform 0.2s ease, opacity 0.2s ease",
                    opacity: hoveredIdx !== null && !isHovered ? 0.6 : 1,
                  }}
                />

                {/* Collected Bar */}
                <rect
                  x={collectedX}
                  y={collectedY}
                  width={barWidth}
                  height={collectedHeight}
                  fill="url(#emeraldGradient)"
                  rx={3}
                  filter="url(#barShadow)"
                  style={{
                    transition: "transform 0.2s ease, opacity 0.2s ease",
                    opacity: hoveredIdx !== null && !isHovered ? 0.6 : 1,
                  }}
                />

                {/* X-axis Month Label */}
                <text
                  x={groupCenterX}
                  y={chartHeight - paddingBottom + 18}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isHovered ? "600" : "500"}
                  fill={isHovered ? "var(--fg, #0f172a)" : "var(--fg-muted, #64748b)"}
                  fontFamily="inherit"
                >
                  {pt.month}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredIdx !== null && points[hoveredIdx] && (
          <div
            className="chart-tooltip-floating"
            style={{
              position: "absolute",
              top: 10,
              right: 14,
              pointerEvents: "none",
            }}
          >
            <div className="tooltip-title">{points[hoveredIdx].month} Performance</div>
            <div className="tooltip-row">
              <span className="tooltip-dot legend-dot--gold" />
              <span>Invoiced:</span>
              <strong>{formatCurrency(points[hoveredIdx].invoiced)}</strong>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-dot legend-dot--emerald" />
              <span>Collected:</span>
              <strong>{formatCurrency(points[hoveredIdx].collected)}</strong>
            </div>
            <div className="tooltip-meta">
              {points[hoveredIdx].count} {points[hoveredIdx].count === 1 ? "invoice" : "invoices"} issued
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
