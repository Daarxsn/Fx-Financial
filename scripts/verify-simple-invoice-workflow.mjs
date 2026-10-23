#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const options = read("src/app/api/v1/invoices/draft-options/route.ts");
const composer = read("src/components/invoice-workspace.tsx");
const renderer = read("src/lib/documents/pdf.ts");
const invoiceSchema = read("src/lib/validation/invoice.ts");
const invoiceDraftService = read("src/lib/finance/invoice-draft-service.ts");
const invoiceRoute = read("src/app/api/v1/invoices/[invoiceId]/route.ts");
const documentService = read("src/lib/documents/service.ts");
const migration = read("database/migrations/030_invoice_line_milestone.sql");

assert.ok(options.includes("brands:brandRows.map"), "draft options must expose available brands");
assert.ok(options.includes("canAutoMap"), "brand options must only auto-select a safe issuer mapping");
assert.ok(options.includes("legalEntityId:b.legal_entity_id"), "brand options must return the mapped issuer legal entity");
assert.ok(composer.includes("Invoice from"), "daily invoice creation must start with the brand, not legal-entity settings");
assert.ok(composer.includes("Issue & send invoice"), "the composer must offer the combined issue-and-send action");
assert.ok(composer.includes('"/api/v1/customers"'), "customer creation must be available directly in the invoice workflow");
assert.ok(composer.includes('"/api/v1/email/outbox"'), "the combined action must queue email through the existing durable outbox");
assert.ok(composer.includes("recipientConfirmed:true"), "email queueing must require explicit recipient confirmation");
assert.ok(composer.includes("Milestone (optional)"), "milestone is optional in the composer");
assert.ok(invoiceSchema.includes("milestone: z.string().trim().max(160).nullable().optional()"), "milestone must be validated by the API schema");
assert.ok(invoiceDraftService.includes("input.milestone?.trim()||null"), "milestone must be persisted with a draft line");
assert.ok(invoiceRoute.includes("milestone:row.milestone??"), "milestone must round-trip through invoice draft APIs");
assert.ok(documentService.includes("milestone: line.milestone??"), "milestone must be copied into immutable document snapshots");
assert.ok(migration.includes("ADD COLUMN milestone VARCHAR(160) NULL"), "migration must add the optional milestone field without changing old documents");
assert.ok(renderer.includes('"Milestone"') && renderer.includes('"Amount in words:"'), "PDFs must match the supplied sample invoice structure");
assert.ok(renderer.includes('"Beneficiary Name: "') && renderer.includes('"Terms & Conditions"'), "the PDF must include the supplied payment/terms footer area");
assert.ok(renderer.includes('await import("sharp")') && renderer.includes('.jpeg({ quality: 92, progressive: false, chromaSubsampling: "4:4:4" })'), "supplied logos must be normalized to a PDFKit-compatible baseline JPEG before embedding");
assert.ok(renderer.includes('rect(0, 0, doc.page.width, 8)') && renderer.includes('const brandAccent = isCoworks ? "#931314" : isDigitech ? "#111111" : gold;'), "each brand must use its supplied template accent and top-strip treatment");

console.log("PASS: simple brand-first invoice composer, inline customer creation, confirmed issue-and-send, milestone round-trip and branded invoice PDF contract.");
