import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { requireFinanceConfigurationApprover } from "@/lib/configuration/authorization";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { legalEntityCreateSchema } from "@/lib/validation/configuration";
import { captureLegalEntityConfigVersion, loadEntity, publicLegalEntity, recordAudit } from "@/lib/configuration/service";
import { seedEntityPolicyDecisions } from "@/lib/configuration/policy-decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission("settings:manage");
    const query = (request.nextUrl.searchParams.get("query") ?? "").trim().slice(0, 100);
    const status = request.nextUrl.searchParams.get("status") ?? "active";
    if (!["active", "inactive", "all"].includes(status)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "status must be active, inactive, or all" } }, 400);
    }
    const scopes = [...new Set(actor.legalEntityIds)];
    if (!scopes.length) return jsonNoStore({ data: [], pagination: { limit: 100, offset: 0, hasMore: false } });
    const clauses = [`id IN (${scopes.map(() => "?").join(",")})`];
    const params: unknown[] = [...scopes];
    if (status !== "all") { clauses.push("is_active = ?"); params.push(status === "active" ? 1 : 0); }
    if (query) { clauses.push("(legal_name LIKE ? OR display_name LIKE ?)"); const escaped=query.replace(/[\\\\%_]/g,"\\\\$&"); params.push(`%${escaped}%`, `%${escaped}%`); }
    const limitRaw=Number(request.nextUrl.searchParams.get("limit") ?? "100");
    const offsetRaw=Number(request.nextUrl.searchParams.get("offset") ?? "0");
    if (!Number.isInteger(limitRaw)||limitRaw<1||limitRaw>100||!Number.isSafeInteger(offsetRaw)||offsetRaw<0||offsetRaw>1000000) {
      return jsonNoStore({ error: { code:"VALIDATION_ERROR", message:"limit must be 1–100 and offset must be between 0 and 1000000" } },400);
    }
    const [rows]=await pool.query<(RowDataPacket & {id:string})[]>(
      `SELECT id, legal_name, display_name, registration_number, tax_identifier, address_json, billing_address_json, country_code,
        invoice_email, invoice_phone, website, currency, locale, time_zone, logo_reference, bank_details_json,
        invoice_terms, invoice_footer, default_tax_code, tax_setup_status, tax_setup_approval_reference,
        is_active, created_at, updated_at
       FROM legal_entities WHERE ${clauses.join(" AND ")} ORDER BY display_name,id LIMIT ? OFFSET ?`,
      [...params,limitRaw,offsetRaw]);
    return jsonNoStore({ data: rows.map((row)=>publicLegalEntity(row as never)), pagination:{limit:limitRaw,offset:offsetRaw,hasMore:rows.length===limitRaw} });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await assertCsrf(request);
    const actor=await requirePermission("settings:manage");
    const input=legalEntityCreateSchema.parse(await request.json());
    if (input.taxSetupStatus !== "UNCONFIGURED" || input.bankDetails) requireFinanceConfigurationApprover(actor);
    const id=randomUUID();
    const conn=await pool.getConnection();
    let output;
    try {
      await conn.beginTransaction();
      await conn.execute<ResultSetHeader>(
        `INSERT INTO legal_entities
         (id,legal_name,display_name,registration_number,tax_identifier,address_json,billing_address_json,country_code,invoice_email,invoice_phone,
          website,currency,locale,time_zone,logo_reference,bank_details_json,invoice_terms,invoice_footer,default_tax_code,
          tax_setup_status,tax_setup_approval_reference,tax_setup_approved_by,tax_setup_approved_at,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,TRUE)`,
        [id,input.legalName,input.displayName,input.registrationNumber||null,input.taxIdentifier||null,JSON.stringify(input.address),input.billingAddress?JSON.stringify(input.billingAddress):null,
          input.countryCode,input.invoiceEmail||null,input.invoicePhone||null,input.website||null,input.currency,
          input.locale||null,input.timeZone||null,input.logoReference||null,input.bankDetails?JSON.stringify(input.bankDetails):null,
          input.invoiceTerms??null,input.invoiceFooter??null,input.defaultTaxCode||null,input.taxSetupStatus,
          input.taxSetupStatus==="UNCONFIGURED"?null:input.taxSetupApprovalReference||null,
          input.taxSetupStatus==="UNCONFIGURED"?null:actor.userId,input.taxSetupStatus==="UNCONFIGURED"?null:new Date()]);
      // The creator receives explicit scope only to the entity they just created.
      await conn.execute(
        "INSERT INTO user_legal_entity_access (user_id,legal_entity_id,granted_by) VALUES (?,?,?)",
        [actor.userId,id,actor.userId]);
      const row=await loadEntity(conn,id);
      if(!row) throw new Error("Configuration creation failed");
      const version=await captureLegalEntityConfigVersion(conn,row,actor.userId,input.changeReason);
      await seedEntityPolicyDecisions(conn,id);
      await recordAudit(conn,actor.userId,"legal_entity.created","legal_entity",id,input.changeReason,null,
        { ...publicLegalEntity(row), configVersion: version.versionNumber });
      output=publicLegalEntity(row);
      await conn.commit();
    } catch(error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
    return jsonNoStore({data:output},201);
  } catch(error) { return apiError(error); }
}
