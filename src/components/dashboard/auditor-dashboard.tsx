"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { AuditorGauge } from "./auditor-gauge";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
}

export function AuditorDashboard({ data }: Props) {
  const { auditor } = data;

  return (
    <div className="role-dashboard-container">
      {/* Cryptographic Integrity & Telemetry */}
      <AuditorGauge
        cryptographicIntegrityScore={auditor.cryptographicIntegrityScore}
        snapshotCount={auditor.snapshotCount}
        outboxStats={auditor.outboxStats}
        recentAuditEvents={auditor.recentAuditEvents}
      />

      {/* Statutory Audit Navigation Station */}
      <div className="accountant-actions-card">
        <div className="action-card-left">
          <div className="action-icon-wrapper" style={{ backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#10B981" }}>
            <Icon name="shield" size={24} />
          </div>
          <div>
            <h4 className="action-title">Statutory Audit &amp; Ledger Verification</h4>
            <p className="action-subtitle">
              Inspect immutable audit records, review document revision hashes, and verify outbound email delivery telemetry.
            </p>
          </div>
        </div>
        <div className="action-card-buttons">
          <Link href="/audit" className="button button--primary button--md">
            Full Audit Logs ↗
          </Link>
          <Link href="/reports" className="button button--secondary button--md">
            Statutory Reports &amp; CSV ↗
          </Link>
        </div>
      </div>
    </div>
  );
}
