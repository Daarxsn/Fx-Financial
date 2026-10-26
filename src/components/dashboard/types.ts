export interface MonthlyTrendPoint {
  month: string;
  invoiced: number;
  collected: number;
  count: number;
}

export interface BrandDistributionItem {
  name: string;
  code: string;
  revenue: number;
  invoiceCount: number;
  percent: number;
}

export interface HighValueInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  grandTotal: number;
  paymentStatus: string;
  invoiceDate: string;
}

export interface AgingBucket {
  label: string;
  amount: number;
  percent: number;
  tone: "success" | "warning" | "danger" | "critical";
}

export interface AuditEventItem {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
}

export interface DashboardData {
  currency: string;
  asOf: string;
  userRoles: string[];
  executive: {
    totalInvoiced: number;
    totalOutstanding: number;
    cashCollectedMtd: number;
    cashCollectedToday: number;
    dsoDays: number;
    monthlyTrend: MonthlyTrendPoint[];
    brandDistribution: BrandDistributionItem[];
    highValueInvoices: HighValueInvoice[];
  };
  accountant: {
    dueForCollection: number;
    overdueBalance: number;
    collectedToday: number;
    collectedMtd: number;
    agingBuckets: AgingBucket[];
  };
  controller: {
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    totalTax: number;
    gstin: string;
    taxJurisdiction: string;
    policiesApprovedCount: number;
    policiesTotalCount: number;
    numberingSeries: {
      prefix: string;
      sequenceWidth: number;
      nextSequenceValue: number;
    };
  };
  billing: {
    draftCount: number;
    issued30dCount: number;
    expiringSoonCount: number;
    settledCount: number;
  };
  auditor: {
    cryptographicIntegrityScore: string;
    snapshotCount: number;
    outboxStats: {
      queued: number;
      sent: number;
      failed: number;
    };
    recentAuditEvents: AuditEventItem[];
  };
}

export type RoleTabId = "executive" | "accountant" | "controller" | "billing" | "auditor";
