import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { AuthorizationError, requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 try{
  let actor;try{actor=await requirePermission("invoices:draft:create");}catch(error){if(!(error instanceof AuthorizationError)||error.code!=="FORBIDDEN")throw error;actor=await requirePermission("invoices:draft:update");}const scope=[...new Set(actor.legalEntityIds)];
  if(!scope.length)return jsonNoStore({data:{legalEntities:[],brands:[],customers:[],catalogItems:[],taxRules:[]}});
  const placeholders=scope.map(()=>"?").join(",");
  const [entities]=await pool.query<(RowDataPacket & {id:string;display_name:string;currency:string;tax_setup_status:string;default_tax_code:string|null})[]>(
    `SELECT id,display_name,currency,tax_setup_status,default_tax_code FROM legal_entities WHERE id IN (${placeholders}) AND is_active=TRUE ORDER BY display_name,id`,scope);
  const [brandRows]=await pool.query<(RowDataPacket & {id:string;name:string;code:string;logo_reference:string|null;default_template_key:string|null;theme_json:unknown;legal_entity_id:string;entity_name:string;currency:string;tax_setup_status:string;default_tax_code:string|null;is_default:number;mapping_count:number})[]>(
    `SELECT id,name,code,logo_reference,default_template_key,theme_json,legal_entity_id,entity_name,currency,tax_setup_status,is_default,mapping_count
     FROM (
       SELECT b.id,b.name,b.code,b.logo_reference,b.default_template_key,b.theme_json,
              e.id AS legal_entity_id,e.display_name AS entity_name,e.currency,e.tax_setup_status,e.default_tax_code,ble.is_default,
              COUNT(*) OVER (PARTITION BY b.id) AS mapping_count,
              ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY ble.is_default DESC,ble.legal_entity_id ASC) AS mapping_rank
       FROM brands b
       JOIN brand_legal_entities ble ON ble.brand_id=b.id
       JOIN legal_entities e ON e.id=ble.legal_entity_id
       WHERE b.is_active=TRUE AND e.is_active=TRUE
         AND ble.legal_entity_id IN (${placeholders})
         AND ble.effective_from<=NOW(3) AND (ble.effective_until IS NULL OR ble.effective_until>NOW(3))
     ) mapped WHERE mapping_rank=1 ORDER BY name,id`,scope);
  const [customers]=await pool.query<(RowDataPacket & {id:string;name:string;customer_code:string|null;email:string|null;payment_terms_days:number|null})[]>(
    "SELECT id,name,customer_code,email,payment_terms_days FROM customers WHERE is_active=TRUE ORDER BY name,id LIMIT 1000");
  const [catalogItems]=await pool.query<(RowDataPacket & {id:string;item_code:string|null;item_type:string;name:string;customer_description:string;unit_code:string;default_unit_price:string;currency:string;default_tax_code:string|null})[]>(
    "SELECT id,item_code,item_type,name,customer_description,unit_code,default_unit_price,currency,default_tax_code FROM catalog_items WHERE is_active=TRUE ORDER BY name,id LIMIT 1000");
  const [taxRules]=await pool.query<(RowDataPacket & {id:string;legal_entity_id:string;tax_code:string;display_name:string;rate:string;calculation_mode:string;effective_from:Date|string;effective_until:Date|string|null})[]>(
    `SELECT id,legal_entity_id,tax_code,display_name,rate,calculation_mode,
             DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
             DATE_FORMAT(effective_until, '%Y-%m-%d') AS effective_until FROM tax_rules
      WHERE legal_entity_id IN (${placeholders}) AND is_active=TRUE AND approved_at IS NOT NULL ORDER BY legal_entity_id,tax_code,effective_from DESC`,scope);
  return jsonNoStore({data:{
   legalEntities:entities.map(e=>({id:e.id,name:e.display_name,currency:e.currency,taxSetupStatus:e.tax_setup_status,defaultTaxCode:e.default_tax_code})),
   brands:brandRows.map(b=>({id:b.id,name:b.name,code:b.code,logoReference:b.logo_reference,defaultTemplateKey:b.default_template_key,
     theme:typeof b.theme_json==="string"?(()=>{try{return JSON.parse(b.theme_json) as Record<string,unknown>}catch{return {}}})():b.theme_json??{},
     legalEntityId:b.legal_entity_id,legalEntityName:b.entity_name,currency:b.currency,taxSetupStatus:b.tax_setup_status,defaultTaxCode:b.default_tax_code,
     canAutoMap:Boolean(b.is_default)||Number(b.mapping_count)===1,
   })),
   customers:customers.map(c=>({id:c.id,name:c.name,customerCode:c.customer_code,email:c.email,paymentTermsDays:c.payment_terms_days===null?null:Number(c.payment_terms_days)})),
   catalogItems:catalogItems.map(i=>({id:i.id,itemCode:i.item_code,itemType:i.item_type,name:i.name,description:i.customer_description,unitCode:i.unit_code,defaultUnitPrice:String(i.default_unit_price),currency:i.currency,defaultTaxCode:i.default_tax_code})),
   taxRules:taxRules.map(t=>({id:t.id,legalEntityId:t.legal_entity_id,taxCode:t.tax_code,displayName:t.display_name,ratePercent:String(t.rate),calculationMode:t.calculation_mode,effectiveFrom:t.effective_from,effectiveUntil:t.effective_until})),
  }});
 }catch(error){return apiError(error);}
}
