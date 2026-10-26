"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";

interface Props {
  draftCount: number;
  expiringSoonCount: number;
  issued30dCount: number;
  settledCount: number;
}

export function PipelineFunnel({
  draftCount,
  expiringSoonCount,
  issued30dCount,
  settledCount,
}: Props) {
  const stages = [
    {
      id: "drafts",
      title: "Active Drafts",
      count: draftCount,
      desc: "Unissued proformas currently in progress",
      color: "var(--accent, #DCAF51)",
      bg: "rgba(220, 175, 81, 0.12)",
      icon: "file" as const,
    },
    {
      id: "expiring",
      title: "Expiring Soon",
      count: expiringSoonCount,
      desc: "Proformas within 3 days of 15d expiry",
      color: expiringSoonCount > 0 ? "#EF4444" : "#64748B",
      bg: expiringSoonCount > 0 ? "rgba(239, 68, 68, 0.12)" : "rgba(100, 116, 139, 0.12)",
      icon: "clock" as const,
    },
    {
      id: "issued",
      title: "Issued (30 Days)",
      count: issued30dCount,
      desc: "Final legal invoices sent to clients",
      color: "#3B82F6",
      bg: "rgba(59, 130, 246, 0.12)",
      icon: "check" as const,
    },
    {
      id: "settled",
      title: "Fully Settled",
      count: settledCount,
      desc: "Invoices completely reconciled with receipts",
      color: "#10B981",
      bg: "rgba(16, 185, 129, 0.12)",
      icon: "wallet" as const,
    },
  ];

  return (
    <div className="analytics-chart-card">
      <div className="chart-header">
        <div>
          <h3 className="chart-title">Billing & Proforma Conversion Pipeline</h3>
          <p className="chart-subtitle">End-to-end lifecycle throughput from initial draft composition to full receipt settlement</p>
        </div>
        <Link href="/invoices/new" className="button button--primary button--sm">
          + Create New Invoice
        </Link>
      </div>

      {expiringSoonCount > 0 && (
        <div className="pipeline-alert-banner">
          <Icon name="clock" size={18} />
          <span>
            <strong>Attention:</strong> {expiringSoonCount} {expiringSoonCount === 1 ? "draft proforma is" : "draft proformas are"} approaching the 15-day expiry threshold. Issue or refresh before auto-expiration.
          </span>
        </div>
      )}

      <div className="pipeline-funnel-stages">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="pipeline-funnel-node-wrapper">
            <div
              className="pipeline-funnel-card"
              style={{
                borderTop: `4px solid ${stage.color}`,
              }}
            >
              <div className="pipeline-card-top">
                <span className="pipeline-card-icon" style={{ backgroundColor: stage.bg, color: stage.color }}>
                  <Icon name={stage.icon} size={18} />
                </span>
                <span className="pipeline-card-number">{stage.count}</span>
              </div>
              <h4 className="pipeline-card-title">{stage.title}</h4>
              <p className="pipeline-card-desc">{stage.desc}</p>
            </div>
            {idx < stages.length - 1 && (
              <div className="pipeline-funnel-arrow" aria-hidden="true">
                <Icon name="chevron-right" size={20} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
