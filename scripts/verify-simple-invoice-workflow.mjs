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
const invoicePage = read("src/app/(workspace)/invoices/page.tsx");
const workspaceHome = read("src/app/(workspace)/page.tsx");
const settings = read("src/app/(workspace)/settings/page.tsx");
const renderer = read("src/lib/documents/pdf.ts");
const invoiceSchema = read("src/lib/validation/invoice.ts");
const invoiceDraftService = read("src/lib/finance/invoice-draft-service.ts");
const invoiceRoute = read("src/app/api/v1/invoices/[invoiceId]/route.ts");
const documentService = read("src/lib/documents/service.ts");
const migration = read("database/migrations/030_invoice_line_milestone.sql");
const proformaMigration = read("database/migrations/032_proforma_invoice_document_fields.sql");
const previewRoute = read("src/app/api/v1/invoices/[invoiceId]/preview/route.ts");
const draftPreviewService = read("src/lib/documents/draft-preview.ts");
const configurationService = read("src/lib/configuration/service.ts");
const signatureRoute = read("src/app/api/v1/legal-entities/[entityId]/signature/route.ts");
const signatureUpload = read("src/components/signature-upload.tsx");

assert.ok(options.includes("brands:brandRows.map"), "draft options must expose available brands");

assert.ok(legalEntityCreateRoute.includes('const actor = await requirePermission("settings:manage")'),
  "legal entity creation must await the settings permission check before reading actor roles or identity");

assert.ok(legalEntityCreateRoute.includes("isFalchionXeniaaSupplierName(input.legalName)") &&
  legalEntityCreateRoute.includes("isFalchionXeniaaSupplierName(input.displayName)") &&
  legalEntityCreateRoute.includes("existingProductBrands.length === 0") &&
  legalEntityCreateRoute.includes("await provisionInitialProductBrands(conn,id,actor.userId);"),
  "initial product-brand setup must only bootstrap against the canonical Falchion Xeniaa supplier and must not create duplicates");
assert.ok(legalEntityCreateRoute.includes("brand_legal_entities") &&
  legalEntityCreateRoute.includes("brand_config_versions") &&
  legalEntityCreateRoute.includes("brand.initial_product_brand_provisioned"),
  "initial product-brand mappings must be effective-dated, versioned and audited");
const reconciliationRoute = read("src/app/api/v1/legal-entities/reconcile-product-brands/route.ts");
assert.ok(reconciliationRoute.includes("CANONICAL_SUPPLIER_NOT_FOUND") &&
  reconciliationRoute.includes("CANONICAL_SUPPLIER_AMBIGUOUS"),
  "product-brand reconciliation must refuse missing and ambiguous supplier identities");
assert.ok(reconciliationRoute.includes("brand.product_entity_reconciled") &&
  reconciliationRoute.includes("preservedLegacyEntities"),
  "product-brand reconciliation must audit mapping changes and report preserved legacy entities");
assert.ok(brandAssets.includes('code: "MYFXPOS"') && brandAssets.includes('code: "DIGITECH"') &&
  brandAssets.includes('code: "COWORKS"'),
  "first setup must reuse the three established product-brand identities and logo assets");
assert.ok(options.includes("canAutoMap"), "brand options must only auto-select a safe issuer mapping");
assert.ok(options.includes("legalEntityId:b.legal_entity_id"), "brand options must return the mapped issuer legal entity");
assert.ok(options.includes("issuerIdentityReady") && options.includes("isProductBrandLegalEntityName(b.entity_legal_name)") &&
  options.includes("!isProductBrandLegalEntityName(b.entity_name)"),
  "invoice composer options must refuse product-brand names as legal issuers rather than auto-selecting them");
assert.ok(configurationService.includes("isProductBrandLegalEntityName(entity.legal_name)") &&
  configurationService.includes("A product brand cannot be used as the legal supplier"),
  "server-side immutable configuration capture must block issuing a document from a product-brand legal entity");
assert.ok(invoicePage.includes("InvoiceWorkspace"), "the /invoices route must render the invoice workspace instead of leaving the implemented composer unreachable");
assert.ok(workspaceHome.includes('href="/invoices">+ Create new invoice</Link>'), "the workspace home must expose a direct create-invoice action");
assert.ok(composer.includes("{canCreate?<Button disabled={optionsLoading} onClick={startNew}>+ New invoice</Button>:null}"), "invoice creation must remain visible when setup is incomplete and explain blockers instead of silently hiding the action");
assert.ok(composer.includes("Preview invoice") && composer.includes("Save draft & preview") && composer.includes("invoice-pdf-preview-frame") && composer.includes('"/preview?version="') && !composer.includes("window.print()"), "screen preview and open/download action must use the same server-rendered PDF instead of printing browser chrome");
assert.ok(composer.includes("const openInvoicePreview=async(id:string)=>{if(await openInvoice(id))setShowPreview(true);}") && composer.includes("onClick={()=>void openInvoicePreview(row.id)}>Preview</Button>"), "invoice rows must expose a direct preview action that opens the selected saved record");
assert.ok(composer.includes('setEditor(false);await refresh();await openInvoice(id,true);return true;'), "saving a draft must return to invoice details so preview and next actions are reachable");
assert.ok(composer.includes('setLines(linesFrom(v.lines));setDirty(false);setShowPreview(false);setEditor(false);'), "opening invoice details must not force drafts straight back into edit mode");
assert.ok(composer.includes("Invoice from"), "daily invoice creation must start with the brand, not legal-entity settings");
assert.ok(composer.includes('brandId:"",customerId:"",currency:""'), "new invoices must require explicit brand, customer and currency choices rather than silently choosing the first records");
assert.ok(composer.includes('setCustomerMode(canAddCustomer?"new":"existing")'), "new invoices start with inline customer entry only when the caller is authorized to create customers");
assert.ok(settings.includes('label="Supplier name shown on invoices"') &&
  settings.includes("not a product brand. Choose MyFX POS, FX Digitech or FX Coworks separately"),
  "first-time setup must distinguish the legal supplier identity from the three invoice brands");
assert.ok(composer.includes("Issue & send invoice"), "the composer must offer the combined issue-and-send action");
assert.ok(composer.includes('<Field label="Email to send the invoice to" wide hint='), "recipient email must use the shared labelled field so assistive technology can associate the input and hint");
assert.ok(composer.includes('name="invoice-recipient-email"') && composer.includes('autoComplete="off"') &&
  !composer.includes('autoComplete="email"'),
  "invoice recipient must not trigger browser profile email autofill before the customer or recipient is explicitly chosen");
assert.ok(composer.includes("selectedBrandReadyForIssuance") && composer.includes("issuerIdentityReady"),
  "issue controls must remain disabled until the selected brand resolves to an approved legal supplier and tax setup");
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
assert.ok(renderer.includes('const stripeWidth = width / 3;') &&
  renderer.includes('fillColor("#F2C354").rect(left, separatorY, stripeWidth, 4)') &&
  renderer.includes('fillColor("#F04A37").rect(left + stripeWidth, separatorY, stripeWidth, 4)') &&
  renderer.includes('fillColor("#5EA978").rect(left + stripeWidth * 2, separatorY, width - stripeWidth * 2, 4)') &&
  renderer.includes('addCell(columnXs[index], y, columnWidths[index], headerHeight, "#ECECEC")'),
  "PDFs must use the supplied three-colour separator and neutral table header from the reference invoice designs");

assert.ok(composer.includes('id="invoice-valid-until"') && composer.includes('Expires on') && composer.includes('readOnly aria-readonly="true"'), "invoice date must be automatic/read-only and expiry must be user-selected");
assert.ok(composer.includes('Apply CGST') && composer.includes('Apply SGST') && composer.includes('Amount (calculated)'), "proforma editor must expose optional GST toggles and server-calculated amounts");
assert.ok(invoiceSchema.includes('taxMode: z.enum(["LINE","COMPONENTS"])') && invoiceSchema.includes('cgstEnabled: z.boolean()') && invoiceSchema.includes('sgstEnabled: z.boolean()'), "invoice draft schema must accept the two GST components and explicit calculation mode");
assert.ok(proformaMigration.includes("ADD COLUMN invoice_valid_until DATE") && proformaMigration.includes("ADD COLUMN cgst_enabled BOOLEAN") && proformaMigration.includes("ADD COLUMN sgst_enabled BOOLEAN") && proformaMigration.includes("ADD COLUMN signature_reference"), "forward-only migration must store proforma expiry, GST components and signature reference");
assert.ok(previewRoute.includes('"Content-Type":"application/pdf"') && previewRoute.includes("renderDraftInvoicePreviewPdf") && previewRoute.includes("generateDocumentPdf"), "preview API must render draft PDFs and reuse the verified issued-PDF workflow");
assert.ok(draftPreviewService.includes("FROM invoice_lines") && draftPreviewService.includes("legal_entity_config_versions") && draftPreviewService.includes("brand_config_versions"), "draft PDF must use saved invoice lines and configured supplier/brand snapshots rather than browser placeholder data");
assert.ok(renderer.includes("getPrivateAsset") && renderer.includes('CGST (') && renderer.includes('SGST ('), "the same PDF renderer must include private signature assets and separate enabled GST components");
assert.ok(signatureRoute.includes("requirePermissionForEntity") && signatureRoute.includes("putPrivateAsset") && signatureRoute.includes("captureLegalEntityConfigVersion") && signatureRoute.includes("recordAudit"), "signature upload must be scoped, private, versioned and audited");
assert.ok(signatureUpload.includes('"/api/v1/legal-entities/"+entityId+"/signature'), "Settings must provide a signature upload workflow");
assert.ok(!composer.includes("invoice-preview-sheet") && !composer.includes("window.print()"), "the browser HTML print layout must not be used as the client invoice PDF");

console.log("PASS: brand-first invoice flow, same-renderer client PDF preview, expiry, invoice-level CGST/SGST, private signature upload and audit/version contract.");
