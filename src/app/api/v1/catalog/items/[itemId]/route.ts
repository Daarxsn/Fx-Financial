import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { canReadCatalogInternal } from "@/lib/master-data/permissions";
import { catalogReferenceCounts } from "@/lib/master-data/reference-counts";
import { catalogItemUpdateSchema, uuidSchema } from "@/lib/validation/master-data";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{itemId:string}>};
function duplicateEntry(error:unknown):boolean{return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY"}

export async function GET(_request:NextRequest,context:Context){
 try{
  const actor=await requirePermission("catalog:read");const {itemId}=await context.params;const id=uuidSchema.parse(itemId);
  const [rows]=await pool.execute<(RowDataPacket & {
   id:string;item_code:string|null;item_type:string;name:string;customer_description:string;internal_description:string|null;
   unit_code:string;default_unit_price:string;currency:string;default_tax_code:string|null;is_active:number;record_version:number;
   archived_at:Date|null;archive_reason:string|null;created_at:Date;updated_at:Date;
  })[]>(
   `SELECT id,item_code,item_type,name,customer_description,internal_description,unit_code,default_unit_price,currency,
           default_tax_code,is_active,record_version,archived_at,archive_reason,created_at,updated_at
    FROM catalog_items WHERE id=? LIMIT 1`,[id]);
  if(!rows.length)return jsonNoStore({error:{code:"NOT_FOUND",message:"Catalog item not found"}},404);
  const row=rows[0];
  const referenceCounts=await catalogReferenceCounts(pool,actor,id);
  const canReadInternal=canReadCatalogInternal(actor.permissions);
  return jsonNoStore({data:{
   id:row.id,itemCode:row.item_code,itemType:row.item_type,name:row.name,customerDescription:row.customer_description,
   ...(canReadInternal?{internalDescription:row.internal_description}:{}),unitCode:row.unit_code,
   defaultUnitPrice:row.default_unit_price,currency:row.currency,defaultTaxCode:row.default_tax_code,
   isActive:Boolean(row.is_active),recordVersion:Number(row.record_version),archivedAt:row.archived_at,archiveReason:row.archive_reason,
   createdAt:row.created_at,updatedAt:row.updated_at,
   referenceCounts,
  }});
 }catch(error){return apiError(error)}
}

export async function PATCH(request:NextRequest,context:Context){
 let conn:Awaited<ReturnType<typeof pool.getConnection>>|undefined;
 try{
  await assertCsrf(request);const actor=await requirePermission("catalog:update");
  const {itemId}=await context.params;const id=uuidSchema.parse(itemId);
  const input=catalogItemUpdateSchema.parse(await request.json());const {expectedVersion,...patch}=input;
  conn=await pool.getConnection();await conn.beginTransaction();
  const [rows]=await conn.execute<(RowDataPacket & {
   id:string;item_code:string|null;item_type:string;name:string;customer_description:string;internal_description:string|null;
   unit_code:string;default_unit_price:string;currency:string;default_tax_code:string|null;is_active:number;record_version:number;
  })[]>(
   "SELECT id,item_code,item_type,name,customer_description,internal_description,unit_code,default_unit_price,currency,default_tax_code,is_active,record_version FROM catalog_items WHERE id=? FOR UPDATE",[id]);
  if(!rows.length){await conn.rollback();return jsonNoStore({error:{code:"NOT_FOUND",message:"Catalog item not found"}},404)}
  const row=rows[0];
  if(Number(row.record_version)!==expectedVersion){await conn.rollback();return jsonNoStore({error:{code:"VERSION_CONFLICT",message:"This item changed since you opened it. Reload it before saving."}},409)}
  if(!row.is_active){await conn.rollback();return jsonNoStore({error:{code:"ARCHIVED_RECORD",message:"Archived items cannot be edited."}},409)}
  const itemCode=patch.itemCode!==undefined?(patch.itemCode.trim()||null):row.item_code;
  if(itemCode){
   const [duplicates]=await conn.execute<(RowDataPacket & {id:string})[]>("SELECT id FROM catalog_items WHERE item_code=? AND id<>? LIMIT 1",[itemCode,id]);
   if(duplicates.length){await conn.rollback();return jsonNoStore({error:{code:"DUPLICATE_RECORD",message:"This item/service code is already in use."}},409)}
  }
  const nextName=patch.name??row.name;const nextType=patch.itemType??row.item_type;
  const [similar]=await conn.execute<(RowDataPacket & {id:string;name:string;item_code:string|null;item_type:string})[]>(
   "SELECT id,name,item_code,item_type FROM catalog_items WHERE id<>? AND LOWER(name)=LOWER(?) AND item_type=? ORDER BY name,id LIMIT 8",[id,nextName,nextType]);
  // Only fields whose stored value actually differs are written and audited. Commercial defaults
  // (price, currency, unit, tax code) also record their before/after values.
  const assignments:string[]=[];const values:(string|null)[]=[];const changed:string[]=[];
  const commercialBefore:Record<string,string|null>={};const commercialAfter:Record<string,string|null>={};
  const set=(field:string,column:string,value:string|null,current:string|null,same=value===current)=>{
   if(same)return;
   assignments.push(`${column}=?`);values.push(value);changed.push(field);
   if(["defaultUnitPrice","currency","unitCode","defaultTaxCode"].includes(field)){commercialBefore[field]=current;commercialAfter[field]=value}
  };
  const decimalKey=(value:string)=>value.includes(".")?value.replace(/0+$/,"").replace(/\.$/,""):value;
  if(patch.itemCode!==undefined)set("itemCode","item_code",itemCode,row.item_code);
  if(patch.itemType!==undefined)set("itemType","item_type",patch.itemType,row.item_type);
  if(patch.name!==undefined)set("name","name",patch.name,row.name);
  if(patch.customerDescription!==undefined)set("customerDescription","customer_description",patch.customerDescription,row.customer_description);
  if(patch.internalDescription!==undefined)set("internalDescription","internal_description",patch.internalDescription||null,row.internal_description||null);
  if(patch.unitCode!==undefined)set("unitCode","unit_code",patch.unitCode,row.unit_code);
  if(patch.defaultUnitPrice!==undefined)set("defaultUnitPrice","default_unit_price",patch.defaultUnitPrice,String(row.default_unit_price),
   decimalKey(patch.defaultUnitPrice)===decimalKey(String(row.default_unit_price)));
  if(patch.currency!==undefined)set("currency","currency",patch.currency,row.currency);
  if(patch.defaultTaxCode!==undefined)set("defaultTaxCode","default_tax_code",patch.defaultTaxCode?.trim()||null,row.default_tax_code||null);
  if(!assignments.length){
   // Nothing differs from the stored record: no write, no version bump, no audit event.
   await conn.rollback();
   return jsonNoStore({data:{id,itemCode:row.item_code,itemType:row.item_type,name:row.name,customerDescription:row.customer_description,
    ...(canReadCatalogInternal(actor.permissions)?{internalDescription:row.internal_description}:{}),
    unitCode:row.unit_code,defaultUnitPrice:row.default_unit_price,currency:row.currency,defaultTaxCode:row.default_tax_code,
    isActive:true,recordVersion:expectedVersion,unchanged:true},
    duplicateWarnings:similar.map(s=>({id:s.id,name:s.name,itemCode:s.item_code,itemType:s.item_type,matchOn:["name","itemType"]}))});
  }
  await conn.execute(`UPDATE catalog_items SET ${assignments.join(",")},record_version=record_version+1,updated_by=? WHERE id=? AND record_version=?`,[...values,actor.userId,id,expectedVersion]);
  await conn.execute("INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json) VALUES (?,?,'catalog_item.updated','catalog_item',?,'SUCCESS',?,?)",
   [randomUUID(),actor.userId,id,JSON.stringify({recordVersion:expectedVersion,...commercialBefore}),JSON.stringify({recordVersion:expectedVersion+1,changedFields:changed,...commercialAfter})]);
  await conn.commit();
  return jsonNoStore({data:{id,itemCode,itemType:nextType,name:nextName,
   customerDescription:patch.customerDescription??row.customer_description,
   ...(canReadCatalogInternal(actor.permissions)?{internalDescription:patch.internalDescription??row.internal_description}:{}),
   unitCode:patch.unitCode??row.unit_code,defaultUnitPrice:patch.defaultUnitPrice??row.default_unit_price,
   currency:patch.currency??row.currency,defaultTaxCode:patch.defaultTaxCode??row.default_tax_code,
   isActive:true,recordVersion:expectedVersion+1},
   duplicateWarnings:similar.map(s=>({id:s.id,name:s.name,itemCode:s.item_code,itemType:s.item_type,matchOn:["name","itemType"]}))});
 }catch(error){
  if(conn) await conn.rollback().catch(()=>undefined);
  if(duplicateEntry(error))return jsonNoStore({error:{code:"DUPLICATE_RECORD",message:"This item/service code is already in use."}},409);
  return apiError(error);
 }finally{conn?.release()}
}
