import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvoiceSummaryRow = RowDataPacket & {
  legal_entity_id: string; legal_entity_name: string; currency: string;
  issued_invoice_count: string | number; issued_invoice_total: string | number;
  allocated_invoice_total: string | number; outstanding_balance: string | number;
  overpaid_invoice_count: string | number;
};
type ReceiptSummaryRow = RowDataPacket & {
  legal_entity_id: string; legal_entity_name: string; currency: string;
  recorded_receipt_count: string | number; recorded_receipt_total: string | number;
  allocated_receipt_total: string | number; unallocated_receipt_total: string | number;
  reversed_receipt_count: string | number;
};
type Summary = {
  legalEntityId: string; legalEntityName: string; currency: string;
  issuedInvoiceCount: number; issuedInvoiceTotal: string; allocatedInvoiceTotal: string;
  outstandingBalance: string; overpaidInvoiceCount: number; recordedReceiptCount: number;
  recordedReceiptTotal: string; allocatedReceiptTotal: string; unallocatedReceiptTotal: string;
  reversedReceiptCount: number;
};

function toMoney(value: string | number): string {
  const input = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(input)) throw new Error("Unexpected non-decimal value in payment summary.");
  const [whole = "0", fraction = ""] = input.split(".");
  const units = BigInt(whole) * 10_000n + BigInt((fraction + "0000").slice(0, 4));
  return (units / 10_000n).toString() + "." + (units % 10_000n).toString().padStart(4, "0");
}
function makeSummary(legalEntityId: string, legalEntityName: string, currency: string): Summary {
  return {
    legalEntityId, legalEntityName, currency, issuedInvoiceCount: 0,
    issuedInvoiceTotal: "0.0000", allocatedInvoiceTotal: "0.0000", outstandingBalance: "0.0000",
    overpaidInvoiceCount: 0, recordedReceiptCount: 0, recordedReceiptTotal: "0.0000",
    allocatedReceiptTotal: "0.0000", unallocatedReceiptTotal: "0.0000", reversedReceiptCount: 0,
  };
}

export async function GET() {
  try {
    const actor = await requirePermission("payments:read");
    const scopes = [...new Set(actor.legalEntityIds)];
    if (!scopes.length) return jsonNoStore({ data: { asOf: new Date().toISOString(), summaries: [] }, meta: {} });
    const placeholders = scopes.map(() => "?").join(",");
    const [invoiceRows] = await pool.execute<InvoiceSummaryRow[]>(
      `SELECT i.legal_entity_id,le.display_name AS legal_entity_name,i.currency,
        COUNT(*) AS issued_invoice_count,
        COALESCE(SUM(i.grand_total),0) AS issued_invoice_total,
        COALESCE(SUM(COALESCE(a.allocated_total,0)),0) AS allocated_invoice_total,
        COALESCE(SUM(GREATEST(i.grand_total-COALESCE(a.allocated_total,0),0)),0) AS outstanding_balance,
        COALESCE(SUM(CASE WHEN i.grand_total<COALESCE(a.allocated_total,0) THEN 1 ELSE 0 END),0) AS overpaid_invoice_count
       FROM invoices i JOIN legal_entities le ON le.id=i.legal_entity_id
       LEFT JOIN (
         SELECT pa.invoice_id,SUM(pa.amount) AS allocated_total
         FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id AND p.status='RECORDED'
         GROUP BY pa.invoice_id
       ) a ON a.invoice_id=i.id
       WHERE i.legal_entity_id IN (${placeholders})
         AND i.document_type='INVOICE' AND i.lifecycle_status='ISSUED'
       GROUP BY i.legal_entity_id,le.display_name,i.currency
       ORDER BY le.display_name,i.currency`,
      scopes,
    );
    const [receiptRows] = await pool.execute<ReceiptSummaryRow[]>(
      `SELECT p.legal_entity_id,le.display_name AS legal_entity_name,p.currency,
        COALESCE(SUM(CASE WHEN p.status='RECORDED' THEN 1 ELSE 0 END),0) AS recorded_receipt_count,
        COALESCE(SUM(CASE WHEN p.status='RECORDED' THEN p.amount ELSE 0 END),0) AS recorded_receipt_total,
        COALESCE(SUM(CASE WHEN p.status='RECORDED' THEN COALESCE(a.allocated_total,0) ELSE 0 END),0) AS allocated_receipt_total,
        COALESCE(SUM(CASE WHEN p.status='RECORDED' THEN GREATEST(p.amount-COALESCE(a.allocated_total,0),0) ELSE 0 END),0) AS unallocated_receipt_total,
        COALESCE(SUM(CASE WHEN p.status='REVERSED' THEN 1 ELSE 0 END),0) AS reversed_receipt_count
       FROM payments p JOIN legal_entities le ON le.id=p.legal_entity_id
       LEFT JOIN (
         SELECT payment_id,SUM(amount) AS allocated_total FROM payment_allocations GROUP BY payment_id
       ) a ON a.payment_id=p.id
       WHERE p.legal_entity_id IN (${placeholders})
       GROUP BY p.legal_entity_id,le.display_name,p.currency
       ORDER BY le.display_name,p.currency`,
      scopes,
    );

    const summaries = new Map<string, Summary>();
    for (const row of invoiceRows) {
      const key = row.legal_entity_id + ":" + row.currency;
      const item = makeSummary(row.legal_entity_id, row.legal_entity_name, row.currency);
      item.issuedInvoiceCount = Number(row.issued_invoice_count);
      item.issuedInvoiceTotal = toMoney(row.issued_invoice_total);
      item.allocatedInvoiceTotal = toMoney(row.allocated_invoice_total);
      item.outstandingBalance = toMoney(row.outstanding_balance);
      item.overpaidInvoiceCount = Number(row.overpaid_invoice_count);
      summaries.set(key, item);
    }
    for (const row of receiptRows) {
      const key = row.legal_entity_id + ":" + row.currency;
      const item = summaries.get(key) ?? makeSummary(row.legal_entity_id, row.legal_entity_name, row.currency);
      item.recordedReceiptCount = Number(row.recorded_receipt_count);
      item.recordedReceiptTotal = toMoney(row.recorded_receipt_total);
      item.allocatedReceiptTotal = toMoney(row.allocated_receipt_total);
      item.unallocatedReceiptTotal = toMoney(row.unallocated_receipt_total);
      item.reversedReceiptCount = Number(row.reversed_receipt_count);
      summaries.set(key, item);
    }
    return jsonNoStore({
      data: {
        asOf: new Date().toISOString(),
        summaries: [...summaries.values()].sort((a, b) => a.legalEntityName.localeCompare(b.legalEntityName) || a.currency.localeCompare(b.currency)),
      },
      meta: {},
    });
  } catch (error) {
    return apiError(error);
  }
}
