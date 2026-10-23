import { randomUUID } from "node:crypto";
import { BRAND_LOGO_ASSETS } from "@/lib/brand-assets";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { requireFinanceConfigurationApprover } from "@/lib/configuration/authorization";
import { assertCsrf } from "@/lib/auth/csrf";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { legalEntityCreateSchema } from "@/lib/validation/configuration";
import { canonicalJson, captureLegalEntityConfigVersion, loadEntity, publicLegalEntity, recordAudit } from "@/lib/configuration/service";
import { seedEntityPolicyDecisions } from "@/lib/configuration/policy-decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfigConnection = Awaited<ReturnType<typeof pool.getConnection>>;
const INITIAL_BRAND_REASON = "Initial product-brand provisioning for the first legal entity";

function parseTheme(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

/**
 * Product logos are shipped with the application, but brands themselves are database records.
 * On a truly empty legal-entity configuration, create/map the three established product brands
 * to the first supplier entity so the normal invoice composer can use them without manual brand
 * entry. Never invent tax, bank, registration, numbering, or legal-company values.
 */
async function provisionInitialProductBrands(
  conn: ConfigConnection,
  legalEntityId: string,
  actorUserId: string,
): Promise<void> {
  const productAssets = BRAND_LOGO_ASSETS.filter((asset) => asset.audience === "Product");
  for (const asset of productAssets) {
    const proposedId = randomUUID();
    const defaultTheme = { accentColor: asset.accentColor, presentationStyle: "STANDARD" };
    await conn.execute<ResultSetHeader>(
      `INSERT INTO brands
       (id,name,code,description,logo_reference,theme_json,default_template_key,is_active)
       VALUES (?,?,?,?,?,?,NULL,TRUE)
       ON DUPLICATE KEY UPDATE
         description=COALESCE(NULLIF(description,''),VALUES(description)),
         logo_reference=COALESCE(NULLIF(logo_reference,''),VALUES(logo_reference)),
         theme_json=COALESCE(theme_json,VALUES(theme_json)),
         is_active=TRUE`,
      [proposedId, asset.name, asset.code, "Falchion Xeniaa product brand", asset.logoReference, JSON.stringify(defaultTheme)],
    );

    const [brandRows] = await conn.execute<(RowDataPacket & {
      id: string; name: string; code: string; description: string | null; logo_reference: string | null;
      theme_json: unknown; default_template_key: string | null; is_active: number;
    })[]>(
      `SELECT id,name,code,description,logo_reference,theme_json,default_template_key,is_active
       FROM brands WHERE code=? LIMIT 1 FOR UPDATE`,
      [asset.code],
    );
    const brand = brandRows[0];
    if (!brand) throw new Error("Initial product-brand provisioning failed");

    await conn.execute<ResultSetHeader>(
      `INSERT INTO brand_legal_entities (brand_id,legal_entity_id,is_default,effective_from)
       VALUES (?,?,TRUE,CURDATE())`,
      [brand.id, legalEntityId],
    );

    const [versionRows] = await conn.execute<(RowDataPacket & { version_number: number })[]>(
      "SELECT version_number FROM brand_config_versions WHERE brand_id=? ORDER BY version_number DESC LIMIT 1 FOR UPDATE",
      [brand.id],
    );
    const versionNumber = Number(versionRows[0]?.version_number ?? 0) + 1;
    const snapshot = {
      schemaVersion: 1,
      brandId: brand.id,
      name: brand.name,
      code: brand.code,
      description: brand.description,
      logoReference: brand.logo_reference ?? asset.logoReference,
      theme: parseTheme(brand.theme_json) ?? defaultTheme,
      defaultTemplateKey: brand.default_template_key,
      isActive: Boolean(brand.is_active),
      legalEntityIds: [legalEntityId],
    };
    await conn.execute<ResultSetHeader>(
      `INSERT INTO brand_config_versions
       (id,brand_id,version_number,effective_from,config_snapshot,change_reason,changed_by)
       VALUES (?,?,?,NOW(3),?,?,?)`,
      [randomUUID(), brand.id, versionNumber, canonicalJson(snapshot), INITIAL_BRAND_REASON, actorUserId],
    );
    await recordAudit(
      conn,
      actorUserId,
      "brand.initial_product_brand_provisioned",
      "brand",
      brand.id,
      INITIAL_BRAND_REASON,
      null,
      { ...snapshot, configVersion: versionNumber },
    );
  }
}

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
  let stage = "CSRF validation";
  try {
    await assertCsrf(request);
    stage = "permission check";
    const actor = await requirePermission("settings:manage");
    stage = "validate company fields";
    const input=legalEntityCreateSchema.parse(await request.json());
    stage = "check finance approval";
    if (input.taxSetupStatus !== "UNCONFIGURED" || input.bankDetails) requireFinanceConfigurationApprover(actor);
    const id=randomUUID();
    stage = "open database connection";
    const conn=await pool.getConnection();
    let output;
    try {
      stage = "begin company transaction";
      await conn.beginTransaction();
      stage = "check whether this is the first legal entity";
      // Only the first legal entity triggers one-time provisioning of the known product brands.
      // Additional entities require deliberate mappings rather than inheriting every brand.
      const [existingEntityRows] = await conn.query<(RowDataPacket & { id: string })[]>(
        "SELECT id FROM legal_entities ORDER BY id LIMIT 1 FOR UPDATE",
      );
      const isFirstLegalEntity = existingEntityRows.length === 0;
      stage = "insert legal entity";
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
      stage = "grant creator access to legal entity";
      await conn.execute(
        "INSERT INTO user_legal_entity_access (user_id,legal_entity_id,granted_by) VALUES (?,?,?)",
        [actor.userId,id,actor.userId]);
      if (isFirstLegalEntity) {
        stage = "provision MyFX POS, FX Digitech and FX Coworks";
        await provisionInitialProductBrands(conn,id,actor.userId);
      }
      stage = "load company profile";
      const row=await loadEntity(conn,id);
      if(!row) throw new Error("Configuration creation failed");
      stage = "capture company configuration version";
      const version=await captureLegalEntityConfigVersion(conn,row,actor.userId,input.changeReason);
      stage = "seed required invoice policy decisions";
      await seedEntityPolicyDecisions(conn,id);
      stage = "record company audit event";
      await recordAudit(conn,actor.userId,"legal_entity.created","legal_entity",id,input.changeReason,null,
        { ...publicLegalEntity(row), configVersion: version.versionNumber });
      output=publicLegalEntity(row);
      stage = "commit company transaction";
      await conn.commit();
    } catch(error) {
      await conn.rollback();
      throw error;
    } finally { conn.release(); }
    return jsonNoStore({data:output},201);
  } catch(error) {
    const failure = error && typeof error === "object" ? error as {code?:unknown;errno?:unknown;sqlState?:unknown} : {};
    if (!(error instanceof Error && error.name === "ZodError")) {
      console.error("Legal entity setup failed", {
        stage,
        errorName: error instanceof Error ? error.name : typeof error,
        databaseCode: typeof failure.code === "string" ? failure.code : undefined,
        databaseErrno: typeof failure.errno === "number" ? failure.errno : undefined,
        databaseSqlState: typeof failure.sqlState === "string" ? failure.sqlState : undefined,
      });
    }
    return apiError(error);
  }
}
