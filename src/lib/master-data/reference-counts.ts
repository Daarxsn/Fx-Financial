import "server-only";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Queryable = Pick<Pool, "query"> | Pick<PoolConnection, "query">;
type ReferenceActor = { permissions: string[]; legalEntityIds: string[] };
type CountRow = RowDataPacket & { total: number };

export type CustomerReferenceCounts = { invoices: number | null; quotations: number | null; payments: number | null };
export type CatalogReferenceCounts = { invoiceLines: number | null; quotationLines: number | null };

/**
 * Document reference counts are only disclosed when the caller holds the matching read permission and
 * (for legal-entity owned documents) a legal-entity scope. Anything else is null, never an unscoped total.
 * Payments carry no legal_entity_id in the current schema, so payment reference counts remain hidden (null).
 */
function scope(actor: ReferenceActor, permission: string): string[] | null {
  return actor.permissions.includes(permission) && actor.legalEntityIds.length > 0 ? actor.legalEntityIds : null;
}

async function count(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.query<CountRow[]>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

export function canReadInvoiceScope(actor: ReferenceActor): string[] | null { return scope(actor, "invoices:read"); }
export function canReadQuotationScope(actor: ReferenceActor): string[] | null { return scope(actor, "quotations:read"); }

export async function customerReferenceCounts(db: Queryable, actor: ReferenceActor, customerId: string): Promise<CustomerReferenceCounts> {
  const invoiceScope = canReadInvoiceScope(actor);
  const quotationScope = canReadQuotationScope(actor);
  const placeholders = (ids: string[]) => ids.map(() => "?").join(",");
  return {
    invoices: invoiceScope ? await count(db, `SELECT COUNT(*) AS total FROM invoices WHERE customer_id=? AND legal_entity_id IN (${placeholders(invoiceScope)})`, [customerId, ...invoiceScope]) : null,
    quotations: quotationScope ? await count(db, `SELECT COUNT(*) AS total FROM quotations WHERE customer_id=? AND legal_entity_id IN (${placeholders(quotationScope)})`, [customerId, ...quotationScope]) : null,
    payments: null, // Payments lack reliable legal-entity attribution.
  };
}

export async function catalogReferenceCounts(db: Queryable, actor: ReferenceActor, itemId: string): Promise<CatalogReferenceCounts> {
  const invoiceScope = canReadInvoiceScope(actor);
  const quotationScope = canReadQuotationScope(actor);
  const placeholders = (ids: string[]) => ids.map(() => "?").join(",");
  return {
    invoiceLines: invoiceScope ? await count(db,
      `SELECT COUNT(*) AS total FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE l.catalog_item_id=? AND i.legal_entity_id IN (${placeholders(invoiceScope)})`,
      [itemId, ...invoiceScope]) : null,
    quotationLines: quotationScope ? await count(db,
      `SELECT COUNT(*) AS total FROM quotation_lines l JOIN quotations q ON q.id=l.quotation_id WHERE l.catalog_item_id=? AND q.legal_entity_id IN (${placeholders(quotationScope)})`,
      [itemId, ...quotationScope]) : null,
  };
}

/** Unscoped totals for the internal audit trail only; never return these to a caller. */
export async function customerReferenceTotals(db: Queryable, customerId: string) {
  return {
    invoices: await count(db, "SELECT COUNT(*) AS total FROM invoices WHERE customer_id=?", [customerId]),
    quotations: await count(db, "SELECT COUNT(*) AS total FROM quotations WHERE customer_id=?", [customerId]),
    payments: await count(db, "SELECT COUNT(*) AS total FROM payments WHERE customer_id=?", [customerId]),
  };
}

export async function catalogReferenceTotals(db: Queryable, itemId: string) {
  return {
    invoiceLines: await count(db, "SELECT COUNT(*) AS total FROM invoice_lines WHERE catalog_item_id=?", [itemId]),
    quotationLines: await count(db, "SELECT COUNT(*) AS total FROM quotation_lines WHERE catalog_item_id=?", [itemId]),
  };
}
