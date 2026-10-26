"use client";

import { useEffect, useState, useId } from "react";
import { RoleSwitcher } from "./role-switcher";
import { ExecutiveDashboard } from "./executive-dashboard";
import { AccountantDashboard } from "./accountant-dashboard";
import { ControllerDashboard } from "./controller-dashboard";
import { BillingDashboard } from "./billing-dashboard";
import { AuditorDashboard } from "./auditor-dashboard";
import type { DashboardData, RoleTabId } from "./types";

function pickDefaultRoleTab(roles: string[]): RoleTabId {
  if (roles.includes("system_admin")) return "executive";
  if (roles.includes("payment_recorder")) return "accountant";
  if (roles.includes("finance_admin")) return "controller";
  if (roles.includes("invoice_creator") || roles.includes("invoice_issuer")) return "billing";
  if (roles.includes("auditor")) return "auditor";
  return "executive";
}

export function DashboardHub() {
  const baseId = useId();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RoleTabId>("executive");

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(async () => {
      try {
        const res = await fetch("/api/v1/analytics/dashboard");
        if (!res.ok) {
          throw new Error(`Failed to load analytics: ${res.statusText}`);
        }
        const json = await res.json();
        if (isMounted && json.data) {
          setData(json.data);
          setActiveTab(pickDefaultRoleTab(json.data.userRoles || []));
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Error loading dashboard metrics");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="analytics-loading-card">
        <div className="loading-spinner" />
        <p>Loading real-time financial analytics &amp; role metrics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="analytics-error-card">
        <p>Unable to load live dashboard metrics. Scoped permissions required.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-hub-section">
      <RoleSwitcher
        activeTab={activeTab}
        onTabChange={setActiveTab}
        userRoles={data.userRoles || []}
      />

      <div
        id={`${baseId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeTab}`}
        className="dashboard-tab-panel"
      >
        {activeTab === "executive" && <ExecutiveDashboard data={data} />}
        {activeTab === "accountant" && <AccountantDashboard data={data} />}
        {activeTab === "controller" && <ControllerDashboard data={data} />}
        {activeTab === "billing" && <BillingDashboard data={data} />}
        {activeTab === "auditor" && <AuditorDashboard data={data} />}
      </div>
    </div>
  );
}
