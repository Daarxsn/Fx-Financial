import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SessionPrincipal } from "@/lib/auth/session";
import { requirePermissionForEntity } from "@/lib/auth/authorize";
import { calendarDateInTimeZone, recordAudit } from "@/lib/configuration/service";
import { resolveDraftLines } from "@/lib/finance/invoice-draft-service";
import type { quotationCreateSchema } from "@/lib/validation/quotation";
import { z } from "zod";

export type QuotationDraft = z.infer<typeof quotationCreateSchema>;
type EntityRow = RowDataPacket & {
  id: string; currency: string; is_active: number; tax_setup_status: string; time_zone: string | null;
};
export class QuotationValidationError extends Error {
  constructor(message: string) { super(message); this.name = "QuotationValidationError"; }
}
export function dateText(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
export async function validateQuotationContext(conn: PoolConnection, actor: SessionPrincipal, fields: QuotationDraft) {
  if (!actor.legalEntityIds.includes(fields.legalEntityId)) throw new QuotationValidationError("The selected legal entity is not in your assigned quotation scope.");
  await requirePermissionForEntity("quotations:write", fields.legalEntityId);
  const [entities] = await conn.execute<EntityRow[]>(
    "SELECT id,currency,is_active,tax_setup_status,time_zone FROM legal_entities WHERE id=? LIMIT 1 FOR UPDATE",
    [fields.legalEntityId],
  );
  if (!entities.length || !entities[0].is_active) throw new QuotationValidationError("An active legal entity is required to create or update a quotation.");
  const entity = entities[0];
  if (fields.currency !== entity.currency) throw new QuotationValidationError("Quotation currency must match the legal entity currency until an approved multi-currency policy exists.");
  const [customers] = await conn.execute<(RowDataPacket & { id: string; is_active: number; payment_terms_days: number | null })[]>(
    "SELECT id,is_active,payment_terms_days FROM customers WHERE id=? LIMIT 1 FOR UPDATE",
    [fields.customerId],
  );
  if (!customers.length || !customers[0].is_active) throw new QuotationValidationError("An active customer record is required before creating or updating a quotation.");
  const effectiveDate = fields.invoiceDate ?? calendarDateInTimeZone(entity.time_zone);
  if (!effectiveDate) throw new QuotationValidationError("A valid legal-entity time zone is required to determine quotation dates.");
  if (fields.validUntil && fields.validUntil < effectiveDate) throw new QuotationValidationError("Validity date cannot be earlier than quotation date.");
  if (fields.brandId) {
    const [brands] = await conn.execute<(RowDataPacket & { id: string })[]>(
      `SELECT b.id FROM brands b JOIN brand_legal_entities m ON m.brand_id=b.id
        WHERE b.id=? AND b.is_active=TRUE AND m.legal_entity_id=?
          AND (m.effective_from IS NULL OR m.effective_from<=?)
          AND (m.effective_until IS NULL OR m.effective_until>=?) LIMIT 1 FOR UPDATE`,
      [fields.brandId, fields.legalEntityId, effectiveDate, effectiveDate],
    );
    if (!brands.length) throw new QuotationValidationError("The selected brand is inactive or is not mapped to the selected legal entity for the quotation date.");
  }
  const paymentTermsDays = fields.paymentTermsDays ?? customers[0].payment_terms_days ?? 0;
  return { entity, effectiveDate, paymentTermsDays, issueDate: fields.invoiceDate ?? null };
}
export async function prepareQuotationLines(conn: PoolConnection, context: { entity: EntityRow; effectiveDate: string }, fields: QuotationDraft) {
  return resolveDraftLines(conn, context.entity, context.effectiveDate, fields.currency, fields.lines);
}
export async function persistQuotationLines(conn: PoolConnection, quotationId: string, lines: Awaited<ReturnType<typeof prepareQuotationLines>>["lines"]) {
  await conn.execute("DELETE FROM quotation_lines WHERE quotation_id=?", [quotationId]);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], calculated = line.calculated, input = line.input;
    await conn.execute(
      `INSERT INTO quotation_lines
        (id,quotation_id,line_number,line_kind,catalog_item_id,description,unit_code,quantity,unit_price,
         discount_amount,discount_type,discount_value,tax_code,tax_rule_id,tax_registration_id,tax_rate,
         tax_calculation_mode,tax_amount,line_total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [line.id, quotationId, index + 1, input.lineKind, input.catalogItemId ?? null, input.description.trim(), input.unitCode,
        calculated.quantity, calculated.unitPrice, calculated.discountAmount, input.discountType, input.discountValue,
        input.taxCode ?? null, line.taxRuleId, line.taxRegistrationId, line.taxRate, line.taxMode, calculated.taxAmount, calculated.lineTotal],
    );
  }
}
export async function auditQuotationChange(
  conn: PoolConnection, actorId: string, quotationId: string, action: string,
  message: string, before: unknown, after: unknown,
) {
  await recordAudit(conn, actorId, action, "quotation", quotationId, message, before, after);
}
export function normalizeStoredJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}
export function quoteSnapshotObject(value: unknown): Record<string, unknown> {
  const parsed = normalizeStoredJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
export function quotationRecordId(): string { return randomUUID(); }
