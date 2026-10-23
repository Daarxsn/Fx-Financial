import { NextRequest } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { ConfigurationConflictError } from "@/lib/configuration/errors";
import { outstandingBalance, subtractMoney } from "@/lib/finance/invoice-calculation";
import { customerNameFromSnapshot } from "@/lib/finance/document-snapshot";
import { invoiceDraftUpdateSchema } from "@/lib/validation/invoice";
import { validateDraftContext, resolveDraftLines, persistDraftLines, auditDraftChange, InvoiceDraftValidationError, dateText } from "@/lib/finance/invoice-draft-service";

export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{invoiceId:string}>};
function responseValidation(error:unknown){if(error instanceof InvoiceDraftValidationError)return jsonNoStore({error:{code:"VALIDATION_ERROR",message:error.message}},422);return apiError(error);}
function paymentStatus(total:string,paid:string):"UNPAID"|"PARTIALLY_PAID"|"PAID"{if(total!=="0.0000"&&outstandingBalance(total,paid)==="0.0000")return "PAID";if(paid!=="0.0000")return "PARTIALLY_PAID";return "UNPAID";}
function money(value:unknown){return String(value??"0.0000");}

function serializeLine(row:RowDataPacket & {id:string;catalog_item_id:string|null;line_kind:string;milestone:string|null;description:string;unit_code:string;quantity:string;unit_price:string;discount_type:string;discount_value:string;discount_amount:string;tax_rate:string;tax_code:string|null;tax_calculation_mode:string;tax_amount:string;line_total:string;tax_rule_id:string|null;tax_registration_id:string|null}){
 return {id:row.id,catalogItemId:row.catalog_item_id,lineKind:row.line_kind,milestone:row.milestone??"",description:row.description,unitCode:row.unit_code,
 quantity:String(row.quantity),unitPrice:String(row.unit_price),discountType:row.discount_type,discountValue:String(row.discount_value),
 discountAmount:String(row.discount_amount),taxRatePercent:String(row.tax_rate),taxCode:row.tax_code,taxCalculationMode:row.tax_calculation_mode,
 taxAmount:String(row.tax_amount),lineTotal:String(row.line_total),taxRuleId:row.tax_rule_id,taxRegistrationId:row.tax_registration_id};
}

export async function GET(_request:NextRequest,context:Context){
 try{
  const actor=await requirePermission("invoices:read");const {invoiceId}=await context.params;
  if(!/^[0-9a-f-]{36}$/i.test(invoiceId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"invoiceId must be a UUID."}},400);
  const [rows]=await pool.execute<(RowDataPacket & {id:string;legal_entity_id:string;brand_id:string|null;customer_id:string;document_type:string;related_invoice_id:string|null;invoice_number:string|null;lifecycle_status:string;currency:string;subtotal:string;discount_total:string;tax_total:string;grand_total:string;invoice_date:Date|string|null;due_date:Date|string|null;payment_terms_days:number;notes:string|null;draft_recipient_email:string;record_version:number;created_at:Date|string;updated_at:Date|string;customer_name:string;customer_snapshot:unknown;paid_total:string})[]>(
   `SELECT i.id,i.legal_entity_id,i.brand_id,i.customer_id,i.document_type,i.related_invoice_id,i.invoice_number,i.lifecycle_status,i.currency,
     i.subtotal,i.discount_total,i.tax_total,i.grand_total,i.invoice_date,i.due_date,i.payment_terms_days,i.notes,i.draft_recipient_email,i.customer_snapshot,i.record_version,i.created_at,i.updated_at,
     c.name AS customer_name,COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.invoice_id=i.id AND p.status='RECORDED'),0) AS paid_total
    FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=? LIMIT 1`,[invoiceId]);
  if(!rows.length||!actor.legalEntityIds.includes(rows[0].legal_entity_id))return jsonNoStore({error:{code:"NOT_FOUND",message:"Invoice not found in your assigned scope."}},404);
  const row=rows[0];
  const [lineRows]=await pool.execute<(RowDataPacket & {id:string;catalog_item_id:string|null;line_kind:string;milestone:string|null;description:string;unit_code:string;quantity:string;unit_price:string;discount_type:string;discount_value:string;discount_amount:string;tax_rate:string;tax_code:string|null;tax_calculation_mode:string;tax_amount:string;line_total:string;tax_rule_id:string|null;tax_registration_id:string|null})[]>(
   "SELECT id,catalog_item_id,line_kind,milestone,description,unit_code,quantity,unit_price,discount_type,discount_value,discount_amount,tax_rate,tax_code,tax_calculation_mode,tax_amount,line_total,tax_rule_id,tax_registration_id FROM invoice_lines WHERE invoice_id=? ORDER BY line_number",[invoiceId]);
  const total=money(row.grand_total),paid=money(row.paid_total);
  const customerName=customerNameFromSnapshot(row.customer_snapshot)??row.customer_name;
  return jsonNoStore({data:{id:row.id,legalEntityId:row.legal_entity_id,brandId:row.brand_id,customerId:row.customer_id,customerName,
   documentType:row.document_type,relatedInvoiceId:row.related_invoice_id,invoiceNumber:row.invoice_number,lifecycleStatus:row.lifecycle_status,
   paymentStatus:paymentStatus(total,paid),currency:row.currency,subtotal:money(row.subtotal),discountTotal:money(row.discount_total),
   taxableValue:subtractMoney(money(row.subtotal),money(row.discount_total)),taxTotal:money(row.tax_total),grandTotal:total,paidAmount:paid,
   outstandingBalance:outstandingBalance(total,paid),invoiceDate:dateText(row.invoice_date),dueDate:dateText(row.due_date),
   paymentTermsDays:Number(row.payment_terms_days),notes:row.notes,draftRecipientEmail:row.draft_recipient_email,recordVersion:Number(row.record_version),createdAt:row.created_at,updatedAt:row.updated_at,
   lines:lineRows.map(serializeLine)}});
 }catch(error){return apiError(error);}
}

export async function PATCH(request:NextRequest,context:Context){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);const actor=await requirePermission("invoices:draft:update");const {invoiceId}=await context.params;
  if(!/^[0-9a-f-]{36}$/i.test(invoiceId))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"invoiceId must be a UUID."}},400);
  const raw=await request.json();
  const parsed=invoiceDraftUpdateSchema.parse(raw);
  const {expectedVersion,...patch}=parsed;
  conn=await pool.getConnection();await conn.beginTransaction();
  const [rows]=await conn.execute<(RowDataPacket & {id:string;legal_entity_id:string;brand_id:string|null;customer_id:string;currency:string;invoice_date:Date|string|null;due_date:Date|string|null;payment_terms_days:number;notes:string|null;draft_recipient_email:string;record_version:number;lifecycle_status:string})[]>(
   "SELECT id,legal_entity_id,brand_id,customer_id,currency,invoice_date,due_date,payment_terms_days,notes,draft_recipient_email,record_version,lifecycle_status FROM invoices WHERE id=? LIMIT 1 FOR UPDATE",[invoiceId]);
  if(!rows.length||!actor.legalEntityIds.includes(rows[0].legal_entity_id)){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Invoice not found in your assigned scope."}},404);}
  const current=rows[0];
  if(current.lifecycle_status!=="DRAFT"){await conn.rollback();return jsonNoStore({error:{code:"IMMUTABLE_INVOICE",message:"Only draft invoices can be updated. Issued/cancelled documents are preserved for audit."}},409);}
  if(Number(current.record_version)!==expectedVersion){await conn.rollback();return jsonNoStore({error:{code:"VERSION_CONFLICT",message:"This invoice draft changed. Reload it before saving."}},409);}
  const oldLines=patch.lines===undefined ? await conn.execute<(RowDataPacket & {catalog_item_id:string|null;line_kind:"ITEM"|"CHARGE";milestone:string|null;description:string;unit_code:string;quantity:string;unit_price:string;discount_type:"AMOUNT"|"PERCENT";discount_value:string;tax_code:string|null})[]>(
   "SELECT catalog_item_id,line_kind,milestone,description,unit_code,quantity,unit_price,discount_type,discount_value,tax_code FROM invoice_lines WHERE invoice_id=? ORDER BY line_number",[invoiceId]).then(r=>r[0].map(line=>({
    catalogItemId:line.catalog_item_id,lineKind:line.line_kind,milestone:line.milestone??"",description:line.description,unitCode:line.unit_code,quantity:String(line.quantity),
    unitPrice:String(line.unit_price),discountType:line.discount_type,discountValue:String(line.discount_value),taxCode:line.tax_code,
   }))):undefined;
  const input={
   legalEntityId:patch.legalEntityId??current.legal_entity_id,brandId:patch.brandId!==undefined?patch.brandId:current.brand_id,
   customerId:patch.customerId??current.customer_id,currency:patch.currency??current.currency,
   invoiceDate:patch.invoiceDate!==undefined?patch.invoiceDate:dateText(current.invoice_date),
   dueDate:patch.dueDate!==undefined?patch.dueDate:dateText(current.due_date),
   paymentTermsDays:patch.paymentTermsDays??Number(current.payment_terms_days),
   notes:patch.notes!==undefined?patch.notes:current.notes,
   recipientEmail:patch.recipientEmail!==undefined?patch.recipientEmail:current.draft_recipient_email,
   lines:patch.lines??oldLines??[],
  };
  const ctx=await validateDraftContext(conn,actor,input);
  const prepared=await resolveDraftLines(conn,ctx.entity,ctx.invoiceDate,input.currency,input.lines);
  await persistDraftLines(conn,invoiceId,actor.userId,prepared.lines);
  const [updated]=await conn.execute<ResultSetHeader>(
   `UPDATE invoices SET legal_entity_id=?,brand_id=?,customer_id=?,currency=?,invoice_date=?,due_date=?,payment_terms_days=?,notes=?,draft_recipient_email=?,
      subtotal=?,discount_total=?,tax_total=?,grand_total=?,record_version=record_version+1,updated_at=NOW(3)
    WHERE id=? AND lifecycle_status='DRAFT' AND record_version=?`,
   [input.legalEntityId,input.brandId??null,input.customerId,input.currency,ctx.invoiceDate,ctx.dueDate,ctx.paymentTermsDays,input.notes??null,input.recipientEmail??"",
    prepared.calculation.subtotal,prepared.calculation.discountTotal,prepared.calculation.taxTotal,prepared.calculation.grandTotal,invoiceId,expectedVersion]);
  if(updated.affectedRows!==1)throw new ConfigurationConflictError("Invoice state changed while saving; reload and retry.");
  await auditDraftChange(conn,actor.userId,invoiceId,"invoice.draft.updated",
   {recordVersion:expectedVersion},{recordVersion:expectedVersion+1,changedFields:Object.keys(patch)});
  await conn.commit();
  return jsonNoStore({data:{id:invoiceId,legalEntityId:input.legalEntityId,brandId:input.brandId??null,customerId:input.customerId,currency:input.currency,
   lifecycleStatus:"DRAFT",invoiceDate:ctx.invoiceDate,dueDate:ctx.dueDate,paymentTermsDays:ctx.paymentTermsDays,notes:input.notes??null,draftRecipientEmail:input.recipientEmail??"",
   recordVersion:expectedVersion+1,...prepared.calculation,paidAmount:"0.0000",outstandingBalance:prepared.calculation.grandTotal,paymentStatus:"UNPAID"}});
 }catch(error){if(conn)await conn.rollback().catch(()=>undefined);return responseValidation(error);}finally{conn?.release();}
}
