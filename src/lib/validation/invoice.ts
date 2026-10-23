import { z } from "zod";
export const invoiceCalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a real calendar date in YYYY-MM-DD format.");
const moneyInput = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/, "Enter a non-negative decimal with up to four fractional digits.");
const quantityInput = z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,14})(\.\d{1,4})?$/, "Quantity must be greater than zero with up to four fractional digits.");
export const invoiceLineInputSchema = z.object({
  catalogItemId: z.string().uuid().nullable().optional(),
  lineKind: z.enum(["ITEM", "CHARGE"]).optional().default("ITEM"),
  milestone: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(1).max(1000),
  unitCode: z.string().trim().min(1).max(40),
  quantity: quantityInput, unitPrice: moneyInput,
  discountType: z.enum(["AMOUNT", "PERCENT"]).optional().default("AMOUNT"),
  discountValue: moneyInput.optional().default("0"),
  taxCode: z.string().trim().max(80).nullable().optional(),
}).strict();
const invoiceDraftFieldsSchema = z.object({
  legalEntityId: z.string().uuid(),brandId: z.string().uuid().nullable().optional(),customerId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),invoiceDate: invoiceCalendarDateSchema.nullable().optional(),
  dueDate: invoiceCalendarDateSchema.nullable().optional(),paymentTermsDays: z.number().int().min(0).max(3650).optional(),
  notes: z.string().max(5000).nullable().optional(),lines: z.array(invoiceLineInputSchema).min(1).max(500),
}).strict();
export const invoiceDraftCreateSchema = invoiceDraftFieldsSchema;
export const invoiceDraftUpdateSchema = invoiceDraftFieldsSchema.partial().extend({expectedVersion:z.number().int().min(1)}).strict().refine((value)=>Object.keys(value).some(key=>key!=="expectedVersion"),"At least one invoice field is required.");
