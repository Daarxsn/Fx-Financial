import "server-only";

import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code");
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");

const addressLine = z.string().trim().max(255).optional();
// Customer addresses accept only the reviewed keys; unknown keys and oversized values are rejected.
const addressSchema = z.object({
  line1: addressLine,
  line2: addressLine,
  city: addressLine,
  state: addressLine,
  postalCode: addressLine,
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/, "Country code must be a two-letter uppercase code").optional().or(z.literal("")),
}).strict();
const emailSchema = z.string().trim().email().max(320).optional().or(z.literal(""));
const phoneSchema = z.string().trim().max(50).optional().or(z.literal(""));
const contactSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  jobTitle: z.string().trim().max(120).optional().or(z.literal("")),
  email: emailSchema,
  phone: phoneSchema,
  isPrimary: z.boolean().optional(),
}).strict();
const taxIdentifierSchema = z.object({
  identifierType: z.string().trim().min(1).max(40),
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/).optional().or(z.literal("")),
  jurisdiction: z.string().trim().max(120).optional().or(z.literal("")),
  identifierValue: z.string().trim().min(1).max(160),
}).strict();

export const customerCreateSchema = z.object({
  customerCode: z.string().trim().min(1).max(80).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(255),
  email: emailSchema,
  phone: phoneSchema,
  billingAddress: addressSchema.nullable().optional(),
  shippingAddress: addressSchema.nullable().optional(),
  purchaseOrderReference: z.string().trim().max(160).optional().or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(65535).nullable().optional(),
  taxIdentifier: z.string().trim().max(100).optional().or(z.literal("")),
  taxIdentifiers: z.array(taxIdentifierSchema).max(30).optional(),
  contacts: z.array(contactSchema).max(30).optional().refine((contacts) => !contacts || contacts.filter((contact) => contact.isPrimary).length <= 1, "Only one primary contact is allowed"),
  notes: z.string().max(5000).optional(),
}).strict();

export const customerUpdateSchema = customerCreateSchema.partial().extend({
  expectedVersion: z.number().int().min(1),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
  "At least one field is required",
);

export const archiveSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
}).strict();

export const catalogItemCreateSchema = z.object({
  itemCode: z.string().trim().min(1).max(80).optional().or(z.literal("")),
  itemType: z.enum(["PRODUCT", "SERVICE"]),
  name: z.string().trim().min(1).max(255),
  customerDescription: z.string().trim().min(1).max(1000),
  internalDescription: z.string().max(1000).optional(),
  unitCode: z.string().trim().min(1).max(40),
  defaultUnitPrice: z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/, "Price must be a non-negative decimal with up to four fractional digits"),
  currency: currencySchema,
  defaultTaxCode: z.string().trim().max(80).optional().or(z.literal("")),
}).strict();

export const catalogItemUpdateSchema = catalogItemCreateSchema.partial().extend({
  expectedVersion: z.number().int().min(1),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
  "At least one field is required",
);
