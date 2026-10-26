"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { TaxTimelineChart } from "./tax-timeline-chart";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
}

export function ControllerDashboard({ data }: Props) {
  const { controller } = data;

  return (
    <div className="role-dashboard-container">
      {/* Visual GST Breakdown & Statutory Liabilities */}
      <TaxTimelineChart
        totalCgst={controller.totalCgst}
        totalSgst={controller.totalSgst}
        totalIgst={controller.totalIgst}
        totalTax={controller.totalTax}
        gstin={controller.gstin}
        taxJurisdiction={controller.taxJurisdiction}
      />

      {/* Statutory Governance & Numbering Health Grid */}
      <div className="analytics-charts-grid">
        {/* Active Numbering Sequence Card */}
        <div className="analytics-chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Statutory Numbering Series</h3>
              <p className="chart-subtitle">Monotonic non-repeating legal invoice sequence</p>
            </div>
            <span className="status-pill status-pill--active">Active Series</span>
          </div>

          <div className="series-display-box">
            <div className="series-main-badge">
              <span className="series-prefix">{controller.numberingSeries.prefix}</span>
              <span className="series-number">
                {String(controller.numberingSeries.nextSequenceValue).padStart(controller.numberingSeries.sequenceWidth, "0")}
              </span>
            </div>
            <p className="series-caption">
              Format: <strong>{controller.numberingSeries.prefix}001..{controller.numberingSeries.prefix}999</strong> (Sequence width: {controller.numberingSeries.sequenceWidth} digits)
            </p>
          </div>

          <div className="series-checklist">
            <div className="checklist-row">
              <span className="checklist-icon checklist-icon--success"><Icon name="check" size={14} /></span>
              <span>Prefix locked to canonical &quot;{controller.numberingSeries.prefix}&quot;</span>
            </div>
            <div className="checklist-row">
              <span className="checklist-icon checklist-icon--success"><Icon name="check" size={14} /></span>
              <span>Strict atomic locking &amp; zero serial gaps</span>
            </div>
            <div className="checklist-row">
              <span className="checklist-icon checklist-icon--success"><Icon name="check" size={14} /></span>
              <span>Next allocation: #{controller.numberingSeries.prefix}{String(controller.numberingSeries.nextSequenceValue).padStart(controller.numberingSeries.sequenceWidth, "0")}</span>
            </div>
          </div>
        </div>

        {/* Policy Decisions Status */}
        <div className="analytics-chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Business Policy Governance</h3>
              <p className="chart-subtitle">Statutory compliance rules D-01 through D-12</p>
            </div>
            <span className="status-pill status-pill--approved">
              {controller.policiesApprovedCount}/{controller.policiesTotalCount} Approved
            </span>
          </div>

          <div className="governance-progress-bar">
            <div
              className="governance-progress-fill"
              style={{
                width: `${(controller.policiesApprovedCount / controller.policiesTotalCount) * 100}%`,
              }}
            />
          </div>

          <div className="governance-list">
            <div className="gov-item">
              <strong>D-01 to D-03:</strong> Master Entity &amp; Canonical Contact Sign-off
              <span className="gov-check"><Icon name="check" size={14} /></span>
            </div>
            <div className="gov-item">
              <strong>D-04 to D-08:</strong> Sequential Numbering &amp; Dual Tax Mode (CGST/SGST/IGST)
              <span className="gov-check"><Icon name="check" size={14} /></span>
            </div>
            <div className="gov-item">
              <strong>D-09 to D-12:</strong> Cryptographic Snapshots &amp; A4 Proforma Templates
              <span className="gov-check"><Icon name="check" size={14} /></span>
            </div>
          </div>

          <div style={{ marginTop: "16px", textAlign: "right" }}>
            <Link href="/reports" className="button button--secondary button--sm">
              Tax &amp; Compliance Reports ↗
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
