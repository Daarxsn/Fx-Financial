import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { customerCreateSchema } from "@/lib/validation/master-data";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsv, parseJsonCell, normalizeCsvHeader, type CsvRow, type CsvParseIssue } from "@/lib/master-data/csv";
import { IMPORT_TOKEN_HEADER, issueImportToken, sha256Hex, verifyImportToken } from "@/lib/master-data/import-token";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Queryable=Pick<Pool,"query"|"execute">|Pick<PoolConnection,"query"|"execute">;
function normalizeIdentifier(value:string):string{return value.trim().toUpperCase().replace(/[\s-]/g,"")}
function duplicateEntry(error:unknown):boolean{return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY"}
function csvValue(row:CsvRow,key:string):string{return row.values[normalizeCsvHeader(key)]??""}
function parseCell(row:CsvRow,key:string,errors:CsvParseIssue[],array=false):unknown {
 const value=csvValue(row,key);
 if(!value.trim())return undefined;
 const result=parseJsonCell(value,key,row.rowNumber);
 if(result.error){errors.push(result.error);return undefined}
 if(array&&!Array.isArray(result.value)){errors.push({rowNumber:row.rowNumber,field:key,message:"Must be a JSON array."});return undefined}
 if(!array&&(typeof result.value!=="object"||Array.isArray(result.value)||result.value===null)){errors.push({rowNumber:row.rowNumber,field:key,message:"Must be a JSON object."});return undefined}
 return result.value;
}

async function duplicateMatches(db:Queryable,input:{name:string;customerCode?:string;email?:string;phone?:string;taxIdentifiers?:string[];canReadSensitive:boolean}) {
 const clauses:string[]=[];const params:unknown[]=[];
 clauses.push("LOWER(name)=LOWER(?)");params.push(input.name);
 if(input.customerCode){clauses.push("LOWER(customer_code)=LOWER(?)");params.push(input.customerCode)}
 if(input.email){clauses.push("LOWER(email)=LOWER(?)");params.push(input.email.toLowerCase())}
 if(input.phone){clauses.push("phone=?");params.push(input.phone)}
 const taxKeys=input.canReadSensitive?(input.taxIdentifiers??[]).map(normalizeIdentifier).filter(Boolean):[];
 if(taxKeys.length){
  clauses.push("UPPER(REPLACE(REPLACE(tax_identifier,' ',''),'-','')) IN ("+taxKeys.map(()=>"?").join(",")+")");
  params.push(...taxKeys);
  clauses.push("EXISTS (SELECT 1 FROM customer_tax_identifiers ti WHERE ti.customer_id=customers.id AND ti.normalized_identifier IN ("+taxKeys.map(()=>"?").join(",")+"))");
  params.push(...taxKeys);
 }
 const [rows]=await db.query<(RowDataPacket & {id:string;name:string;customer_code:string|null;email:string|null;phone:string|null;tax_identifier:string|null})[]>(
  `SELECT id,name,customer_code,email,phone,tax_identifier FROM customers WHERE (${clauses.join(" OR ")}) ORDER BY name,id LIMIT 8`,params);
 return rows.map(row=>({id:row.id,name:row.name,customerCode:row.customer_code,matchOn:[
  row.name.toLowerCase()===input.name.trim().toLowerCase()?"name":null,
  input.customerCode&&row.customer_code?.toLowerCase()===input.customerCode.toLowerCase()?"customerCode":null,
  input.email&&row.email?.toLowerCase()===input.email.toLowerCase()?"email":null,
  input.phone&&row.phone===input.phone?"phone":null,
  taxKeys.length&&row.tax_identifier&&taxKeys.includes(normalizeIdentifier(row.tax_identifier))?"taxIdentifier":null,
 ].filter((value):value is string=>Boolean(value))}));
}

type Prepared=Array<{rowNumber:number;input:ReturnType<typeof customerCreateSchema.parse>}>;
type DuplicateWarning={rowNumber:number;matches:Array<{id:string;name:string;customerCode:string|null;matchOn?:string[]}>};

// Code conflicts and possible duplicates are always computed by the server, at validation and again inside the commit transaction.
async function detectConflicts(db:Queryable,prepared:Prepared,canReadSensitive:boolean):Promise<{errors:CsvParseIssue[];duplicateWarnings:DuplicateWarning[]}>{
 const errors:CsvParseIssue[]=[];
 const duplicateCodes=new Set<string>();
 for(const {rowNumber,input} of prepared){
  const code=input.customerCode?.trim().toLowerCase();
  if(!code)continue;
  if(duplicateCodes.has(code)){errors.push({rowNumber,field:"customerCode",message:"This customer code appears more than once in the import."});continue}
  duplicateCodes.add(code);
  const [existing]=await db.execute<(RowDataPacket & {id:string})[]>("SELECT id FROM customers WHERE LOWER(customer_code)=LOWER(?) LIMIT 1",[code]);
  if(existing.length)errors.push({rowNumber,field:"customerCode",message:"This customer code is already in use. Choose a different code before importing."});
 }
 if(errors.length)return {errors,duplicateWarnings:[]};
 const duplicateWarnings:DuplicateWarning[]=[];
 const seen=new Map<string,number>();
 for(const row of prepared){
  const input=row.input;
  const keys=[input.customerCode?("code:"+input.customerCode.trim().toLowerCase()):"",
    input.email?("email:"+input.email.trim().toLowerCase()):"",
    input.name?("name:"+input.name.trim().toLowerCase()):""].filter(Boolean);
  const earlier=keys.map(key=>seen.get(key)).filter((number):number is number=>number!==undefined);
  for(const key of keys)seen.set(key,row.rowNumber);
  const matches=await duplicateMatches(db,{name:input.name,customerCode:input.customerCode?.trim()||undefined,email:input.email?.trim()||undefined,
    phone:input.phone?.trim()||undefined,taxIdentifiers:[input.taxIdentifier??"",...(input.taxIdentifiers??[]).map(t=>t.identifierValue)].filter(Boolean),canReadSensitive});
  if(matches.length||earlier.length)duplicateWarnings.push({rowNumber:row.rowNumber,matches:[...matches,...earlier.map(n=>({id:`csv-row-${n}`,name:`Another row in this file (row ${n})`,customerCode:null}))]});
 }
 return {errors,duplicateWarnings};
}

// Audit only the fields a row actually supplied; never the tax identifier or note values themselves.
function suppliedFields(input:Prepared[number]["input"]):string[]{
 const fields:string[]=[];
 const has=(value:unknown)=>value!==undefined&&value!==null&&!(typeof value==="string"&&!value.trim())&&!(Array.isArray(value)&&!value.length);
 for(const key of ["customerCode","name","email","phone","billingAddress","shippingAddress","purchaseOrderReference","paymentTermsDays","taxIdentifier","contacts","taxIdentifiers","notes"] as const)
  if(has(input[key]))fields.push(key);
 return fields;
}

function conflictResponse(rowCount:number,validRows:number,errors:CsvParseIssue[]){
 return jsonNoStore({error:{code:"CSV_VALIDATION_ERROR",message:"Resolve the reported row conflicts before importing."},report:{rowCount,validRows,errors:errors.slice(0,1000)}},422);
}

export async function POST(request:NextRequest){
 try{
  await assertCsrf(request);
  const actor=await requirePermission("customers:create");
  const mode=request.nextUrl.searchParams.get("mode")??"validate";
  if(!["validate","commit"].includes(mode))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"mode must be validate or commit"}},400);
  const confirmDuplicates=request.nextUrl.searchParams.get("confirmDuplicates")==="true";
  const length=Number(request.headers.get("content-length")??"0");
  if(length>MAX_CSV_BYTES)return jsonNoStore({error:{code:"UPLOAD_TOO_LARGE",message:"CSV must be 1 MB or smaller."}},413);
  const bytes=Buffer.from(await request.arrayBuffer());
  if(bytes.byteLength>MAX_CSV_BYTES)return jsonNoStore({error:{code:"UPLOAD_TOO_LARGE",message:"CSV must be 1 MB or smaller."}},413);
  // The commit must carry the token from validating these exact bytes as this user in this session.
  const binding={resource:"customers" as const,userId:actor.userId,sessionId:actor.sessionId,csvSha256:sha256Hex(bytes)};
  if(mode==="commit"){
   const check=verifyImportToken(request.headers.get(IMPORT_TOKEN_HEADER),binding);
   if(!check.ok)return jsonNoStore({error:{code:check.code,message:check.message}},check.status);
  }
  const parsed=parseCsv(bytes.toString("utf8"));
  const errors:CsvParseIssue[]=[...parsed.errors];
  if(errors.length)return jsonNoStore({error:{code:"CSV_PARSE_ERROR",message:"The CSV could not be parsed.",requestId:randomUUID()},report:{errors}},422);
  const headers=new Set(parsed.headers.map(normalizeCsvHeader));
  const canManageSensitive = actor.permissions.includes("settings:manage");
  if (!canManageSensitive && parsed.rows.some(row => Boolean(csvValue(row,"taxIdentifier").trim() || csvValue(row,"taxIdentifiersJson").trim() || csvValue(row,"internalNotes").trim()))) {
   return jsonNoStore({error:{code:"FORBIDDEN",message:"Customer tax identifier and internal-note columns require finance/settings administrator permission."}},403);
  }
  if(!headers.has("name"))errors.push({rowNumber:1,field:"name",message:"Required column is missing."});
  if(parsed.rows.length===0)errors.push({rowNumber:1,message:"CSV must contain at least one data row."});
  if(parsed.rows.length>MAX_CSV_ROWS)errors.push({rowNumber:1,message:`At most ${MAX_CSV_ROWS} data rows are allowed.`});
  const prepared:Prepared=[];
  for(const row of parsed.rows){
   const billingAddress=parseCell(row,"billingAddressJson",errors);
   const shippingAddress=parseCell(row,"shippingAddressJson",errors);
   const contacts=parseCell(row,"contactsJson",errors,true);
   const taxIdentifiers=parseCell(row,"taxIdentifiersJson",errors,true);
   const terms=csvValue(row,"paymentTermsDays");
   if(terms&&(!/^(0|[1-9]\d{0,4})$/.test(terms)||Number(terms)>65535))errors.push({rowNumber:row.rowNumber,field:"paymentTermsDays",message:"Must be an integer from 0 to 65535."});
   if(csvValue(row,"internalNotes")&&!canManageSensitive)
    errors.push({rowNumber:row.rowNumber,field:"internalNotes",message:"This column requires elevated settings permission."});
   const candidate={
    customerCode:csvValue(row,"customerCode"),name:csvValue(row,"name"),
    email:csvValue(row,"email"),phone:csvValue(row,"phone"),
    ...(billingAddress!==undefined?{billingAddress}:{}),...(shippingAddress!==undefined?{shippingAddress}:{}),
    purchaseOrderReference:csvValue(row,"purchaseOrderReference"),
    ...(terms?{paymentTermsDays:Number(terms)}:{}),
    taxIdentifier:csvValue(row,"taxIdentifier"),
    ...(contacts!==undefined?{contacts}:{}),...(taxIdentifiers!==undefined?{taxIdentifiers}:{}),
    ...(canManageSensitive?{notes:csvValue(row,"internalNotes")}:{}),
   };
   const validated=customerCreateSchema.safeParse(candidate);
   if(!validated.success){for(const issue of validated.error.issues)errors.push({rowNumber:row.rowNumber,field:issue.path.join(".")||"row",message:issue.message});}
   else prepared.push({rowNumber:row.rowNumber,input:validated.data});
  }
  if(errors.length)return jsonNoStore({error:{code:"CSV_VALIDATION_ERROR",message:"Fix the reported rows and validate the file again."},report:{rowCount:parsed.rows.length,validRows:prepared.length,errors:errors.slice(0,1000)}},422);
  if(mode==="validate"){
   const result=await detectConflicts(pool,prepared,canManageSensitive);
   if(result.errors.length)return conflictResponse(parsed.rows.length,prepared.length,result.errors);
   const {duplicateWarnings}=result;
   const {token,expiresAt}=issueImportToken(binding);
   return jsonNoStore({data:{mode,valid:true,rowCount:prepared.length,errors:[],duplicateWarnings,
    validationToken:token,validationExpiresAt:expiresAt,requiresDuplicateConfirmation:duplicateWarnings.length>0,
    message:duplicateWarnings.length?"Review possible duplicates before explicitly committing the import. No records have been created.":"Validation passed. No records have been created."}});
  }
  const conn=await pool.getConnection();
  const createdIds:string[]=[];
  let duplicateWarnings:DuplicateWarning[]=[];
  try{
   await conn.beginTransaction();
   // Re-run conflict and duplicate detection inside the transaction: the earlier validation is never trusted.
   const result=await detectConflicts(conn,prepared,canManageSensitive);
   if(result.errors.length){await conn.rollback();return conflictResponse(parsed.rows.length,prepared.length,result.errors)}
   duplicateWarnings=result.duplicateWarnings;
   if(duplicateWarnings.length&&!confirmDuplicates){
    await conn.rollback();
    return jsonNoStore({
     error:{code:"DUPLICATE_CONFIRMATION_REQUIRED",message:"Possible duplicate customers were found. Review the row report and explicitly confirm before committing."},
     data:{mode:"validate",valid:true,rowCount:prepared.length,errors:[],duplicateWarnings,requiresDuplicateConfirmation:true,
      message:"No records were created. Explicit duplicate confirmation is required to commit this import."}
    },409);
   }
   for(const {input} of prepared){
    const id=randomUUID();createdIds.push(id);
    const customerCode=input.customerCode?.trim()||null;
    const email=input.email?.trim().toLowerCase()||null;const phone=input.phone?.trim()||null;
    const taxIdentifier=input.taxIdentifier?.trim()||null;
    await conn.execute(
     `INSERT INTO customers (id,customer_code,name,email,phone,billing_address_json,shipping_address_json,purchase_order_reference,
       payment_terms_days,tax_identifier,notes,is_active,record_version,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,TRUE,1,?,?)`,
     [id,customerCode,input.name,email,phone,input.billingAddress?JSON.stringify(input.billingAddress):null,
      input.shippingAddress?JSON.stringify(input.shippingAddress):null,input.purchaseOrderReference?.trim()||null,input.paymentTermsDays??null,
      taxIdentifier,input.notes||null,actor.userId,actor.userId]);
    for(const contact of input.contacts??[])await conn.execute(
     "INSERT INTO customer_contacts (id,customer_id,full_name,job_title,email,phone,is_primary) VALUES (?,?,?,?,?,?,?)",
     [randomUUID(),id,contact.fullName,contact.jobTitle?.trim()||null,contact.email?.trim().toLowerCase()||null,contact.phone?.trim()||null,contact.isPrimary?1:0]);
    for(const tax of input.taxIdentifiers??[])await conn.execute(
     "INSERT INTO customer_tax_identifiers (id,customer_id,identifier_type,country_code,jurisdiction,identifier_value,normalized_identifier,created_by) VALUES (?,?,?,?,?,?,?,?)",
     [randomUUID(),id,tax.identifierType.trim().toUpperCase(),tax.countryCode?.trim().toUpperCase()||null,tax.jurisdiction?.trim()||null,
      tax.identifierValue.trim(),normalizeIdentifier(tax.identifierValue),actor.userId]);
    await conn.execute("INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,after_json) VALUES (?,?,'customer.imported','customer',?,'SUCCESS',?)",
     [randomUUID(),actor.userId,id,JSON.stringify({changedFields:suppliedFields(input),duplicateConfirmed:duplicateWarnings.length>0})]);
   }
   await conn.commit();
  }catch(error){
   await conn.rollback();
   if(duplicateEntry(error))return jsonNoStore({error:{code:"DUPLICATE_RECORD",message:"An imported customer code already exists. No rows were committed; review the report and retry."}},409);
   throw error;
  }finally{conn.release()}
  return jsonNoStore({data:{mode,createdCount:createdIds.length,createdIds,duplicateWarnings,
   message:"Import committed atomically. Duplicate candidates were not merged; review the warning report."}},201);
 }catch(error){return apiError(error)}
}
