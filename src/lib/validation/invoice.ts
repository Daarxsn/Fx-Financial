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
const recipientEmailInput = z.string().trim().max(320).refine(
  value => value === "" || z.string().email().safeParse(value).success,
  "Enter a valid recipient email or leave it blank.",
);
const taxRateInput = z.string().regex(/^(0|[1-9][0-9]{0,2})([.][0-9]{1,6})?$/, "Enter a tax rate from 0 to 100 with up to six decimal places.")
  .refine(value => Number(value) <= 100, "Tax rate cannot exceed 100 percent.");
const invoiceDraftFieldsSchema = z.object({
  legalEntityId: z.string().uuid(),brandId: z.string().uuid().nullable().optional(),customerId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),invoiceDate: invoiceCalendarDateSchema.nullable().optional(),
  dueDate: invoiceCalendarDateSchema.nullable().optional(),validUntil: invoiceCalendarDateSchema.nullable().optional(),paymentTermsDays: z.number().int().min(0).max(3650).optional(),
  taxMode: z.enum(["LINE","COMPONENTS"]).optional().default("LINE"),
  cgstEnabled: z.boolean().optional().default(false),cgstRate: taxRateInput.optional().default("9.000000"),
  sgstEnabled: z.boolean().optional().default(false),sgstRate: taxRateInput.optional().default("9.000000"),
  notes: z.string().max(5000).nullable().optional(),recipientEmail:recipientEmailInput.optional().default(""),lines: z.array(invoiceLineInputSchema).min(1).max(500),
}).strict().superRefine((value,ctx)=>{
  if(value.validUntil&&value.invoiceDate&&value.validUntil<value.invoiceDate)ctx.addIssue({code:"custom",path:["validUntil"],message:"Expiry date cannot be earlier than the invoice date."});
});
export const invoiceDraftCreateSchema = invoiceDraftFieldsSchema;
export const invoiceDraftUpdateSchema = invoiceDraftFieldsSchema.partial().extend({expectedVersion:z.number().int().min(1)}).strict().refine((value)=>Object.keys(value).some(key=>key!=="expectedVersion"),"At least one invoice field is required.");
