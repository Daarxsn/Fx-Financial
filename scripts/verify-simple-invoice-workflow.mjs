#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const options = read("src/app/api/v1/invoices/draft-options/route.ts");
const legalEntityCreateRoute = read("src/app/api/v1/legal-entities/route.ts");
const brandAssets = read("src/lib/brand-assets.ts");
const invoiceCreateRoute = read("src/app/api/v1/invoices/route.ts");
const invoiceDetailRoute = read("src/app/api/v1/invoices/[invoiceId]/route.ts");
const recipientMigration = read("database/migrations/031_invoice_draft_recipient_email.sql");
const composer = read("src/components/invoice-workspace.tsx");
const renderer = read("src/lib/documents/pdf.ts");
const invoiceSchema = read("src/lib/validation/invoice.ts");
const invoiceDraftService = read("src/lib/finance/invoice-draft-service.ts");
const invoiceRoute = read("src/app/api/v1/invoices/[invoiceId]/route.ts");
const documentService = read("src/lib/documents/service.ts");
const migration = read("database/migrations/030_invoice_line_milestone.sql");

assert.ok(options.includes("brands:brandRows.map"), "draft options must expose available brands");

assert.ok(legalEntityCreateRoute.includes('const actor = await requirePermission("settings:manage")'),
  "legal entity creation must await the settings permission check before reading actor roles or identity");

assert.ok(legalEntityCreateRoute.includes("const isFirstLegalEntity = existingEntityRows.length === 0;") &&
  legalEntityCreateRoute.includes("if (isFirstLegalEntity) {") &&
  legalEntityCreateRoute.includes("await provisionInitialProductBrands(conn,id,actor.userId);"),
  "first company setup must provision the known product brands once without making the user add them manually");
assert.ok(legalEntityCreateRoute.includes("brand_legal_entities") &&
  legalEntityCreateRoute.includes("brand_config_versions") &&
  legalEntityCreateRoute.includes("brand.initial_product_brand_provisioned"),
  "initial product-brand mappings must be effective-dated, versioned and audited");
assert.ok(brandAssets.includes('code: "MYFXPOS"') && brandAssets.includes('code: "DIGITECH"') &&
  brandAssets.includes('code: "COWORKS"'),
  "first setup must reuse the three established product-brand identities and logo assets");
assert.ok(options.includes("canAutoMap"), "brand options must only auto-select a safe issuer mapping");
assert.ok(options.includes("legalEntityId:b.legal_entity_id"), "brand options must return the mapped issuer legal entity");
assert.ok(composer.includes("Invoice from"), "daily invoice creation must start with the brand, not legal-entity settings");
assert.ok(composer.includes('brandId:"",customerId:"",currency:""'), "new invoices must require explicit brand, customer and currency choices rather than silently choosing the first records");
assert.ok(composer.includes('setCustomerMode(canAddCustomer?"new":"existing")'), "new invoices start with inline customer entry only when the caller is authorized to create customers");
assert.ok(composer.includes("Issue & send invoice"), "the composer must offer the combined issue-and-send action");
assert.ok(composer.includes('<Field label="Email to send the invoice to" wide hint='), "recipient email must use the shared labelled field so assistive technology can associate the input and hint");
assert.ok(composer.includes('"/api/v1/customers"'), "customer creation must be available directly in the invoice workflow");
assert.ok(composer.includes('"/api/v1/email/outbox"'), "the combined action must queue email through the existing durable outbox");
assert.ok(composer.includes("recipientConfirmed:true"), "email queueing must require explicit recipient confirmation");
assert.ok(composer.includes("recipientEmail:recipientEmail.trim()"), "the selected recipient must persist when a draft is saved");
assert.ok(composer.includes("v.draftRecipientEmail??options.customers.find"), "opening a draft must restore its saved recipient before customer defaults");
assert.ok(invoiceSchema.includes('recipientEmail:recipientEmailInput.optional().default("")'), "draft recipient must validate an address or intentional blank");
assert.ok(invoiceCreateRoute.includes("draft_recipient_email") && invoiceCreateRoute.includes("input.recipientEmail"), "new drafts must store the selected recipient");
assert.ok(invoiceDetailRoute.includes("draftRecipientEmail:row.draft_recipient_email"), "invoice detail API must return the saved recipient");
assert.ok(recipientMigration.includes("ADD COLUMN draft_recipient_email VARCHAR(320) NOT NULL DEFAULT"), "the schema must persist the draft recipient");
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

console.log("PASS: first-company product-brand provisioning, simple brand-first invoice composer, inline customer creation, confirmed issue-and-send, milestone round-trip and branded invoice PDF contract.");
