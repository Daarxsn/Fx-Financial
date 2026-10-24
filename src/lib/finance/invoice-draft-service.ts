import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SessionPrincipal } from "@/lib/auth/session";
import { requirePermissionForEntity } from "@/lib/auth/authorize";
import { ConfigurationNotReadyError } from "@/lib/configuration/errors";
import { calendarDateInTimeZone, recordAudit } from "@/lib/configuration/service";
import { calculateInvoice, defaultDueDate, assertValidDueDate, type InvoiceCalculation, type InvoiceCalculationLineInput } from "@/lib/finance/invoice-calculation";
import type { invoiceDraftCreateSchema } from "@/lib/validation/invoice";
import { z } from "zod";

export type DraftFields = z.infer<typeof invoiceDraftCreateSchema>;
export type DraftLine = DraftFields["lines"][number];
type EntityRow = RowDataPacket & { id:string; currency:string; is_active:number; tax_setup_status:string; time_zone:string|null };
type ResolvedLine = {
  id:string; input:DraftLine; taxRate:string; taxMode:"EXCLUSIVE"|"INCLUSIVE";
  taxRuleId:string|null; taxRegistrationId:string|null; calculated:InvoiceCalculation["lines"][number];
};
export class InvoiceDraftValidationError extends Error {
  constructor(message:string) { super(message); this.name="InvoiceDraftValidationError"; }
}
export function dateText(value:Date|string|null|undefined):string|null {
  if(value==null)return null;
  if(value instanceof Date)return value.toISOString().slice(0,10);
  return String(value).slice(0,10);
}
export function paymentStatus(total:string,paid:string):"UNPAID"|"PARTIALLY_PAID"|"PAID" {
  const n=(v:string)=>Number(v);
  if(n(total)>0 && n(paid)>=n(total))return "PAID";
  if(n(paid)>0)return "PARTIALLY_PAID";
  return "UNPAID";
}
export async function resolveDraftLines(
  conn:PoolConnection,
  entity:EntityRow,
  invoiceDate:string|null,
  currency:string,
  inputs:DraftLine[],
  invoiceTaxMode:"LINE"|"COMPONENTS"="LINE",
):Promise<{calculation:InvoiceCalculation; lines:ResolvedLine[]}> {
  const effectiveDate=invoiceDate ?? calendarDateInTimeZone(entity.time_zone);
  if(!effectiveDate)throw new ConfigurationNotReadyError("A valid legal-entity time zone is required to determine tax-rule effective dates.");
  const calculationInputs:InvoiceCalculationLineInput[]=[];
  const lines:ResolvedLine[]=[];
  for(let index=0;index<inputs.length;index++){
    const input=inputs[index];
    if(input.catalogItemId){
      const [catalogRows]=await conn.execute<(RowDataPacket & {is_active:number;currency:string})[]>(
        "SELECT is_active,currency FROM catalog_items WHERE id=? LIMIT 1 FOR UPDATE",[input.catalogItemId]);
      if(!catalogRows.length || !catalogRows[0].is_active)throw new ConfigurationNotReadyError("Line "+(index+1)+" references a missing or archived catalog item.");
      if(catalogRows[0].currency!==currency)throw new ConfigurationNotReadyError("Line "+(index+1)+" catalog item's currency does not match the invoice currency.");
    }
    let taxRate="0.000000";
    let taxMode:"EXCLUSIVE"|"INCLUSIVE"="EXCLUSIVE";
    let taxRuleId:string|null=null;
    let taxRegistrationId:string|null=null;
    if(invoiceTaxMode==="COMPONENTS"){
      if(input.taxCode)throw new InvoiceDraftValidationError("Invoice-level CGST/SGST cannot be combined with line-level tax codes.");
      taxRate="0.000000";taxMode="EXCLUSIVE";
    } else if(entity.tax_setup_status==="APPROVED_CONFIGURED"){
      if(!input.taxCode)throw new InvoiceDraftValidationError("Line "+(index+1)+" requires an approved tax code for this legal entity.");
      const [rules]=await conn.execute<(RowDataPacket & {id:string;rate:string|number;calculation_mode:"EXCLUSIVE"|"INCLUSIVE";jurisdiction:string})[]>(
        `SELECT id,rate,calculation_mode,jurisdiction FROM tax_rules
          WHERE legal_entity_id=? AND tax_code=? AND is_active=TRUE AND approved_at IS NOT NULL
            AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
          ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
        [entity.id,input.taxCode,effectiveDate,effectiveDate]);
      if(!rules.length)throw new ConfigurationNotReadyError("Line "+(index+1)+" tax code does not resolve to an approved, effective rule for this legal entity and invoice date.");
      const rule=rules[0];
      taxRate=String(rule.rate);taxMode=rule.calculation_mode;taxRuleId=rule.id;
      const [registrations]=await conn.execute<(RowDataPacket & {id:string})[]>(
        `SELECT id FROM legal_entity_tax_registrations
          WHERE legal_entity_id=? AND is_active=TRUE AND approved_at IS NOT NULL
            AND LOWER(jurisdiction)=LOWER(?) AND effective_from<=?
            AND (effective_until IS NULL OR effective_until>=?)
          ORDER BY is_primary DESC,effective_from DESC,version_number DESC LIMIT 1`,
        [entity.id,rule.jurisdiction,effectiveDate,effectiveDate]);
      taxRegistrationId=registrations[0]?.id??null;
    } else {
      if(input.taxCode)throw new ConfigurationNotReadyError("Tax code cannot be applied until the legal entity has an approved configured tax decision.");
      if(entity.tax_setup_status==="UNCONFIGURED"){
        // Drafts may be prepared without tax, but issuance still fails closed until approved setup exists.
        taxRate="0.000000";
      } else if(entity.tax_setup_status!=="APPROVED_NOT_APPLICABLE") {
        throw new ConfigurationNotReadyError("A recorded, approved tax decision is required before calculating invoice totals.");
      }
    }
    calculationInputs.push({
      lineKind:input.lineKind,description:input.description,quantity:input.quantity,unitPrice:input.unitPrice,
      discountType:input.discountType,discountValue:input.discountValue,taxRatePercent:taxRate,taxCalculationMode:taxMode,
    });
    lines.push({id:randomUUID(),input,taxRate,taxMode,taxRuleId,taxRegistrationId,calculated:null as never});
  }
  let calculation:InvoiceCalculation;
  try { calculation=calculateInvoice(calculationInputs); }
  catch(error){throw new InvoiceDraftValidationError(error instanceof Error?error.message:"The invoice lines could not be calculated.");}
  for(let index=0;index<lines.length;index++)lines[index].calculated=calculation.lines[index];
  return {calculation,lines};
}
export async function validateDraftContext(
  conn:PoolConnection,
  actor:SessionPrincipal,
  fields:Pick<DraftFields,"legalEntityId"|"brandId"|"customerId"|"currency"|"invoiceDate"|"dueDate"|"validUntil"|"paymentTermsDays">,
):Promise<{entity:EntityRow;paymentTermsDays:number;invoiceDate:string|null;dueDate:string|null;validUntil:string|null}> {
  if(!actor.legalEntityIds.includes(fields.legalEntityId)){
    throw new ConfigurationNotReadyError("The selected legal entity is not in your assigned invoice scope.");
  }
  await requirePermissionForEntity("invoices:draft:create",fields.legalEntityId).catch(async()=>{
    await requirePermissionForEntity("invoices:draft:update",fields.legalEntityId);
  });
  const [entities]=await conn.execute<EntityRow[]>(
    "SELECT id,currency,is_active,tax_setup_status,time_zone FROM legal_entities WHERE id=? LIMIT 1 FOR UPDATE",[fields.legalEntityId]);
  if(!entities.length||!entities[0].is_active)throw new ConfigurationNotReadyError("An active legal entity is required to create or update an invoice draft.");
  const entity=entities[0];
  if(fields.currency!==entity.currency)throw new InvoiceDraftValidationError("Invoice currency must match the legal entity currency until an approved multi-currency policy exists.");
  const [customers]=await conn.execute<(RowDataPacket & {id:string;is_active:number;payment_terms_days:number|null})[]>(
    "SELECT id,is_active,payment_terms_days FROM customers WHERE id=? LIMIT 1 FOR UPDATE",[fields.customerId]);
  if(!customers.length||!customers[0].is_active)throw new ConfigurationNotReadyError("An active customer record is required before creating or updating an invoice draft.");
  if(fields.brandId){
    const date=fields.invoiceDate??calendarDateInTimeZone(entity.time_zone);
    const [brands]=await conn.execute<(RowDataPacket & {id:string})[]>(
      `SELECT b.id FROM brands b
        JOIN brand_legal_entities m ON m.brand_id=b.id
       WHERE b.id=? AND b.is_active=TRUE AND m.legal_entity_id=?
         AND m.effective_from<=? AND (m.effective_until IS NULL OR m.effective_until>=?)
       LIMIT 1 FOR UPDATE`,
      [fields.brandId,fields.legalEntityId,date,date]);
    if(!brands.length)throw new ConfigurationNotReadyError("The selected brand is not active or is not mapped to the selected legal entity for the invoice date.");
  }
  const terms=fields.paymentTermsDays??customers[0].payment_terms_days??0;
  const invoiceDate=fields.invoiceDate??null;
  let dueDate=fields.dueDate??null;
  if(fields.dueDate==null && invoiceDate)dueDate=defaultDueDate(invoiceDate,terms);
  if(fields.validUntil&&invoiceDate&&fields.validUntil<invoiceDate)throw new InvoiceDraftValidationError("Expiry date cannot be earlier than the invoice date.");
  if(dueDate){
    if(!invoiceDate)throw new InvoiceDraftValidationError("A due date requires an invoice date.");
    try{assertValidDueDate(invoiceDate,dueDate);}catch(error){throw new InvoiceDraftValidationError(error instanceof Error?error.message:"Invoice due date is invalid.");}
  }
  return {entity,paymentTermsDays:terms,invoiceDate,dueDate,validUntil:fields.validUntil??null};
}
export async function persistDraftLines(
  conn:PoolConnection,invoiceId:string,actorId:string,lines:ResolvedLine[],
):Promise<void>{
  await conn.execute("DELETE FROM invoice_lines WHERE invoice_id=?",[invoiceId]);
  for(let index=0;index<lines.length;index++){
    const line=lines[index],calc=line.calculated,input=line.input;
    await conn.execute(
      `INSERT INTO invoice_lines
        (id,invoice_id,catalog_item_id,line_number,line_kind,milestone,description,unit_code,quantity,unit_price,
         discount_amount,discount_type,discount_value,tax_rate,tax_code,tax_rule_id,tax_registration_id,
         tax_calculation_mode,tax_amount,line_total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [line.id,invoiceId,input.catalogItemId??null,index+1,input.lineKind,input.milestone?.trim()||null,input.description.trim(),input.unitCode,
       calc.quantity,calc.unitPrice,calc.discountAmount,input.discountType,input.discountValue,line.taxRate,
       input.taxCode??null,line.taxRuleId,line.taxRegistrationId,line.taxMode,calc.taxAmount,calc.lineTotal]);
  }
}
export async function auditDraftChange(
  conn:PoolConnection,actorId:string,invoiceId:string,action:"invoice.draft.created"|"invoice.draft.updated",
  before:unknown,after:unknown,
){
  await recordAudit(conn,actorId,action,"invoice",invoiceId,action==="invoice.draft.created"?"Invoice draft created":"Invoice draft updated",before,after);
}
