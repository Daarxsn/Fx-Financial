import "server-only";

import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { renderDocumentPdf, type PdfSnapshot } from "@/lib/documents/pdf";
import { isProductBrandLegalEntityName } from "@/lib/brand-assets";

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { value = JSON.parse(value) as unknown; } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function dateText(value: Date | string | null): string | null {
  if (value === null || value === "") return null;
  return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
}
function money(value: unknown): string { return String(value ?? "0.0000"); }

type PreviewRow = RowDataPacket & {
  id:string; legal_entity_id:string; brand_id:string|null; customer_id:string; lifecycle_status:string;
  invoice_number:string|null; currency:string; subtotal:string; discount_total:string; tax_total:string; grand_total:string;
  invoice_date:Date|string|null; due_date:Date|string|null; invoice_valid_until:Date|string|null;
  tax_mode:"LINE"|"COMPONENTS"; cgst_enabled:number; cgst_rate:string|null; cgst_amount:string;
  sgst_enabled:number; sgst_rate:string|null; sgst_amount:string; notes:string|null; draft_recipient_email:string|null;
  payment_terms_days:number; customer_name:string; customer_email:string|null; customer_phone:string|null;
  customer_billing_address:unknown; customer_tax_identifier:string|null;
  legal_name:string; display_name:string; registration_number:string|null; tax_identifier:string|null;
  address_json:unknown; billing_address_json:unknown; country_code:string|null; invoice_email:string|null;
  invoice_phone:string|null; website:string|null; currency_entity:string; locale:string|null; time_zone:string|null;
  logo_reference:string|null; signature_reference:string|null; bank_details_json:unknown; invoice_terms:string|null; invoice_footer:string|null;
  tax_setup_status:string;
};
type LineRow = RowDataPacket & {
  line_number:number; line_kind:string; milestone:string|null; description:string; unit_code:string;
  quantity:string; unit_price:string; discount_type:string; discount_value:string; discount_amount:string;
  tax_rate:string; tax_code:string|null; tax_calculation_mode:string; tax_amount:string; line_total:string;
};

export async function renderDraftInvoicePreviewPdf(invoiceId:string):Promise<Buffer> {
  const [rows] = await pool.execute<PreviewRow[]>(
    `SELECT i.id,i.legal_entity_id,i.brand_id,i.customer_id,i.lifecycle_status,i.invoice_number,i.currency,
            i.subtotal,i.discount_total,i.tax_total,i.grand_total,i.invoice_date,i.due_date,i.invoice_valid_until,
            i.tax_mode,i.cgst_enabled,i.cgst_rate,i.cgst_amount,i.sgst_enabled,i.sgst_rate,i.sgst_amount,
            i.notes,i.draft_recipient_email,i.payment_terms_days,
            c.name AS customer_name,c.email AS customer_email,c.phone AS customer_phone,
            c.billing_address_json AS customer_billing_address,c.tax_identifier AS customer_tax_identifier,
            e.legal_name,e.display_name,e.registration_number,e.tax_identifier,e.address_json,e.billing_address_json,
            e.country_code,e.invoice_email,e.invoice_phone,e.website,e.currency AS currency_entity,e.locale,e.time_zone,
            e.logo_reference,e.signature_reference,e.bank_details_json,e.invoice_terms,e.invoice_footer,e.tax_setup_status
       FROM invoices i JOIN customers c ON c.id=i.customer_id
       JOIN legal_entities e ON e.id=i.legal_entity_id
      WHERE i.id=? LIMIT 1`, [invoiceId],
  );
  const row=rows[0];
  if(!row) throw new Error("Invoice draft was not found.");
  if(row.lifecycle_status!=="DRAFT") throw new Error("Only draft invoices are rendered by the draft-preview renderer.");
  if(!row.brand_id) throw new Error("Choose one of the configured product brands before previewing the invoice.");

  const [lineRows]=await pool.execute<LineRow[]>(
    "SELECT line_number,line_kind,milestone,description,unit_code,quantity,unit_price,discount_type,discount_value,discount_amount,tax_rate,tax_code,tax_calculation_mode,tax_amount,line_total FROM invoice_lines WHERE invoice_id=? ORDER BY line_number",
    [invoiceId],
  );
  if(!lineRows.length) throw new Error("Add at least one described invoice line before previewing.");
  const invoiceDate=dateText(row.invoice_date);
  const [entityVersionRows]=await pool.execute<(RowDataPacket & {config_snapshot:unknown})[]>(
    "SELECT config_snapshot FROM legal_entity_config_versions WHERE legal_entity_id=? AND effective_from<=NOW(3) ORDER BY version_number DESC LIMIT 1",
    [row.legal_entity_id],
  );
  const entityVersion=object(entityVersionRows[0]?.config_snapshot);
  const entityConfig={
    ...entityVersion,
    legalEntityId:row.legal_entity_id,
    legalName:entityVersion.legalName??row.legal_name,
    displayName:entityVersion.displayName??row.display_name,
    registrationNumber:entityVersion.registrationNumber??row.registration_number,
    taxIdentifier:entityVersion.taxIdentifier??row.tax_identifier,
    taxSetupStatus:entityVersion.taxSetupStatus??row.tax_setup_status,
    address:entityVersion.address??object(row.address_json),
    billingAddress:entityVersion.billingAddress??(row.billing_address_json===null?null:object(row.billing_address_json)),
    countryCode:entityVersion.countryCode??row.country_code,
    currency:entityVersion.currency??row.currency_entity,
    invoiceEmail:entityVersion.invoiceEmail??row.invoice_email,
    invoicePhone:entityVersion.invoicePhone??row.invoice_phone,
    website:entityVersion.website??row.website,
    locale:entityVersion.locale??row.locale,
    timeZone:entityVersion.timeZone??row.time_zone,
    logoReference:entityVersion.logoReference??row.logo_reference,
    signatureReference:entityVersion.signatureReference??row.signature_reference,
    bankDetails:entityVersion.bankDetails??object(row.bank_details_json),
    invoiceTerms:entityVersion.invoiceTerms??row.invoice_terms,
    invoiceFooter:entityVersion.invoiceFooter??row.invoice_footer,
  };

  const [brandRows]=await pool.execute<(RowDataPacket & {id:string;name:string;code:string;logo_reference:string|null;theme_json:unknown})[]>(
    "SELECT id,name,code,logo_reference,theme_json FROM brands WHERE id=? AND is_active=TRUE LIMIT 1",
    [row.brand_id],
  );
  const brandRow=brandRows[0];
  if(!brandRow) throw new Error("The selected product brand is inactive or unavailable.");
  const [brandVersionRows]=await pool.execute<(RowDataPacket & {config_snapshot:unknown})[]>(
    "SELECT config_snapshot FROM brand_config_versions WHERE brand_id=? AND effective_from<=NOW(3) ORDER BY version_number DESC LIMIT 1",
    [row.brand_id],
  );
  const brandVersion=object(brandVersionRows[0]?.config_snapshot);
  const [brandMappingRows]=await pool.execute<RowDataPacket[]>(
    "SELECT brand_id FROM brand_legal_entities WHERE brand_id=? AND legal_entity_id=? AND effective_from<=NOW(3) AND (effective_until IS NULL OR effective_until>NOW(3)) LIMIT 1",
    [row.brand_id,row.legal_entity_id],
  );
  const brandConfig={...brandVersion,id:brandRow.id,name:brandRow.name,code:brandRow.code,logoReference:brandVersion.logoReference??brandRow.logo_reference,
    theme:brandVersion.theme??object(brandRow.theme_json)};

  let templateConfig:Record<string,unknown>={};
  const templateQuery=`SELECT id,template_key,display_name,version_number,template_config
    FROM invoice_document_templates
    WHERE legal_entity_id=? AND brand_id <=> ? AND document_type='INVOICE' AND is_active=TRUE
      AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
    ORDER BY version_number DESC`;
  const [templates]=await pool.execute<(RowDataPacket & {id:string;template_key:string;display_name:string;version_number:number;template_config:unknown})[]>(
    templateQuery,[row.legal_entity_id,row.brand_id,invoiceDate??"1900-01-01",invoiceDate??"1900-01-01"],
  );
  let selectedTemplate=templates[0];
  let templateWarning="";
  if(templates.length>1)templateWarning="More than one active brand template is effective for this date; resolve template configuration before issuing.";
  if(!selectedTemplate) {
    const [fallbacks]=await pool.execute<typeof templates>(
      `SELECT id,template_key,display_name,version_number,template_config
        FROM invoice_document_templates
        WHERE legal_entity_id=? AND brand_id IS NULL AND document_type='INVOICE' AND is_active=TRUE
          AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
        ORDER BY version_number DESC`,
      [row.legal_entity_id,invoiceDate??"1900-01-01",invoiceDate??"1900-01-01"],
    );
    selectedTemplate=fallbacks[0];
    if(fallbacks.length>1)templateWarning="More than one active supplier-wide invoice template is effective for this date; resolve template configuration before issuing.";
  }
  if(selectedTemplate)templateConfig=object(selectedTemplate.template_config);

  const [registrationRows]=await pool.execute<(RowDataPacket & {
    id:string;registration_type:string;registration_number:string;display_label:string;registration_key:string;
    jurisdiction:string;version_number:number;is_primary:number;effective_from:Date|string;effective_until:Date|string|null;approval_reference:string;
  })[]>(
    `SELECT id,registration_type,registration_number,display_label,registration_key,jurisdiction,version_number,is_primary,effective_from,effective_until,approval_reference
      FROM legal_entity_tax_registrations
      WHERE legal_entity_id=? AND is_active=TRUE AND approved_at IS NOT NULL AND approval_reference IS NOT NULL
        AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
      ORDER BY is_primary DESC,effective_from DESC,version_number DESC`,
    [row.legal_entity_id,invoiceDate??"1900-01-01",invoiceDate??"1900-01-01"],
  );

  const warnings:string[]=[];
  const supplierLegalName=String(entityConfig.legalName??entityConfig.displayName??"").trim();
  const supplierAddress=object(entityConfig.address);
  if(!supplierLegalName||!String(supplierAddress.line1??"").trim()||!String(supplierAddress.city??"").trim()||!String(supplierAddress.postalCode??"").trim()) {
    warnings.push("Supplier legal name or registered address is incomplete in company settings.");
  }
  if(isProductBrandLegalEntityName(supplierLegalName)||isProductBrandLegalEntityName(String(entityConfig.displayName??""))) {
    warnings.push("This supplier profile uses a product-brand name. Confirm the genuine registered supplier before issuing; the preview will not silently rename it.");
  }
  if(!brandMappingRows.length) {
    warnings.push("The selected product brand is not effectively mapped to this supplier. Resolve brand mappings before issuing.");
  }
  if(row.tax_setup_status==="UNCONFIGURED"||entityConfig.taxSetupStatus==="UNCONFIGURED") {
    warnings.push("Tax setup is not approved. The final invoice cannot be issued until the required tax decision and effective registrations are recorded.");
  } else if(entityConfig.taxSetupStatus==="APPROVED_CONFIGURED"&&registrationRows.length===0) {
    warnings.push("No approved, effective tax registration was found for this invoice date.");
  }
  const bank=object(entityConfig.bankDetails);
  if(!Object.values(bank).some(value=>typeof value==="string"&&value.trim().length>0)) {
    warnings.push("Bank/payment details are not configured; no bank details have been added to this draft preview.");
  }
  if(templateWarning)warnings.push(templateWarning);
  else if(!selectedTemplate)warnings.push("No active invoice template was found for this brand and date. This proforma layout is preview-only until template configuration is corrected.");
  lineRows.forEach((line,index)=>{
    if(Number(line.unit_price)===0)warnings.push("Line "+(index+1)+" has a zero unit rate. Confirm this is intentional or enter the actual rate before issuing.");
    if(!String(line.description??"").trim())warnings.push("Line "+(index+1)+" has no description.");
  });
  if(!(row.draft_recipient_email||row.customer_email||"").trim())warnings.push("No recipient email is saved. Enter and confirm the client recipient before Issue & send.");
  const customerAddress=object(row.customer_billing_address);
  if(!String(customerAddress.line1??"").trim())warnings.push("Customer billing address has not been provided.");

  const snapshot:PdfSnapshot={
    sourceType:"INVOICE",
    sourceDocumentId:row.id,
    documentNumber:"DRAFT",
    lifecycleStatus:"DRAFT",
    previewWarnings:warnings,
    documentDate:invoiceDate,
    dueDate:dateText(row.due_date),
    validUntil:dateText(row.invoice_valid_until),
    taxMode:row.tax_mode,
    cgstEnabled:Boolean(row.cgst_enabled),
    cgstRate:row.cgst_rate===null?null:String(row.cgst_rate),
    cgstAmount:money(row.cgst_amount),
    sgstEnabled:Boolean(row.sgst_enabled),
    sgstRate:row.sgst_rate===null?null:String(row.sgst_rate),
    sgstAmount:money(row.sgst_amount),
    currency:row.currency,
    subtotal:money(row.subtotal),
    discountTotal:money(row.discount_total),
    taxTotal:money(row.tax_total),
    grandTotal:money(row.grand_total),
    paidAmount:"0.0000",
    paymentStatus:"UNPAID",
    notes:row.notes,
    supplier:{
      legalName:entityConfig.legalName,displayName:entityConfig.displayName,
      registrationNumber:entityConfig.registrationNumber,taxIdentifier:entityConfig.taxIdentifier,
      address:entityConfig.address,billingAddress:entityConfig.billingAddress,countryCode:entityConfig.countryCode,
      invoicePhone:entityConfig.invoicePhone,invoiceEmail:entityConfig.invoiceEmail,website:entityConfig.website,
      bankDetails:entityConfig.bankDetails,signatureReference:entityConfig.signatureReference,
    },
    customer:{
      name:row.customer_name,email:row.draft_recipient_email||row.customer_email,phone:row.customer_phone,
      billingAddress:row.customer_billing_address===null?null:object(row.customer_billing_address),
      taxIdentifier:row.customer_tax_identifier,
    },
    configurationSnapshotId:null,
    configurationSha256:null,
    configurationSnapshot:{
      schemaVersion:1,
      legalEntity:entityConfig,
      brand:brandConfig,
      template:{id:selectedTemplate?.id??null,key:selectedTemplate?.template_key??"STANDARD",name:selectedTemplate?.display_name??"Proforma invoice",versionNumber:Number(selectedTemplate?.version_number??0),config:{documentTitle:"PROFORMA INVOICE:",...templateConfig,terms:templateConfig.terms??entityConfig.invoiceTerms??"",footer:templateConfig.footer??entityConfig.invoiceFooter??""}},
      selectedTaxRegistrations:entityConfig.taxSetupStatus==="APPROVED_CONFIGURED"?registrationRows.map(reg=>({
        id:reg.id,registrationKey:reg.registration_key,versionNumber:Number(reg.version_number),
        registrationType:reg.registration_type,jurisdiction:reg.jurisdiction,registrationNumber:reg.registration_number,
        displayLabel:reg.display_label,isPrimary:Boolean(reg.is_primary),effectiveFrom:reg.effective_from,effectiveUntil:reg.effective_until,
        approvalReference:reg.approval_reference,
      })):[],
    },
    lines:lineRows.map((line,index)=>({
      lineNumber:Number(line.line_number),lineKind:line.line_kind,milestone:line.milestone??"",
      description:line.description,unitCode:line.unit_code,quantity:String(line.quantity),unitPrice:String(line.unit_price),
      discountType:line.discount_type,discountValue:String(line.discount_value),discountAmount:String(line.discount_amount),
      taxRate:String(line.tax_rate),taxCode:line.tax_code,taxCalculationMode:line.tax_calculation_mode,
      taxAmount:String(line.tax_amount),lineTotal:String(line.line_total),
    })),
  };
  return renderDocumentPdf(snapshot,new Date());
}
