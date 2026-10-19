import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { catalogItemCreateSchema } from "@/lib/validation/master-data";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsv, normalizeCsvHeader, type CsvRow, type CsvParseIssue } from "@/lib/master-data/csv";
import { IMPORT_TOKEN_HEADER, issueImportToken, sha256Hex, verifyImportToken } from "@/lib/master-data/import-token";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Queryable=Pick<Pool,"query"|"execute">|Pick<PoolConnection,"query"|"execute">;
type Prepared=Array<{rowNumber:number;input:ReturnType<typeof catalogItemCreateSchema.parse>}>;
type DuplicateWarning={rowNumber:number;matches:Array<{id:string;name:string;itemCode:string|null;matchOn:string[]}>};
function duplicateEntry(error:unknown):boolean{return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="ER_DUP_ENTRY"}
function csvValue(row:CsvRow,key:string):string{return row.values[normalizeCsvHeader(key)]??""}
function conflictResponse(rowCount:number,validRows:number,errors:CsvParseIssue[]){
 return jsonNoStore({error:{code:"CSV_VALIDATION_ERROR",message:"Resolve the reported row conflicts before importing."},report:{rowCount,validRows,errors:errors.slice(0,1000)}},422);
}

// Code conflicts and possible duplicates are always computed by the server, at validation and again inside the commit transaction.
async function detectConflicts(db:Queryable,prepared:Prepared):Promise<{errors:CsvParseIssue[];duplicateWarnings:DuplicateWarning[]}>{
 const errors:CsvParseIssue[]=[];
 const seenCodes=new Set<string>();
 for(const {rowNumber,input} of prepared){
  const code=input.itemCode?.trim().toLowerCase();if(!code)continue;
  if(seenCodes.has(code)){errors.push({rowNumber,field:"itemCode",message:"This item/service code appears more than once in the import."});continue}
  seenCodes.add(code);
  const [existing]=await db.execute<(RowDataPacket & {id:string})[]>("SELECT id FROM catalog_items WHERE LOWER(item_code)=LOWER(?) LIMIT 1",[code]);
  if(existing.length)errors.push({rowNumber,field:"itemCode",message:"This item/service code is already in use. Choose another code before importing."});
 }
 if(errors.length)return {errors,duplicateWarnings:[]};
 const duplicateWarnings:DuplicateWarning[]=[];
 const seen=new Map<string,number>();
 for(const {rowNumber,input} of prepared){
  const keys=[input.itemCode?("code:"+input.itemCode.trim().toLowerCase()):"", "name:"+input.itemType+":"+input.name.trim().toLowerCase()].filter(Boolean);
  const earlier=keys.map(key=>seen.get(key)).filter((number):number is number=>number!==undefined);
  for(const key of keys)seen.set(key,rowNumber);
  const clauses:string[]=["LOWER(name)=LOWER(?) AND item_type=?"];const params:unknown[]=[input.name,input.itemType];
  if(input.itemCode){clauses.push("LOWER(item_code)=LOWER(?)");params.push(input.itemCode)}
  const [rows]=await db.query<(RowDataPacket & {id:string;name:string;item_code:string|null;item_type:string})[]>(
   `SELECT id,name,item_code,item_type FROM catalog_items WHERE ${clauses.map(q=>"("+q+")").join(" OR ")} ORDER BY name,id LIMIT 8`,params);
  const matches=rows.map(row=>({id:row.id,name:row.name,itemCode:row.item_code,matchOn:[
   row.name.toLowerCase()===input.name.trim().toLowerCase()&&row.item_type===input.itemType?"name/type":null,
   input.itemCode&&row.item_code?.toLowerCase()===input.itemCode.trim().toLowerCase()?"itemCode":null,
  ].filter((v):v is string=>Boolean(v))}));
  for(const n of earlier)matches.push({id:`csv-row-${n}`,name:`Another row in this file (row ${n})`,itemCode:null,matchOn:["possible duplicate in import"]});
  if(matches.length)duplicateWarnings.push({rowNumber,matches});
 }
 return {errors,duplicateWarnings};
}

// Audit only the fields a row actually supplied.
function suppliedFields(input:Prepared[number]["input"]):string[]{
 return (["itemCode","itemType","name","customerDescription","internalDescription","unitCode","defaultUnitPrice","currency","defaultTaxCode"] as const)
  .filter(key=>typeof input[key]==="string"&&Boolean(input[key]?.trim()));
}

export async function POST(request:NextRequest){
 try{
  await assertCsrf(request);const actor=await requirePermission("catalog:create");
  const mode=request.nextUrl.searchParams.get("mode")??"validate";
  if(!["validate","commit"].includes(mode))return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"mode must be validate or commit"}},400);
  const confirmDuplicates=request.nextUrl.searchParams.get("confirmDuplicates")==="true";
  const length=Number(request.headers.get("content-length")??"0");
  if(length>MAX_CSV_BYTES)return jsonNoStore({error:{code:"UPLOAD_TOO_LARGE",message:"CSV must be 1 MB or smaller."}},413);
  const bytes=Buffer.from(await request.arrayBuffer());
  if(bytes.byteLength>MAX_CSV_BYTES)return jsonNoStore({error:{code:"UPLOAD_TOO_LARGE",message:"CSV must be 1 MB or smaller."}},413);
  // The commit must carry the token from validating these exact bytes as this user in this session.
  const binding={resource:"catalog" as const,userId:actor.userId,sessionId:actor.sessionId,csvSha256:sha256Hex(bytes)};
  if(mode==="commit"){
   const check=verifyImportToken(request.headers.get(IMPORT_TOKEN_HEADER),binding);
   if(!check.ok)return jsonNoStore({error:{code:check.code,message:check.message}},check.status);
  }
  const parsed=parseCsv(bytes.toString("utf8"));const errors:CsvParseIssue[]=[...parsed.errors];
  if(errors.length)return jsonNoStore({error:{code:"CSV_PARSE_ERROR",message:"The CSV could not be parsed."},report:{errors}},422);
  const headers=new Set(parsed.headers.map(normalizeCsvHeader));
  for(const required of ["itemtype","name","customerdescription","unitcode","defaultunitprice","currency"])
   if(!headers.has(required))errors.push({rowNumber:1,field:required,message:"Required column is missing."});
  if(!parsed.rows.length)errors.push({rowNumber:1,message:"CSV must contain at least one data row."});
  if(parsed.rows.length>MAX_CSV_ROWS)errors.push({rowNumber:1,message:`At most ${MAX_CSV_ROWS} data rows are allowed.`});
  const prepared:Prepared=[];
  for(const row of parsed.rows){
   const candidate={
    itemCode:csvValue(row,"itemCode"),itemType:csvValue(row,"itemType").trim().toUpperCase(),
    name:csvValue(row,"name"),customerDescription:csvValue(row,"customerDescription"),
    internalDescription:csvValue(row,"internalDescription"),unitCode:csvValue(row,"unitCode"),
    defaultUnitPrice:csvValue(row,"defaultUnitPrice"),currency:csvValue(row,"currency").trim().toUpperCase(),
    defaultTaxCode:csvValue(row,"defaultTaxCode"),
   };
   const validated=catalogItemCreateSchema.safeParse(candidate);
   if(!validated.success)for(const issue of validated.error.issues)errors.push({rowNumber:row.rowNumber,field:issue.path.join(".")||"row",message:issue.message});
   else prepared.push({rowNumber:row.rowNumber,input:validated.data});
  }
  if(errors.length)return jsonNoStore({error:{code:"CSV_VALIDATION_ERROR",message:"Fix the reported rows and validate the file again."},report:{rowCount:parsed.rows.length,validRows:prepared.length,errors:errors.slice(0,1000)}},422);
  if(mode==="validate"){
   const result=await detectConflicts(pool,prepared);
   if(result.errors.length)return conflictResponse(parsed.rows.length,prepared.length,result.errors);
   const {duplicateWarnings}=result;
   const {token,expiresAt}=issueImportToken(binding);
   return jsonNoStore({data:{mode,valid:true,rowCount:prepared.length,errors:[],duplicateWarnings,
    validationToken:token,validationExpiresAt:expiresAt,requiresDuplicateConfirmation:duplicateWarnings.length>0,
    message:duplicateWarnings.length?"Review possible duplicates before explicitly committing the import. No records have been created.":"Validation passed. No records have been created."}});
  }
  const conn=await pool.getConnection();const createdIds:string[]=[];
  let duplicateWarnings:DuplicateWarning[]=[];
  try{
   await conn.beginTransaction();
   // Re-run conflict and duplicate detection inside the transaction: the earlier validation is never trusted.
   const result=await detectConflicts(conn,prepared);
   if(result.errors.length){await conn.rollback();return conflictResponse(parsed.rows.length,prepared.length,result.errors)}
   duplicateWarnings=result.duplicateWarnings;
   if(duplicateWarnings.length&&!confirmDuplicates){
    await conn.rollback();
    return jsonNoStore({
     error:{code:"DUPLICATE_CONFIRMATION_REQUIRED",message:"Possible duplicate catalog items were found. Review the row report and explicitly confirm before committing."},
     data:{mode:"validate",valid:true,rowCount:prepared.length,errors:[],duplicateWarnings,requiresDuplicateConfirmation:true,
      message:"No records were created. Explicit duplicate confirmation is required to commit this import."}
    },409);
   }
   for(const {input} of prepared){
    const id=randomUUID();createdIds.push(id);
    await conn.execute(
     `INSERT INTO catalog_items
      (id,item_code,item_type,name,customer_description,internal_description,unit_code,default_unit_price,currency,default_tax_code,is_active,record_version,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,TRUE,1,?,?)`,
     [id,input.itemCode?.trim()||null,input.itemType,input.name,input.customerDescription,input.internalDescription||null,
      input.unitCode,input.defaultUnitPrice,input.currency,input.defaultTaxCode?.trim()||null,actor.userId,actor.userId]);
    await conn.execute(
     "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,after_json) VALUES (?,?,'catalog_item.imported','catalog_item',?,'SUCCESS',?)",
     [randomUUID(),actor.userId,id,JSON.stringify({changedFields:suppliedFields(input),duplicateConfirmed:duplicateWarnings.length>0})]);
   }
   await conn.commit();
  }catch(error){
   await conn.rollback();
   if(duplicateEntry(error))return jsonNoStore({error:{code:"DUPLICATE_RECORD",message:"An imported item/service code already exists. No rows were committed; review the report and retry."}},409);
   throw error;
  }finally{conn.release()}
  return jsonNoStore({data:{mode,createdCount:createdIds.length,createdIds,duplicateWarnings,
   message:"Import committed atomically. Duplicate candidates were not merged; review the warning report."}},201);
 }catch(error){return apiError(error)}
}
