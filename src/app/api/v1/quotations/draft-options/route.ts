import type { RowDataPacket } from "mysql2";
import { requirePermission } from "@/lib/auth/authorize";
import { pool } from "@/lib/db/pool";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requirePermission("quotations:write");
    const scope = [...new Set(actor.legalEntityIds)];
    if (!scope.length) return jsonNoStore({ data: { legalEntities: [], customers: [], catalogItems: [], taxRules: [] } });
    const placeholders = scope.map(() => "?").join(",");
    const [entities] = await pool.query<(RowDataPacket & { id: string; display_name: string; currency: string; tax_setup_status: string })[]>(
      `SELECT id,display_name,currency,tax_setup_status FROM legal_entities
        WHERE id IN (${placeholders}) AND is_active=TRUE ORDER BY display_name,id`, scope,
    );
    const [customers] = await pool.query<(RowDataPacket & { id: string; name: string; customer_code: string | null; email: string | null; payment_terms_days: number | null })[]>(
      "SELECT id,name,customer_code,email,payment_terms_days FROM customers WHERE is_active=TRUE ORDER BY name,id LIMIT 1000",
    );
    const [catalogItems] = await pool.query<(RowDataPacket & { id: string; item_code: string | null; item_type: string; name: string; customer_description: string; unit_code: string; default_unit_price: string; currency: string; default_tax_code: string | null })[]>(
      "SELECT id,item_code,item_type,name,customer_description,unit_code,default_unit_price,currency,default_tax_code FROM catalog_items WHERE is_active=TRUE ORDER BY name,id LIMIT 1000",
    );
    const [taxRules] = await pool.query<(RowDataPacket & { id: string; legal_entity_id: string; tax_code: string; display_name: string; rate: string; calculation_mode: string; effective_from: Date | string; effective_until: Date | string | null })[]>(
      `SELECT id,legal_entity_id,tax_code,display_name,rate,calculation_mode,effective_from,effective_until
       FROM tax_rules WHERE legal_entity_id IN (${placeholders}) AND is_active=TRUE AND approved_at IS NOT NULL
       ORDER BY legal_entity_id,tax_code,effective_from DESC`, scope,
    );
    return jsonNoStore({ data: {
      legalEntities: entities.map(e => ({ id: e.id, name: e.display_name, currency: e.currency, taxSetupStatus: e.tax_setup_status })),
      customers: customers.map(c => ({ id: c.id, name: c.name, customerCode: c.customer_code, email: c.email, paymentTermsDays: c.payment_terms_days === null ? null : Number(c.payment_terms_days) })),
      catalogItems: catalogItems.map(i => ({ id: i.id, itemCode: i.item_code, itemType: i.item_type, name: i.name,
        description: i.customer_description, unitCode: i.unit_code, defaultUnitPrice: String(i.default_unit_price), currency: i.currency, defaultTaxCode: i.default_tax_code })),
      taxRules: taxRules.map(t => ({ id: t.id, legalEntityId: t.legal_entity_id, taxCode: t.tax_code, displayName: t.display_name,
        ratePercent: String(t.rate), calculationMode: t.calculation_mode, effectiveFrom: t.effective_from, effectiveUntil: t.effective_until })),
    } });
  } catch (error) { return apiError(error); }
}
