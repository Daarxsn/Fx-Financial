"use client";

import { useId } from "react";
import type { RoleTabId } from "./types";

interface Props {
  activeTab: RoleTabId;
  onTabChange: (tab: RoleTabId) => void;
  userRoles: string[];
}

interface TabOption {
  id: RoleTabId;
  label: string;
  icon: string;
  associatedRoles: string[];
}

const TABS: TabOption[] = [
  { id: "executive", label: "Executive / CEO", icon: "👑", associatedRoles: ["system_admin"] },
  { id: "accountant", label: "Accountant & AR", icon: "📊", associatedRoles: ["payment_recorder"] },
  { id: "controller", label: "Finance Controller", icon: "🛡️", associatedRoles: ["finance_admin"] },
  { id: "billing", label: "Billing Specialist", icon: "📝", associatedRoles: ["invoice_creator", "invoice_issuer"] },
  { id: "auditor", label: "Auditor Compliance", icon: "🔍", associatedRoles: ["auditor"] },
];

export function RoleSwitcher({ activeTab, onTabChange, userRoles }: Props) {
  const baseId = useId();

  return (
    <div className="role-switcher-wrapper">
      <div className="role-switcher-header">
        <span className="role-switcher-eyebrow">TAILORED OPERATIONAL VIEWS</span>
        <span className="role-switcher-hint">Switch view to explore role-specific metrics &amp; workflows</span>
      </div>

      <div className="role-switcher-bar" role="tablist" aria-label="Dashboard role views">
        {TABS.map((tab) => {
          const isSelected = activeTab === tab.id;
          const isUserRole = tab.associatedRoles.some((r) => userRoles.includes(r));

          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              className={`role-tab-btn ${isSelected ? "role-tab-btn--active" : ""}`}
            >
              <span className="role-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="role-tab-label">{tab.label}</span>
              {isUserRole && (
                <span className="role-tab-badge">Active</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
