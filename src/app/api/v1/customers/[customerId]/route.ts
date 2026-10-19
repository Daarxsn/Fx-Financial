import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { customerUpdateSchema, uuidSchema } from "@/lib/validation/master-data";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{customerId:string}>};
function jsonValue(value:unknown):unknown { if(typeof value!=="string")return value;try{return JSON.parse(value)}catch{return null} }
function normalizeIdentifier(value:string):string{return value.trim().toUpperCase().replace(/[\s-]/g,"")}
// Canonical JSON (sorted keys, empty values dropped) so stored and submitted values compare by content, not formatting.
function canonical(value:unknown):string{
 const walk=(v:unknown):unknown=>Array.isArray(v)?v.map(walk):v&&typeof v==="object"?Object.fromEntries(Object.entries(v as Record<string,unknown>).filter(([,x])=>x!==undefined&&x!==null&&x!=="").sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,walk(x)])):v;
 return JSON.stringify(walk(value)??null);
}
function addressKey(value:unknown):string{const parsed=jsonValue(value);return parsed&&typeof parsed==="object"&&Object.keys(canonicalObject(parsed)).length?canonical(parsed):"null"}
function canonicalObject(value:object):Record<string,unknown>{return JSON.parse(canonical(value)) as Record<string,unknown>}
function contactKey(c:{fullName:string;jobTitle?:string|null;email?:string|null;phone?:string|null;isPrimary?:boolean|number}){
 return canonical({fullName:c.fullName.trim(),jobTitle:c.jobTitle?.trim()||null,email:c.email?.trim().toLowerCase()||null,phone:c.phone?.trim()||null,isPrimary:Boolean(c.isPrimary)});
}
function taxKey(t:{identifierType:string;countryCode?:string|null;jurisdiction?:string|null;identifierValue:string}){
 return canonical({identifierType:t.identifierType.trim().toUpperCase(),countryCode:t.countryCode?.trim().toUpperCase()||null,jurisdiction:t.jurisdiction?.trim()||null,identifierValue:t.identifierValue.trim()});
}
function duplicateEntry(error:unknown):boolean{return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY"}

export async function GET(_request:NextRequest,context:Context){
 try{
  const actor=await requirePermission("customers:read");
  const {customerId}=await context.params;const id=uuidSchema.parse(customerId);
  const [rows]=await pool.execute<(RowDataPacket & {
   id:string;customer_code:string|null;name:string;email:string|null;phone:string|null;
   billing_address_json:unknown;shipping_address_json:unknown;purchase_order_reference:string|null;
   payment_terms_days:number|null;tax_identifier:string|null;notes:string|null;is_active:number;record_version:number;
   archived_at:Date|null;archive_reason:string|null;created_at:Date;updated_at:Date;
  })[]>(
   `SELECT id,customer_code,name,email,phone,billing_address_json,shipping_address_json,purchase_order_reference,
           payment_terms_days,tax_identifier,notes,is_active,record_version,archived_at,archive_reason,created_at,updated_at
    FROM customers WHERE id=? LIMIT 1`,[id]);
  if(!rows.length)return jsonNoStore({error:{code:"NOT_FOUND",message:"Customer not found"}},404);
  const [contacts]=await pool.execute<(RowDataPacket & {id:string;full_name:string;job_title:string|null;email:string|null;phone:string|null;is_primary:number})[]>(
   "SELECT id,full_name,job_title,email,phone,is_primary FROM customer_contacts WHERE customer_id=? ORDER BY is_primary DESC,full_name,id",[id]);
  const [taxIdentifiers]=await pool.execute<(RowDataPacket & {id:string;identifier_type:string;country_code:string|null;jurisdiction:string|null;identifier_value:string})[]>(
   "SELECT id,identifier_type,country_code,jurisdiction,identifier_value FROM customer_tax_identifiers WHERE customer_id=? ORDER BY identifier_type,country_code,id",[id]);
  const row=rows[0];
  const visibleEntityIds = actor.legalEntityIds;
  const canReadInvoices = actor.permissions.includes("invoices:read") && visibleEntityIds.length > 0;
  const canReadQuotations = actor.permissions.includes("quotations:read") && visibleEntityIds.length > 0;
  let invoiceReferenceCount: number | null = null;
  let quotationReferenceCount: number | null = null;
  const paymentReferenceCount: number | null = null;
  let linkedInvoices: Array<{id:string;invoiceNumber:string|null;status:string;invoiceDate:string|null;dueDate:string|null;currency:string;grandTotal:string;createdAt:string}> | undefined;
  let linkedQuotations: Array<{id:string;quotationNumber:string|null;status:string;issueDate:string|null;validUntil:string|null;currency:string;grandTotal:string;createdAt:string}> | undefined;
  if (canReadInvoices) {
    const scopePlaceholders = visibleEntityIds.map(() => "?").join(",");
    const [countRows] = await pool.query<(RowDataPacket & {total:number})[]>(
      `SELECT COUNT(*) AS total FROM invoices WHERE customer_id=? AND legal_entity_id IN (${scopePlaceholders})`, [id, ...visibleEntityIds]);
    invoiceReferenceCount = Number(countRows[0]?.total ?? 0);
    const [invoiceRows] = await pool.query<(RowDataPacket & {
      id:string;invoice_number:string|null;lifecycle_status:string;invoice_date:Date|string|null;due_date:Date|string|null;
      currency:string;grand_total:string;created_at:Date|string;
    })[]>(
      `SELECT id,invoice_number,lifecycle_status,invoice_date,due_date,currency,grand_total,created_at
       FROM invoices WHERE customer_id=? AND legal_entity_id IN (${scopePlaceholders}) ORDER BY created_at DESC,id DESC LIMIT 10`,
      [id, ...visibleEntityIds]);
    const asDate = (value:Date|string|null) => value===null ? null : value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
    const asTimestamp = (value:Date|string) => value instanceof Date ? value.toISOString() : String(value);
    linkedInvoices = invoiceRows.map(item=>({
      id:item.id,invoiceNumber:item.invoice_number,status:item.lifecycle_status,invoiceDate:asDate(item.invoice_date),
      dueDate:asDate(item.due_date),currency:item.currency,grandTotal:String(item.grand_total),createdAt:asTimestamp(item.created_at),
    }));
  }
  if (canReadQuotations) {
    const scopePlaceholders = visibleEntityIds.map(() => "?").join(",");
    const [countRows] = await pool.query<(RowDataPacket & {total:number})[]>(
      `SELECT COUNT(*) AS total FROM quotations WHERE customer_id=? AND legal_entity_id IN (${scopePlaceholders})`, [id, ...visibleEntityIds]);
    quotationReferenceCount = Number(countRows[0]?.total ?? 0);
    const [quotationRows] = await pool.query<(RowDataPacket & {
      id:string;quotation_number:string|null;status:string;issue_date:Date|string|null;valid_until:Date|string|null;
      currency:string;grand_total:string;created_at:Date|string;
    })[]>(
      `SELECT id,quotation_number,status,issue_date,valid_until,currency,grand_total,created_at
       FROM quotations WHERE customer_id=? AND legal_entity_id IN (${scopePlaceholders}) ORDER BY created_at DESC,id DESC LIMIT 10`,
      [id, ...visibleEntityIds]);
    const asDate = (value:Date|string|null) => value===null ? null : value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
    const asTimestamp = (value:Date|string) => value instanceof Date ? value.toISOString() : String(value);
    linkedQuotations = quotationRows.map(item=>({
      id:item.id,quotationNumber:item.quotation_number,status:item.status,issueDate:asDate(item.issue_date),
      validUntil:asDate(item.valid_until),currency:item.currency,grandTotal:String(item.grand_total),createdAt:asTimestamp(item.created_at),
    }));
  }
  // Payment counts remain hidden until every payment can be reliably entity-scoped.
  return jsonNoStore({data:{
   id:row.id,customerCode:row.customer_code,name:row.name,email:row.email,phone:row.phone,
   billingAddress:jsonValue(row.billing_address_json),shippingAddress:jsonValue(row.shipping_address_json),
   purchaseOrderReference:row.purchase_order_reference,paymentTermsDays:row.payment_terms_days===null?null:Number(row.payment_terms_days),
   ...(actor.permissions.includes("settings:manage")?{taxIdentifier:row.tax_identifier,
     taxIdentifiers:taxIdentifiers.map(t=>({id:t.id,identifierType:t.identifier_type,countryCode:t.country_code,jurisdiction:t.jurisdiction,identifierValue:t.identifier_value}))}:{}),
   contacts:contacts.map(c=>({id:c.id,fullName:c.full_name,jobTitle:c.job_title,email:c.email,phone:c.phone,isPrimary:Boolean(c.is_primary)})),
   ...(actor.permissions.includes("settings:manage")?{notes:row.notes}:{}),
   isActive:Boolean(row.is_active),recordVersion:Number(row.record_version),archivedAt:row.archived_at,archiveReason:row.archive_reason,
   createdAt:row.created_at,updatedAt:row.updated_at,
   referenceCounts:{invoices:invoiceReferenceCount,quotations:quotationReferenceCount,payments:paymentReferenceCount},
   ...(linkedInvoices!==undefined?{linkedInvoices}:{}),
   ...(linkedQuotations!==undefined?{linkedQuotations}:{}),
  }});
 }catch(error){return apiError(error)}
}

export async function PATCH(request:NextRequest,context:Context){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);
  const actor=await requirePermission("customers:update");
  const {customerId}=await context.params;const id=uuidSchema.parse(customerId);
  const input=customerUpdateSchema.parse(await request.json());
  const {expectedVersion,contacts,taxIdentifiers,...patch}=input;
  if (!actor.permissions.includes("settings:manage") && (patch.taxIdentifier !== undefined || taxIdentifiers !== undefined || patch.notes !== undefined)) {
   return jsonNoStore({error:{code:"FORBIDDEN",message:"Customer tax identifiers and internal notes are restricted to finance/settings administrators."}},403);
  }
  conn=await pool.getConnection();await conn.beginTransaction();
  const [rows]=await conn.execute<(RowDataPacket & {
   id:string;customer_code:string|null;name:string;email:string|null;phone:string|null;tax_identifier:string|null;
   is_active:number;record_version:number;notes:string|null;billing_address_json:unknown;shipping_address_json:unknown;
   purchase_order_reference:string|null;payment_terms_days:number|null;
  })[]>(`SELECT id,customer_code,name,email,phone,tax_identifier,is_active,record_version,notes,billing_address_json,shipping_address_json,
     purchase_order_reference,payment_terms_days FROM customers WHERE id=? FOR UPDATE`,[id]);
  if(!rows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Customer not found"}},404)}
  const row=rows[0];
  if(Number(row.record_version)!==expectedVersion){await conn.rollback();return jsonNoStore({error:{code:"VERSION_CONFLICT",message:"This customer changed since you opened it. Reload the record and review the latest values."}},409)}
  if(!row.is_active){await conn.rollback();return jsonNoStore({error:{code:"ARCHIVED_RECORD",message:"Archived customers cannot be edited."}},409)}
  const next={customerCode:patch.customerCode!==undefined?(patch.customerCode.trim()||null):row.customer_code,
   name:patch.name??row.name,email:patch.email!==undefined?(patch.email.trim().toLowerCase()||null):row.email,
   phone:patch.phone!==undefined?(patch.phone.trim()||null):row.phone,
   taxIdentifier:patch.taxIdentifier!==undefined?(patch.taxIdentifier.trim()||null):row.tax_identifier};
  const duplicates:unknown[]=[];
  const duplicateConditions:string[]=[];const duplicateParams:unknown[]=[];
  if(next.name){duplicateConditions.push("LOWER(name)=LOWER(?)");duplicateParams.push(next.name)}
  if(next.email){duplicateConditions.push("LOWER(email)=LOWER(?)");duplicateParams.push(next.email)}
  if(next.phone){duplicateConditions.push("phone=?");duplicateParams.push(next.phone)}
  if(next.taxIdentifier){duplicateConditions.push("UPPER(REPLACE(REPLACE(tax_identifier,' ',''),'-',''))=?");duplicateParams.push(normalizeIdentifier(next.taxIdentifier))}
  const childTaxKeys=(taxIdentifiers??[]).map(t=>normalizeIdentifier(t.identifierValue)).filter(Boolean);
  if(childTaxKeys.length){duplicateConditions.push(`EXISTS (SELECT 1 FROM customer_tax_identifiers ti WHERE ti.customer_id=customers.id AND ti.normalized_identifier IN (${childTaxKeys.map(()=>"?").join(",")}))`);duplicateParams.push(...childTaxKeys)}
  if(next.customerCode){duplicateConditions.push("LOWER(customer_code)=LOWER(?)");duplicateParams.push(next.customerCode)}
  if(duplicateConditions.length){
   const [matches]=await conn.query<(RowDataPacket & {id:string;name:string;customer_code:string|null;email:string|null;phone:string|null;tax_identifier:string|null;child_tax_identifier_match:number})[]>(
    `SELECT id,name,customer_code,email,phone,tax_identifier,${childTaxKeys.length?`EXISTS (SELECT 1 FROM customer_tax_identifiers ti WHERE ti.customer_id=customers.id AND ti.normalized_identifier IN (${childTaxKeys.map(()=>"?").join(",")}))`:"0"} AS child_tax_identifier_match FROM customers WHERE id<>? AND (${duplicateConditions.join(" OR ")}) ORDER BY name,id LIMIT 8`,[...(childTaxKeys.length?childTaxKeys:[]),id,...duplicateParams]);
   for(const match of matches){
    const matchOn=[
     next.name.toLowerCase()===match.name.toLowerCase()?"name":null,
     next.email&&match.email&&next.email.toLowerCase()===match.email.toLowerCase()?"email":null,
     next.phone&&match.phone===next.phone?"phone":null,
     next.taxIdentifier&&match.tax_identifier&&normalizeIdentifier(match.tax_identifier)===normalizeIdentifier(next.taxIdentifier)?"taxIdentifier":null,
     next.customerCode&&match.customer_code?.toLowerCase()===next.customerCode.toLowerCase()?"customerCode":null,
     Number(match.child_tax_identifier_match)?"taxIdentifier":null,
    ].filter(Boolean);
    duplicates.push({id:match.id,name:match.name,customerCode:match.customer_code,matchOn:matchOn.length?matchOn:["otherField"]});
   }
  }
  // Only fields whose stored value actually differs are written and audited; resubmitting unchanged
  // contacts or tax identifiers does not delete and recreate them.
  const assignments:string[]=[];const values:(string|number|null)[]=[];const changed:string[]=[];
  const set=(field:string,column:string,value:string|number|null,current:string|number|null)=>{if(value===current)return;assignments.push(`${column}=?`);values.push(value);changed.push(field)};
  if(patch.customerCode!==undefined)set("customerCode","customer_code",next.customerCode,row.customer_code);
  if(patch.name!==undefined)set("name","name",next.name,row.name);
  if(patch.email!==undefined)set("email","email",next.email,row.email);
  if(patch.phone!==undefined)set("phone","phone",next.phone,row.phone);
  for(const [field,column,current] of [["billingAddress","billing_address_json",row.billing_address_json],["shippingAddress","shipping_address_json",row.shipping_address_json]] as const){
   const value=patch[field];
   if(value===undefined)continue;
   const nextKey=value===null?"null":addressKey(value);
   if(nextKey!==addressKey(current)){assignments.push(`${column}=?`);values.push(nextKey==="null"?null:JSON.stringify(canonicalObject(value as object)));changed.push(field)}
  }
  if(patch.purchaseOrderReference!==undefined)set("purchaseOrderReference","purchase_order_reference",patch.purchaseOrderReference.trim()||null,row.purchase_order_reference);
  if(patch.paymentTermsDays!==undefined)set("paymentTermsDays","payment_terms_days",patch.paymentTermsDays,row.payment_terms_days===null?null:Number(row.payment_terms_days));
  if(patch.taxIdentifier!==undefined)set("taxIdentifier","tax_identifier",next.taxIdentifier,row.tax_identifier);
  if(patch.notes!==undefined){
   if(!actor.permissions.includes("settings:manage")){await conn.rollback();return jsonNoStore({error:{code:"FORBIDDEN",message:"Internal notes are restricted to finance/settings administrators."}},403)}
   set("notes","notes",patch.notes||null,row.notes||null);
  }
  let replaceContacts=false;let replaceTaxIdentifiers=false;
  if(contacts!==undefined){
   if(contacts.filter(c=>c.isPrimary).length>1){await conn.rollback();return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"Only one primary contact can be selected."}},400)}
   const [currentContacts]=await conn.execute<(RowDataPacket & {full_name:string;job_title:string|null;email:string|null;phone:string|null;is_primary:number})[]>(
    "SELECT full_name,job_title,email,phone,is_primary FROM customer_contacts WHERE customer_id=?",[id]);
   const before=currentContacts.map(c=>contactKey({fullName:c.full_name,jobTitle:c.job_title,email:c.email,phone:c.phone,isPrimary:c.is_primary})).sort();
   replaceContacts=canonical(before)!==canonical(contacts.map(contactKey).sort());
  }
  if(taxIdentifiers!==undefined){
   const [currentTax]=await conn.execute<(RowDataPacket & {identifier_type:string;country_code:string|null;jurisdiction:string|null;identifier_value:string})[]>(
    "SELECT identifier_type,country_code,jurisdiction,identifier_value FROM customer_tax_identifiers WHERE customer_id=?",[id]);
   const before=currentTax.map(t=>taxKey({identifierType:t.identifier_type,countryCode:t.country_code,jurisdiction:t.jurisdiction,identifierValue:t.identifier_value})).sort();
   replaceTaxIdentifiers=canonical(before)!==canonical(taxIdentifiers.map(taxKey).sort());
  }
  if(!assignments.length&&!replaceContacts&&!replaceTaxIdentifiers){
   // Nothing differs from the stored record: no write, no version bump, no audit event.
   await conn.rollback();
   return jsonNoStore({data:{id,...next,isActive:true,recordVersion:expectedVersion,unchanged:true},duplicateWarnings:duplicates});
  }
  if(assignments.length){
   await conn.execute(`UPDATE customers SET ${assignments.join(",")},record_version=record_version+1,updated_by=? WHERE id=? AND record_version=?`,
    [...values,actor.userId,id,expectedVersion]);
  }else{
   // A contact/tax-only edit still advances the master-data version so concurrent updates conflict safely.
   await conn.execute("UPDATE customers SET record_version=record_version+1,updated_by=? WHERE id=? AND record_version=?",[actor.userId,id,expectedVersion]);
  }
  if(contacts!==undefined&&replaceContacts){
   await conn.execute("DELETE FROM customer_contacts WHERE customer_id=?",[id]);
   for(const c of contacts)await conn.execute(
    "INSERT INTO customer_contacts (id,customer_id,full_name,job_title,email,phone,is_primary) VALUES (?,?,?,?,?,?,?)",
    [randomUUID(),id,c.fullName,c.jobTitle?.trim()||null,c.email?.trim().toLowerCase()||null,c.phone?.trim()||null,c.isPrimary?1:0]);
   changed.push("contacts");
  }
  if(taxIdentifiers!==undefined&&replaceTaxIdentifiers){
   await conn.execute("DELETE FROM customer_tax_identifiers WHERE customer_id=?",[id]);
   for(const t of taxIdentifiers){
    const val=t.identifierValue.trim();
    await conn.execute("INSERT INTO customer_tax_identifiers (id,customer_id,identifier_type,country_code,jurisdiction,identifier_value,normalized_identifier,created_by) VALUES (?,?,?,?,?,?,?,?)",
    [randomUUID(),id,t.identifierType.trim().toUpperCase(),t.countryCode?.trim().toUpperCase()||null,t.jurisdiction?.trim()||null,val,normalizeIdentifier(val),actor.userId]);
   }
   changed.push("taxIdentifiers");
  }
  await conn.execute(
   "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json) VALUES (?,?,'customer.updated','customer',?,'SUCCESS',?,?)",
   [randomUUID(),actor.userId,id,JSON.stringify({recordVersion:expectedVersion}),JSON.stringify({recordVersion:expectedVersion+1,changedFields:changed})]);
  await conn.commit();
  return jsonNoStore({data:{id, ...next,
   ...(patch.billingAddress!==undefined?{billingAddress:patch.billingAddress}:{}),
   ...(patch.shippingAddress!==undefined?{shippingAddress:patch.shippingAddress}:{}),
   ...(patch.purchaseOrderReference!==undefined?{purchaseOrderReference:patch.purchaseOrderReference}:{}),
   ...(patch.paymentTermsDays!==undefined?{paymentTermsDays:patch.paymentTermsDays}:{}),
   ...(contacts!==undefined?{contacts}:{}),...(taxIdentifiers!==undefined?{taxIdentifiers}:{}),
   ...(actor.permissions.includes("settings:manage")&&patch.notes!==undefined?{notes:patch.notes}:{}),
   isActive:true,recordVersion:expectedVersion+1},duplicateWarnings:duplicates});
 }catch(error){
  if(conn) await conn.rollback().catch(()=>undefined);
  if(duplicateEntry(error))return jsonNoStore({error:{code:"DUPLICATE_RECORD",message:"A customer code is already in use. Review existing records before retrying."}},409);
  return apiError(error);
 }finally{conn?.release()}
}
