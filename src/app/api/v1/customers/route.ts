import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { customerCreateSchema } from "@/lib/validation/master-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}
function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}
function duplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ER_DUP_ENTRY";
}
async function findCustomerDuplicates(input: {
  id?: string; name?: string; email?: string | null; phone?: string | null;
  taxIdentifier?: string | null; taxIdentifiers?: string[]; customerCode?: string | null;
}) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (input.name?.trim()) { conditions.push("LOWER(name)=LOWER(?)"); values.push(input.name.trim()); }
  if (input.email?.trim()) { conditions.push("LOWER(email)=LOWER(?)"); values.push(input.email.trim().toLowerCase()); }
  if (input.phone?.trim()) { conditions.push("phone=?"); values.push(input.phone.trim()); }
  if (input.taxIdentifier?.trim()) { conditions.push("UPPER(REPLACE(REPLACE(tax_identifier,' ',''),'-',''))=?"); values.push(normalizeIdentifier(input.taxIdentifier)); }
  if (input.customerCode?.trim()) { conditions.push("LOWER(customer_code)=LOWER(?)"); values.push(input.customerCode.trim()); }
  const childTaxKeys = (input.taxIdentifiers ?? []).map(normalizeIdentifier).filter(Boolean);
  if (childTaxKeys.length) { conditions.push(`EXISTS (SELECT 1 FROM customer_tax_identifiers ti WHERE ti.customer_id=customers.id AND ti.normalized_identifier IN (${childTaxKeys.map(() => "?").join(",")}))`); values.push(...childTaxKeys); }
  if (!conditions.length) return [];
  const idClause = input.id ? " AND id<>?" : "";
  if (input.id) values.push(input.id);
  const [rows] = await pool.query<(RowDataPacket & {id:string;name:string;customer_code:string|null;email:string|null;phone:string|null;tax_identifier:string|null;child_tax_identifier_match:number})[]>(
    `SELECT id,name,customer_code,email,phone,tax_identifier,${childTaxKeys.length ? `EXISTS (SELECT 1 FROM customer_tax_identifiers ti WHERE ti.customer_id=customers.id AND ti.normalized_identifier IN (${childTaxKeys.map(() => "?").join(",")}))` : "0"} AS child_tax_identifier_match FROM customers WHERE (${conditions.join(" OR ")})${idClause} ORDER BY name,id LIMIT 8`, [...childTaxKeys, ...values]);
  return rows.map(row => ({
    id: row.id, name: row.name, customerCode: row.customer_code,
    matchOn: [
      input.name?.trim().toLowerCase() === row.name.toLowerCase() ? "name" : null,
      input.email?.trim() && row.email?.toLowerCase() === input.email.trim().toLowerCase() ? "email" : null,
      input.phone?.trim() && row.phone === input.phone.trim() ? "phone" : null,
      input.taxIdentifier?.trim() && row.tax_identifier && normalizeIdentifier(row.tax_identifier) === normalizeIdentifier(input.taxIdentifier) ? "taxIdentifier" : null,
      Number(row.child_tax_identifier_match) ? "taxIdentifier" : null,
      input.customerCode?.trim() && row.customer_code?.toLowerCase() === input.customerCode.trim().toLowerCase() ? "customerCode" : null,
    ].filter(Boolean),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission("customers:read");
    const canReadSensitive = actor.permissions.includes("settings:manage");
    const query = (request.nextUrl.searchParams.get("query") ?? "").trim().slice(0, 100);
    const status = request.nextUrl.searchParams.get("status") ?? "active";
    if (!["active", "archived", "all"].includes(status)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "status must be active, archived, or all" } }, 400);
    }
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "limit must be 1–100 and offset must be between 0 and 1000000" } }, 400);
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status !== "all") { clauses.push("c.is_active = ?"); params.push(status === "active" ? 1 : 0); }
    if (query) {
      const escaped = query.replace(/[\\%_]/g, "\\$&");
      const pattern = `%${escaped}%`;
      clauses.push(`(c.name LIKE ? OR c.customer_code LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
        OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=c.id AND (cc.full_name LIKE ? OR cc.email LIKE ? OR cc.phone LIKE ?))${canReadSensitive ? " OR c.tax_identifier LIKE ? OR EXISTS (SELECT 1 FROM customer_tax_identifiers ti WHERE ti.customer_id=c.id AND (ti.identifier_value LIKE ? OR ti.normalized_identifier LIKE ?))" : ""})`);
      params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, ...(canReadSensitive ? [pattern, pattern, pattern] : []));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.query<(RowDataPacket & {
      id:string;customer_code:string|null;name:string;email:string|null;phone:string|null;
      billing_address_json:unknown;shipping_address_json:unknown;purchase_order_reference:string|null;
      payment_terms_days:number|null;tax_identifier:string|null;is_active:number;record_version:number;
      archived_at:Date|null;created_at:Date;updated_at:Date;
    })[]>(
      `SELECT c.id,c.customer_code,c.name,c.email,c.phone,c.billing_address_json,c.shipping_address_json,
              c.purchase_order_reference,c.payment_terms_days,c.tax_identifier,c.is_active,c.record_version,
              c.archived_at,c.created_at,c.updated_at
       FROM customers c ${where} ORDER BY c.name ASC,c.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [[countRow]] = await pool.query<(RowDataPacket & {total:number})[]>(
      `SELECT COUNT(*) AS total FROM customers c ${where}`, params);
    return jsonNoStore({
      data: rows.map(row => ({
        id:row.id,customerCode:row.customer_code,name:row.name,email:row.email,phone:row.phone,
        billingAddress:parseJson(row.billing_address_json),shippingAddress:parseJson(row.shipping_address_json),
        purchaseOrderReference:row.purchase_order_reference,paymentTermsDays:row.payment_terms_days===null?null:Number(row.payment_terms_days),
        ...(canReadSensitive ? { taxIdentifier:row.tax_identifier } : {}),isActive:Boolean(row.is_active),recordVersion:Number(row.record_version),
        archivedAt:row.archived_at,createdAt:row.created_at,updatedAt:row.updated_at,
      })),
      pagination:{limit,offset,total:Number(countRow.total),hasMore:offset+rows.length<Number(countRow.total)},
    });
  } catch(error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await assertCsrf(request);
    const actor = await requirePermission("customers:create");
    const parsed = customerCreateSchema.parse(await request.json());
    if(parsed.notes!==undefined&&!actor.permissions.includes("settings:manage"))return jsonNoStore({error:{code:"FORBIDDEN",message:"Internal notes are restricted to finance/settings administrators."}},403);
    const id = randomUUID();
    const email = parsed.email?.trim().toLowerCase() || null;
    const phone = parsed.phone?.trim() || null;
    const taxIdentifier = parsed.taxIdentifier?.trim() || null;
    const customerCode = parsed.customerCode?.trim() || null;
    const billingAddress = parsed.billingAddress ? JSON.stringify(parsed.billingAddress) : null;
    const shippingAddress = parsed.shippingAddress ? JSON.stringify(parsed.shippingAddress) : null;
    if (!actor.permissions.includes("settings:manage") && (Boolean(taxIdentifier) || (parsed.taxIdentifiers?.length ?? 0) > 0)) {
      return jsonNoStore({ error: { code: "FORBIDDEN", message: "Customer tax identifiers are restricted to finance/settings administrators." } }, 403);
    }
    const duplicateWarnings = await findCustomerDuplicates({name:parsed.name,email,phone,taxIdentifier,taxIdentifiers:(parsed.taxIdentifiers??[]).map(item=>item.identifierValue),customerCode});
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute<ResultSetHeader>(
        `INSERT INTO customers
          (id,customer_code,name,email,phone,billing_address_json,shipping_address_json,purchase_order_reference,
           payment_terms_days,tax_identifier,notes,is_active,record_version,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,TRUE,1,?,?)`,
        [id,customerCode,parsed.name,email,phone,billingAddress,shippingAddress,
         parsed.purchaseOrderReference?.trim()||null,parsed.paymentTermsDays??null,taxIdentifier,parsed.notes??null,actor.userId,actor.userId],
      );
      for(const contact of parsed.contacts??[]){
        await connection.execute(
          `INSERT INTO customer_contacts (id,customer_id,full_name,job_title,email,phone,is_primary)
           VALUES (?,?,?,?,?,?,?)`,
          [randomUUID(),id,contact.fullName,contact.jobTitle?.trim()||null,contact.email?.trim().toLowerCase()||null,contact.phone?.trim()||null,contact.isPrimary?1:0]);
      }
      if((parsed.contacts??[]).filter(c=>c.isPrimary).length>1) throw new Error("Only one primary customer contact is allowed");
      for(const tax of parsed.taxIdentifiers??[]){
        const raw=tax.identifierValue.trim();
        await connection.execute(
          `INSERT INTO customer_tax_identifiers
           (id,customer_id,identifier_type,country_code,jurisdiction,identifier_value,normalized_identifier,created_by)
           VALUES (?,?,?,?,?,?,?,?)`,
          [randomUUID(),id,tax.identifierType.trim().toUpperCase(),tax.countryCode?.trim().toUpperCase()||null,tax.jurisdiction?.trim()||null,raw,normalizeIdentifier(raw),actor.userId]);
      }
      await connection.execute(
        `INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,after_json)
         VALUES (?,?,'customer.created','customer',?,'SUCCESS',?)`,
        [randomUUID(),actor.userId,id,JSON.stringify({changedFields:(["customerCode","name","email","phone","billingAddress","shippingAddress","purchaseOrderReference","paymentTermsDays","taxIdentifier","contacts","taxIdentifiers","notes"] as const)
          .filter(key=>{const value=parsed[key];return value!==undefined&&value!==null&&!(typeof value==="string"&&!value.trim())&&!(Array.isArray(value)&&!value.length)})})]);
      await connection.commit();
    } catch(error) {
      await connection.rollback();
      if(duplicateEntry(error)) return jsonNoStore({error:{code:"DUPLICATE_RECORD",message:"A customer code is already in use. Review existing records before retrying."}},409);
      throw error;
    } finally { connection.release(); }
    return jsonNoStore({data:{
      id,customerCode,name:parsed.name,email,phone,billingAddress:parsed.billingAddress??null,shippingAddress:parsed.shippingAddress??null,
      purchaseOrderReference:parsed.purchaseOrderReference?.trim()||null,paymentTermsDays:parsed.paymentTermsDays??null,
      taxIdentifier,contacts:(parsed.contacts??[]).map(c=>({...c,email:c.email?.trim().toLowerCase()||null})),
      taxIdentifiers:(parsed.taxIdentifiers??[]).map(t=>({...t,normalizedIdentifier:normalizeIdentifier(t.identifierValue)})),
      isActive:true,recordVersion:1,
    },duplicateWarnings},201);
  } catch(error) { return apiError(error); }
}
