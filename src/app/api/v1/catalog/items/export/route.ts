import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { canReadCatalogInternal } from "@/lib/master-data/permissions";
import { buildCsv } from "@/lib/master-data/csv";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_EXPORT_ROWS=10_000;

export async function GET(request:NextRequest){
 try{
  const actor=await requirePermission("catalog:read");
  const status=request.nextUrl.searchParams.get("status")??"active";
  if(!["active","archived","all"].includes(status))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"status must be active, archived, or all"}},400);
  const clauses:string[]=[];const params:unknown[]=[];
  if(status!=="all"){clauses.push("is_active=?");params.push(status==="active"?1:0)}
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
  const [rows]=await pool.query<(RowDataPacket & {
   item_code:string|null;item_type:string;name:string;customer_description:string;internal_description:string|null;
   unit_code:string;default_unit_price:string;currency:string;default_tax_code:string|null;is_active:number;record_version:number;
   created_at:Date;updated_at:Date;
  })[]>(
   `SELECT item_code,item_type,name,customer_description,internal_description,unit_code,default_unit_price,currency,
      default_tax_code,is_active,record_version,created_at,updated_at
    FROM catalog_items ${where} ORDER BY name,id LIMIT ?`,[...params,MAX_EXPORT_ROWS+1]);
  if(rows.length>MAX_EXPORT_ROWS)return jsonNoStore({error:{code:"EXPORT_LIMIT_EXCEEDED",message:`Export contains more than ${MAX_EXPORT_ROWS} rows. Narrow the status filter or use paginated views.`}},413);
  const canReadInternal=canReadCatalogInternal(actor.permissions);
  const headers=["itemCode","itemType","name","customerDescription",...(canReadInternal?["internalDescription"]:[]),
    "unitCode","defaultUnitPrice","currency","defaultTaxCode","isActive","recordVersion","createdAt","updatedAt"];
  const data=rows.map(row=>({
   itemCode:row.item_code,itemType:row.item_type,name:row.name,customerDescription:row.customer_description,
   ...(canReadInternal?{internalDescription:row.internal_description}:{}),unitCode:row.unit_code,
   defaultUnitPrice:row.default_unit_price,currency:row.currency,defaultTaxCode:row.default_tax_code,
   isActive:Boolean(row.is_active),recordVersion:Number(row.record_version),
   createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),
  }));
  const csv=buildCsv(headers,data);
  return new Response(csv,{status:200,headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":'attachment; filename="falchion-catalog.csv"',
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Request-Id":randomUUID(),
  }});
 }catch(error){return apiError(error)}
}
