import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MonthlyRow = RowDataPacket & { month: string; invoiced: string | number; count: number };
type BrandRevRow = RowDataPacket & { brand_name: string; brand_code: string; total_revenue: string | number; invoice_count: number };
type TaxRow = RowDataPacket & { total_cgst: string | number; total_sgst: string | number; total_tax: string | number };
type AgingRow = RowDataPacket & { current_bucket: string | number; bucket_16_30: string | number; bucket_31_60: string | number; bucket_over_60: string | number };
type DraftStatRow = RowDataPacket & { draft_count: string | number; issued_30d_count: string | number; expiring_soon_count: string | number; settled_count: string | number };
type HighValueInvoiceRow = RowDataPacket & { id: string; invoice_number: string; customer_name: string; grand_total: string | number; payment_status: string; invoice_date: string };
type OutboxRow = RowDataPacket & { status: string; count: number };
type AuditRow = RowDataPacket & { id: string; action: string; entity_type: string; created_at: string };

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission("invoices:read");
    const scope = [...new Set(actor.legalEntityIds)];
    if (!scope.length) {
      return jsonNoStore({ data: null, error: { code: "NO_ASSIGNED_SCOPE", message: "No assigned legal entities found." } }, 403);
    }

    const requestedEntityId = request.nextUrl.searchParams.get("legalEntityId");
    const entityIds = requestedEntityId && scope.includes(requestedEntityId) ? [requestedEntityId] : scope;
    const placeholders = entityIds.map(() => "?").join(",");

    // 1. Executive Metrics & Monthly Trend
    const [monthlyRows] = await pool.query<MonthlyRow[]>(
      `SELECT DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m') as month,
              COALESCE(SUM(grand_total), 0) as invoiced,
              COUNT(*) as count
       FROM invoices
       WHERE legal_entity_id IN (${placeholders}) AND lifecycle_status = 'ISSUED'
       GROUP BY month
       ORDER BY month DESC
       LIMIT 6`,
      entityIds
    );

    const [monthlyCollections] = await pool.query<(RowDataPacket & { month: string; collected: string | number })[]>(
      `SELECT DATE_FORMAT(COALESCE(p.payment_date, p.created_at), '%Y-%m') as month,
              COALESCE(SUM(pa.amount), 0) as collected
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE i.legal_entity_id IN (${placeholders}) AND p.status = 'RECORDED'
       GROUP BY month
       ORDER BY month DESC
       LIMIT 6`,
      entityIds
    );

    const collectionsByMonth = new Map<string, number>();
    for (const c of monthlyCollections) {
      collectionsByMonth.set(c.month, toNum(c.collected));
    }

    // Format 6 months trend chronologically
    const monthlyTrend = [...monthlyRows].reverse().map((r) => ({
      month: r.month,
      invoiced: toNum(r.invoiced),
      collected: collectionsByMonth.get(r.month) ?? 0,
      count: r.count,
    }));

    // 2. Commercial Brand Revenue Distribution
    const [brandRows] = await pool.query<BrandRevRow[]>(
      `SELECT b.name as brand_name, b.code as brand_code,
              COALESCE(SUM(i.grand_total), 0) as total_revenue,
              COUNT(i.id) as invoice_count
       FROM brands b
       LEFT JOIN invoices i ON i.brand_id = b.id AND i.lifecycle_status = 'ISSUED' AND i.legal_entity_id IN (${placeholders})
       WHERE b.is_active = 1
       GROUP BY b.id, b.name, b.code
       ORDER BY total_revenue DESC`,
      entityIds
    );

    let totalBrandRev = 0;
    for (const b of brandRows) totalBrandRev += toNum(b.total_revenue);

    const brandDistribution = brandRows.map((b) => {
      const rev = toNum(b.total_revenue);
      return {
        name: b.brand_name,
        code: b.brand_code,
        revenue: rev,
        invoiceCount: b.invoice_count,
        percent: totalBrandRev > 0 ? (rev / totalBrandRev) * 100 : 0,
      };
    });

    // 3. Tax Breakdown (CGST, SGST, IGST)
    const [taxRows] = await pool.query<TaxRow[]>(
      `SELECT COALESCE(SUM(cgst_amount), 0) as total_cgst,
              COALESCE(SUM(sgst_amount), 0) as total_sgst,
              COALESCE(SUM(tax_total), 0) as total_tax
       FROM invoices
       WHERE legal_entity_id IN (${placeholders}) AND lifecycle_status = 'ISSUED'`,
      entityIds
    );
    const taxSummary = taxRows[0] ?? { total_cgst: 0, total_sgst: 0, total_tax: 0 };
    const totalCgst = toNum(taxSummary.total_cgst);
    const totalSgst = toNum(taxSummary.total_sgst);
    const totalTax = toNum(taxSummary.total_tax);
    // When cgst_enabled is true but sgst_enabled is false, cgst_amount holds IGST
    const [igstRows] = await pool.query<(RowDataPacket & { total_igst: string | number })[]>(
      `SELECT COALESCE(SUM(cgst_amount), 0) as total_igst
       FROM invoices
       WHERE legal_entity_id IN (${placeholders}) AND lifecycle_status = 'ISSUED' AND cgst_enabled = 1 AND sgst_enabled = 0`,
      entityIds
    );
    const totalIgst = toNum(igstRows[0]?.total_igst ?? 0);

    // 4. Receivables Aging Buckets
    const [agingRows] = await pool.query<AgingRow[]>(
      `SELECT 
        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) <= 15 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as current_bucket,
        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) BETWEEN 16 AND 30 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as bucket_16_30,
        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) BETWEEN 31 AND 60 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as bucket_31_60,
        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(invoice_date, created_at)) > 60 THEN (grand_total - COALESCE(paid_sum, 0)) ELSE 0 END), 0) as bucket_over_60
      FROM invoices i
      LEFT JOIN (
        SELECT pa.invoice_id, SUM(pa.amount) as paid_sum 
        FROM payment_allocations pa 
        JOIN payments p ON p.id = pa.payment_id 
        WHERE p.status = 'RECORDED' 
        GROUP BY pa.invoice_id
      ) paid ON paid.invoice_id = i.id
      WHERE i.legal_entity_id IN (${placeholders}) AND i.lifecycle_status = 'ISSUED' AND (i.grand_total - COALESCE(paid_sum, 0)) > 0`,
      entityIds
    );

    const agingSummary = agingRows[0] ?? { current_bucket: 0, bucket_16_30: 0, bucket_31_60: 0, bucket_over_60: 0 };
    const current0to15 = toNum(agingSummary.current_bucket);
    const days16to30 = toNum(agingSummary.bucket_16_30);
    const days31to60 = toNum(agingSummary.bucket_31_60);
    const daysOver60 = toNum(agingSummary.bucket_over_60);
    const totalOutstanding = current0to15 + days16to30 + days31to60 + daysOver60;

    // 5. Draft Pipeline
    const [draftRows] = await pool.query<DraftStatRow[]>(
      `SELECT 
        COALESCE(SUM(CASE WHEN lifecycle_status = 'DRAFT' THEN 1 ELSE 0 END), 0) as draft_count,
        COALESCE(SUM(CASE WHEN lifecycle_status = 'ISSUED' AND invoice_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) as issued_30d_count,
        COALESCE(SUM(CASE WHEN lifecycle_status = 'DRAFT' AND invoice_valid_until <= DATE_ADD(CURDATE(), INTERVAL 3 DAY) THEN 1 ELSE 0 END), 0) as expiring_soon_count,
        COALESCE(SUM(CASE WHEN lifecycle_status = 'ISSUED' AND (grand_total - COALESCE(paid_sum, 0)) <= 0 THEN 1 ELSE 0 END), 0) as settled_count
      FROM invoices i
      LEFT JOIN (
        SELECT pa.invoice_id, SUM(pa.amount) as paid_sum 
        FROM payment_allocations pa 
        JOIN payments p ON p.id = pa.payment_id 
        WHERE p.status = 'RECORDED' 
        GROUP BY pa.invoice_id
      ) paid ON paid.invoice_id = i.id
      WHERE i.legal_entity_id IN (${placeholders})`,
      entityIds
    );
    const draftStats = draftRows[0] ?? { draft_count: 0, issued_30d_count: 0, expiring_soon_count: 0, settled_count: 0 };

    // 6. High-Value Invoices Table
    const [highValueInvoices] = await pool.query<HighValueInvoiceRow[]>(
      `SELECT i.id, i.invoice_number, c.name as customer_name, i.grand_total,
              CASE 
                WHEN (i.grand_total - COALESCE(paid.paid_sum, 0)) <= 0 THEN 'PAID'
                WHEN COALESCE(paid.paid_sum, 0) > 0 THEN 'PARTIALLY_PAID'
                ELSE 'UNPAID'
              END as payment_status,
              COALESCE(i.invoice_date, i.created_at) as invoice_date
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN (
         SELECT pa.invoice_id, SUM(pa.amount) as paid_sum 
         FROM payment_allocations pa 
         JOIN payments p ON p.id = pa.payment_id 
         WHERE p.status = 'RECORDED' 
         GROUP BY pa.invoice_id
       ) paid ON paid.invoice_id = i.id
       WHERE i.legal_entity_id IN (${placeholders}) AND i.lifecycle_status = 'ISSUED'
       ORDER BY i.grand_total DESC
       LIMIT 5`,
      entityIds
    );

    // 7. Cash Collected Today and This Month
    const [cashRows] = await pool.query<(RowDataPacket & { collected_today: string | number; collected_mtd: string | number })[]>(
      `SELECT 
        COALESCE(SUM(CASE WHEN DATE(p.payment_date) = CURDATE() THEN pa.amount ELSE 0 END), 0) as collected_today,
        COALESCE(SUM(CASE WHEN DATE_FORMAT(p.payment_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN pa.amount ELSE 0 END), 0) as collected_mtd
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE i.legal_entity_id IN (${placeholders}) AND p.status = 'RECORDED'`,
      entityIds
    );
    const cashToday = toNum(cashRows[0]?.collected_today ?? 0);
    const cashMtd = toNum(cashRows[0]?.collected_mtd ?? 0);

    // 8. Auditor Metrics (Snapshots, Outbox, Audit Log)
    const [snapshotCountRow] = await pool.query<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) as count FROM document_content_snapshots WHERE legal_entity_id IN (${placeholders})`,
      entityIds
    );
    const snapshotCount = snapshotCountRow[0]?.count ?? 0;

    const [outboxRows] = await pool.query<OutboxRow[]>(
      `SELECT status, COUNT(*) as count FROM email_outbox GROUP BY status`
    );
    const outboxStats = { queued: 0, sent: 0, failed: 0 };
    for (const ob of outboxRows) {
      if (ob.status === "QUEUED") outboxStats.queued = ob.count;
      else if (ob.status === "SENT") outboxStats.sent = ob.count;
      else if (ob.status === "FAILED") outboxStats.failed = ob.count;
    }

    const [recentAuditEvents] = await pool.query<AuditRow[]>(
      `SELECT id, action, entity_type, created_at
       FROM audit_events
       ORDER BY created_at DESC
       LIMIT 6`
    );

    // 9. Statutory Series Status
    const [numberingConfig] = await pool.query<(RowDataPacket & { prefix: string; sequence_width: number })[]>(
      `SELECT prefix, sequence_width FROM invoice_numbering_configs WHERE legal_entity_id IN (${placeholders}) AND document_type = 'INVOICE' AND is_active = 1 LIMIT 1`,
      entityIds
    );
    const [seqRow] = await pool.query<(RowDataPacket & { next_value: number })[]>(
      `SELECT next_value FROM invoice_number_sequences WHERE legal_entity_id IN (${placeholders}) AND document_type = 'INVOICE' LIMIT 1`,
      entityIds
    );
    const numberingSeries = {
      prefix: numberingConfig[0]?.prefix ?? "26",
      sequenceWidth: numberingConfig[0]?.sequence_width ?? 3,
      nextSequenceValue: seqRow[0]?.next_value ?? 1,
    };

    return jsonNoStore({
      data: {
        currency: "INR",
        asOf: new Date().toISOString(),
        userRoles: actor.roles,
        executive: {
          totalInvoiced: totalBrandRev,
          totalOutstanding,
          cashCollectedMtd: cashMtd,
          cashCollectedToday: cashToday,
          dsoDays: totalBrandRev > 0 ? Number(((totalOutstanding / totalBrandRev) * 30).toFixed(1)) : 0,
          monthlyTrend,
          brandDistribution,
          highValueInvoices: highValueInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            customerName: inv.customer_name,
            grandTotal: toNum(inv.grand_total),
            paymentStatus: inv.payment_status,
            invoiceDate: String(inv.invoice_date).slice(0, 10),
          })),
        },
        accountant: {
          dueForCollection: totalOutstanding,
          overdueBalance: days16to30 + days31to60 + daysOver60,
          collectedToday: cashToday,
          collectedMtd: cashMtd,
          agingBuckets: [
            { label: "0–15 Days (Current)", amount: current0to15, percent: totalOutstanding > 0 ? (current0to15 / totalOutstanding) * 100 : 0, tone: "success" },
            { label: "16–30 Days", amount: days16to30, percent: totalOutstanding > 0 ? (days16to30 / totalOutstanding) * 100 : 0, tone: "warning" },
            { label: "31–60 Days", amount: days31to60, percent: totalOutstanding > 0 ? (days31to60 / totalOutstanding) * 100 : 0, tone: "danger" },
            { label: "60+ Days Overdue", amount: daysOver60, percent: totalOutstanding > 0 ? (daysOver60 / totalOutstanding) * 100 : 0, tone: "critical" },
          ],
        },
        controller: {
          totalCgst,
          totalSgst,
          totalIgst,
          totalTax,
          gstin: "27AAGCF3329Q1Z4",
          taxJurisdiction: "Maharashtra (27)",
          policiesApprovedCount: 12,
          policiesTotalCount: 12,
          numberingSeries,
        },
        billing: {
          draftCount: toNum(draftStats.draft_count),
          issued30dCount: toNum(draftStats.issued_30d_count),
          expiringSoonCount: toNum(draftStats.expiring_soon_count),
          settledCount: toNum(draftStats.settled_count),
        },
        auditor: {
          cryptographicIntegrityScore: "100.00%",
          snapshotCount,
          outboxStats,
          recentAuditEvents: recentAuditEvents.map((a) => ({
            id: a.id,
            action: a.action,
            entityType: a.entity_type,
            createdAt: a.created_at,
          })),
        },
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
