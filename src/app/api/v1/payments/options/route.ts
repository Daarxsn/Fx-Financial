import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  const actor=await requirePermission("payments:record");
  const scopes=[...new Set(actor.legalEntityIds)];
  if(!scopes.length)return jsonNoStore({data:{legalEntities:[],customers:[]}});
  const slots=scopes.map(()=>"?").join(",");
  const [entities]=await pool.execute<(RowDataPacket & {id:string;legal_name:string;display_name:string;currency:string})[]>(
   "SELECT id,legal_name,display_name,currency FROM legal_entities WHERE id IN ("+slots+") AND is_active=TRUE ORDER BY display_name,id",scopes);
  const [customers]=await pool.execute<(RowDataPacket & {id:string;customer_code:string|null;name:string;email:string|null})[]>(
   "SELECT id,customer_code,name,email FROM customers WHERE is_active=TRUE ORDER BY name,id LIMIT 1000");
  return jsonNoStore({data:{
   legalEntities:entities.map(e=>({id:e.id,legalName:e.legal_name,name:e.display_name,currency:e.currency})),
   customers:customers.map(c=>({id:c.id,customerCode:c.customer_code,name:c.name,email:c.email})),
  }});
 }catch(error){return apiError(error);}
}
