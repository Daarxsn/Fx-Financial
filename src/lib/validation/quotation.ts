import { z } from "zod";
import { invoiceCalendarDateSchema, invoiceDraftCreateSchema } from "@/lib/validation/invoice";

const quotationFieldsSchema = invoiceDraftCreateSchema.extend({
  validUntil: invoiceCalendarDateSchema.nullable().optional(),
}).strict();

function validateQuotationDates(value: { invoiceDate?: string | null; validUntil?: string | null }, ctx: z.RefinementCtx) {
  if (value.invoiceDate && value.validUntil && value.validUntil < value.invoiceDate) {
    ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Validity date cannot be earlier than quotation date." });
  }
}

export const quotationCreateSchema = quotationFieldsSchema.superRefine(validateQuotationDates);
export const quotationUpdateSchema = quotationFieldsSchema.extend({
  expectedVersion: z.number().int().min(1),
}).strict().superRefine(validateQuotationDates);

export const quotationStatusSchema = z.object({
  status: z.enum(["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
