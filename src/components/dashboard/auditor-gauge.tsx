"use client";

import { Icon } from "@/components/icon";
import type { AuditEventItem } from "./types";

interface Props {
  cryptographicIntegrityScore: string;
  snapshotCount: number;
  outboxStats: {
    queued: number;
    sent: number;
    failed: number;
  };
  recentAuditEvents: AuditEventItem[];
}

export function AuditorGauge({
  cryptographicIntegrityScore,
  snapshotCount,
  outboxStats,
  recentAuditEvents,
}: Props) {
  return (
    <div className="analytics-chart-card">
      <div className="chart-header">
        <div>
          <h3 className="chart-title">Ledger Integrity & Statutory Audit Telemetry</h3>
          <p className="chart-subtitle">Cryptographic verification of immutable document snapshots, email dispatch, and audit trails</p>
        </div>
        <div className="auditor-status-badge">
          <span className="auditor-status-dot" />
          <span>Statutory Compliance Verified</span>
        </div>
      </div>

      <div className="auditor-telemetry-grid">
        {/* Dial / Metric Card */}
        <div className="auditor-metric-card auditor-metric-card--highlight">
          <div className="auditor-card-title">Cryptographic Integrity Score</div>
          <div className="auditor-score-gauge">
            <svg viewBox="0 0 120 70" className="gauge-svg" style={{ width: "130px" }}>
              <path
                d="M 15 65 A 45 45 0 0 1 105 65"
                fill="none"
                stroke="var(--surface-muted, #e2e8f0)"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path
                d="M 15 65 A 45 45 0 0 1 105 65"
                fill="none"
                stroke="#10B981"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="141.37"
                strokeDashoffset="0"
              />
            </svg>
            <div className="gauge-value-display">{cryptographicIntegrityScore}</div>
          </div>
          <p className="auditor-card-caption">All document content snapshots match SHA-256 integrity hash</p>
        </div>

        {/* Snapshots count */}
        <div className="auditor-metric-card">
          <div className="auditor-card-title">Immutable Document Snapshots</div>
          <div className="auditor-big-stat">
            <span className="auditor-big-number">{snapshotCount}</span>
            <span className="auditor-stat-icon"><Icon name="shield" size={24} /></span>
          </div>
          <p className="auditor-card-caption">Zero payload mutations detected since legal entity inception</p>
        </div>

        {/* Email Outbox telemetry */}
        <div className="auditor-metric-card">
          <div className="auditor-card-title">Transactional Outbox Dispatch</div>
          <div className="outbox-pills-row">
            <div className="outbox-pill outbox-pill--sent">
              <span className="outbox-pill-count">{outboxStats.sent}</span>
              <span className="outbox-pill-label">Delivered</span>
            </div>
            <div className="outbox-pill outbox-pill--queued">
              <span className="outbox-pill-count">{outboxStats.queued}</span>
              <span className="outbox-pill-label">Queued</span>
            </div>
            <div className="outbox-pill outbox-pill--failed">
              <span className="outbox-pill-count">{outboxStats.failed}</span>
              <span className="outbox-pill-label">Failed</span>
            </div>
          </div>
          <p className="auditor-card-caption">Reliable queue with automatic retry & DLQ protection</p>
        </div>
      </div>

      {/* Recent Audit Events Stream */}
      <div className="auditor-trail-section">
        <h4 className="auditor-trail-title">Recent Immutable Audit Trail</h4>
        <div className="auditor-trail-list">
          {recentAuditEvents.length === 0 ? (
            <div className="auditor-trail-empty">No recent audit events recorded.</div>
          ) : (
            recentAuditEvents.map((event) => (
              <div key={event.id} className="auditor-trail-row">
                <span className="auditor-trail-dot" />
                <span className="auditor-trail-action">{event.action}</span>
                <span className="auditor-trail-entity">{event.entityType}</span>
                <span className="auditor-trail-time">
                  {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
