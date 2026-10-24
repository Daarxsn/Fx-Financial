import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const host=process.env.DATABASE_HOST??"";
const database=process.env.DATABASE_NAME??"";
if(process.env.CI!=="true"||host!=="127.0.0.1"||database!=="falchion_ci"){
 throw new Error("Pack 8 query-plan fixtures may run only against disposable falchion_ci on loopback.");
}
const connection=await mysql.createConnection({
 host,port:Number(process.env.DATABASE_PORT??"3306"),database,
 user:process.env.DATABASE_USER??"root",password:process.env.DATABASE_PASSWORD??"",
 decimalNumbers:false,
});
const entityIds=Array.from({length:10},()=>randomUUID());
const customerIds=Array.from({length:10},()=>randomUUID());
const suffix=randomUUID().replaceAll("-","").slice(0,10).toUpperCase();
const pad=(value)=>String(value).padStart(5,"0");
const day=(index)=>{
 const d=new Date(Date.UTC(2025,0,1+(index%700)));
 return d.toISOString().slice(0,10);
};
async function insertMany(table,columns,rows,batchSize=250){
 const cols=columns.join(",");
 for(let start=0;start<rows.length;start+=batchSize){
  const batch=rows.slice(start,start+batchSize);
  const rowPlaceholders="("+columns.map(()=>"?").join(",")+")";
  const sql="INSERT INTO "+table+" ("+cols+") VALUES "+batch.map(()=>rowPlaceholders).join(",");
  await connection.execute(sql,batch.flat());
 }
}
async function explain(name,sql,values,expectedIndex){
 const [rows]=await connection.execute(sql,values);
 assert.ok(rows.length>0,name+": EXPLAIN returned no plan");
 const plan=rows[0];
 const possible=String(plan.possible_keys??"");
 assert.ok(possible.split(",").includes(expectedIndex),
  name+": expected "+expectedIndex+" in possible_keys; got "+JSON.stringify(plan));
 console.log("PASS: "+name+" indexable; possible_keys="+possible+"; chosen="+String(plan.key??"none")+"; estimated_rows="+String(plan.rows??"n/a"));
}
let fixturesCreated=false;
try{
 await insertMany("legal_entities",
  ["id","legal_name","display_name","address_json","currency","is_active"],
  entityIds.map((id,i)=>[id,"Pack 8 Query Plan Entity "+suffix+" "+i,"P8 "+suffix+" "+i,"{}","INR",1]),10);
 await insertMany("customers",
  ["id","name","is_active"],
  customerIds.map((id,i)=>[id,"Pack 8 Query Plan Customer "+suffix+" "+i,1]),10);
 fixturesCreated=true;

 const count=3000;
 const invoices=[],quotations=[],payments=[];
 for(let i=0;i<count;i++){
  const entity=entityIds[i%entityIds.length];
  const customer=customerIds[i%customerIds.length];
  const date=day(i);
  const createdAt=date+" 12:00:00.000";
  invoices.push([randomUUID(),entity,customer,"INVOICE","DRAFT",date,"INR","100.0000",createdAt,createdAt]);
  quotations.push([randomUUID(),entity,customer,"DRAFT",date,"INR","100.0000",createdAt,createdAt]);
  payments.push([randomUUID(),entity,customer,"1.0000","INR",date,"BANK_TRANSFER","RECORDED","P8-"+suffix+"-"+pad(i),createdAt]);
 }
 await insertMany("invoices",
  ["id","legal_entity_id","customer_id","document_type","lifecycle_status","invoice_date","currency","grand_total","created_at","updated_at"],invoices);
 await insertMany("quotations",
  ["id","legal_entity_id","customer_id","status","issue_date","currency","grand_total","created_at","updated_at"],quotations);
 await insertMany("payments",
  ["id","legal_entity_id","customer_id","amount","currency","payment_date","method","status","receipt_reference","created_at"],payments);
 await connection.query("ANALYZE TABLE invoices, quotations, payments");

 const entity=entityIds[0];
 await explain("invoice list (entity + date, 3,000 fixture rows)",
  "EXPLAIN SELECT i.id FROM invoices i WHERE i.legal_entity_id=? AND i.invoice_date>=? AND i.invoice_date<=? ORDER BY COALESCE(i.invoice_date,DATE(i.created_at)) DESC,i.created_at DESC,i.id DESC LIMIT 25 OFFSET 0",
  [entity,"2025-03-01","2026-12-31"],"ix_invoices_entity_date_history");
 await explain("invoice list (entity + status + date)",
  "EXPLAIN SELECT i.id FROM invoices i WHERE i.legal_entity_id=? AND i.lifecycle_status=? AND i.invoice_date>=? AND i.invoice_date<=? ORDER BY COALESCE(i.invoice_date,DATE(i.created_at)) DESC,i.created_at DESC,i.id DESC LIMIT 25 OFFSET 0",
  [entity,"DRAFT","2025-03-01","2026-12-31"],"ix_invoices_entity_status_date_history");
 await explain("quotation list (entity scope)",
  "EXPLAIN SELECT q.id FROM quotations q WHERE q.legal_entity_id=? ORDER BY COALESCE(q.issue_date,DATE(q.created_at)) DESC,q.created_at DESC,q.id DESC LIMIT 25 OFFSET 0",
  [entity],"ix_quotations_entity_date_history");
 await explain("payment list (entity + date)",
  "EXPLAIN SELECT p.id FROM payments p WHERE p.legal_entity_id=? AND p.payment_date>=? AND p.payment_date<=? ORDER BY p.payment_date DESC,p.created_at DESC,p.id DESC LIMIT 25 OFFSET 0",
  [entity,"2025-03-01","2026-12-31"],"ix_payments_entity_date_history");
 await explain("payment list (entity + status + date)",
  "EXPLAIN SELECT p.id FROM payments p WHERE p.legal_entity_id=? AND p.status=? AND p.payment_date>=? AND p.payment_date<=? ORDER BY p.payment_date DESC,p.created_at DESC,p.id DESC LIMIT 25 OFFSET 0",
  [entity,"RECORDED","2025-03-01","2026-12-31"],"ix_payments_entity_status_date_history");
 console.log("PASS: query-plan checks completed with 3,000 temporary invoices, quotations and payments across 10 legal-entity scopes.");
}finally{
 if(fixturesCreated){
  try{
   const marks=entityIds.map(()=>"?").join(",");
   await connection.execute("DELETE FROM payments WHERE legal_entity_id IN ("+marks+")",entityIds);
   await connection.execute("DELETE FROM quotations WHERE legal_entity_id IN ("+marks+")",entityIds);
   await connection.execute("DELETE FROM invoices WHERE legal_entity_id IN ("+marks+")",entityIds);
   await connection.execute("DELETE FROM customers WHERE id IN ("+customerIds.map(()=>"?").join(",")+")",customerIds);
   await connection.execute("DELETE FROM legal_entities WHERE id IN ("+marks+")",entityIds);
  }catch(error){
   console.error("Pack 8 query-plan fixture cleanup failed on disposable falchion_ci:",error instanceof Error?error.message:"unknown");
   process.exitCode=1;
  }
 }
 await connection.end();
}
