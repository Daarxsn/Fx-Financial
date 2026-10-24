import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "@/lib/db/pool";
import { ConfigurationConflictError, ConfigurationNotReadyError } from "@/lib/configuration/errors";
import { isProductBrandLegalEntityName } from "@/lib/brand-assets";

export type LegalEntityRecord = RowDataPacket & {
  id: string; legal_name: string; display_name: string; registration_number: string | null; tax_identifier: string | null;
  address_json: unknown; billing_address_json: unknown; country_code: string | null; invoice_email: string | null; invoice_phone: string | null;
  website: string | null; currency: string; locale: string | null; time_zone: string | null;
  logo_reference: string | null; signature_reference: string | null; bank_details_json: unknown; invoice_terms: string | null; invoice_footer: string | null;
  default_tax_code: string | null; tax_setup_status: string; tax_setup_approval_reference: string | null;
  tax_setup_approved_by: string | null; tax_setup_approved_at: Date | null;
  is_active: number; created_at: Date; updated_at: Date;
};

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function jsonValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* malformed stored JSON is handled as an empty, not-ready address */ }
  }
  return {};
}

/** Never return raw bank details from general list/detail APIs. */
export function publicLegalEntity(row: LegalEntityRecord) {
  const bank = jsonValue(row.bank_details_json);
  const accountNumber = typeof bank.accountNumber === "string" ? bank.accountNumber : "";
  return {
    id: row.id, legalName: row.legal_name, displayName: row.display_name,
    registrationNumber: row.registration_number, taxIdentifier: row.tax_identifier,
    address: jsonValue(row.address_json), billingAddress: row.billing_address_json == null ? null : jsonValue(row.billing_address_json), countryCode: row.country_code,
    invoiceEmail: row.invoice_email, invoicePhone: row.invoice_phone, website: row.website,
    currency: row.currency, locale: row.locale, timeZone: row.time_zone, logoReference: row.logo_reference, signatureConfigured:Boolean(row.signature_reference),
    bankDetailsConfigured: Object.values(bank).some((v) => typeof v === "string" && v.trim().length > 0),
    bankAccountLast4: accountNumber.length >= 4 ? accountNumber.slice(-4) : null,
    invoiceTerms: row.invoice_terms, invoiceFooter: row.invoice_footer, defaultTaxCode: row.default_tax_code,
    taxSetupStatus: row.tax_setup_status, taxSetupApprovalReference: row.tax_setup_approval_reference,
    taxSetupApprovedBy: row.tax_setup_approved_by, taxSetupApprovedAt: row.tax_setup_approved_at,
    isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function recordAudit(
  conn: PoolConnection,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await conn.execute(
    `INSERT INTO audit_events
      (id, actor_id, action, entity_type, entity_id, outcome, before_json, after_json, correlation_id, change_reason)
     VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?)`,
    [randomUUID(), actorId, action, entityType, entityId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
      randomUUID(), reason.trim().slice(0, 1000)],
  );
}

export async function loadEntity(conn: PoolConnection, id: string): Promise<LegalEntityRecord | null> {
  const [rows] = await conn.execute<LegalEntityRecord[]>(
    `SELECT id, legal_name, display_name, registration_number, tax_identifier, address_json, billing_address_json, country_code,
      invoice_email, invoice_phone, website, currency, locale, time_zone, logo_reference, signature_reference, bank_details_json,
      invoice_terms, invoice_footer, default_tax_code, tax_setup_status, tax_setup_approval_reference,
      tax_setup_approved_by, tax_setup_approved_at, is_active, created_at, updated_at
     FROM legal_entities WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function captureLegalEntityConfigVersion(
  conn: PoolConnection, row: LegalEntityRecord, actorId: string, reason: string,
): Promise<{ id: string; versionNumber: number; snapshot: Record<string, unknown> }> {
  const [prior] = await conn.execute<(RowDataPacket & { version_number: number })[]>(
    "SELECT version_number FROM legal_entity_config_versions WHERE legal_entity_id = ? ORDER BY version_number DESC LIMIT 1 FOR UPDATE",
    [row.id],
  );
  const versionNumber = Number(prior[0]?.version_number ?? 0) + 1;
  const snapshot = {
    schemaVersion: 1, legalEntityId: row.id, legalName: row.legal_name, displayName: row.display_name,
    registrationNumber: row.registration_number, taxIdentifier: row.tax_identifier, address: jsonValue(row.address_json),
    billingAddress: row.billing_address_json == null ? null : jsonValue(row.billing_address_json), countryCode: row.country_code, invoiceEmail: row.invoice_email, invoicePhone: row.invoice_phone,
    website: row.website, currency: row.currency, locale: row.locale, timeZone: row.time_zone,
    logoReference: row.logo_reference, signatureReference: row.signature_reference, bankDetails: jsonValue(row.bank_details_json),
    invoiceTerms: row.invoice_terms, invoiceFooter: row.invoice_footer, defaultTaxCode: row.default_tax_code,
    taxSetupStatus: row.tax_setup_status, taxSetupApprovalReference: row.tax_setup_approval_reference,
    taxSetupApprovedBy: row.tax_setup_approved_by, taxSetupApprovedAt: row.tax_setup_approved_at,
    isActive: Boolean(row.is_active),
  };
  const serialized = canonicalJson(snapshot);
  const id = randomUUID();
  await conn.execute(
    `INSERT INTO legal_entity_config_versions
      (id, legal_entity_id, version_number, effective_from, config_snapshot, change_reason, changed_by)
     VALUES (?, ?, ?, NOW(3), ?, ?, ?)`,
    [id, row.id, versionNumber, serialized, reason, actorId],
  );
  return { id, versionNumber, snapshot };
}

export async function assertEntityScope(actor: { legalEntityIds: string[] }, legalEntityId: string) {
  if (!actor.legalEntityIds.includes(legalEntityId)) {
    const error = new Error("FORBIDDEN");
    error.name = "EntityScopeError";
    throw error;
  }
}

/** Calendar date for readiness checks, using the entity's configured IANA timezone.
 * Unconfigured entities follow the product default, Asia/Kolkata. Invalid configured zones
 * return null so readiness can fail closed rather than silently using the server's date.
 */
export function calendarDateInTimeZone(timeZone: string | null | undefined, now = new Date()): string | null {
  const zone = timeZone?.trim() || "Asia/Kolkata";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const read = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
    const value = `${read("year")}-${read("month")}-${read("day")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function readinessForEntity(legalEntityId: string) {
  const entity = await loadEntityFromPool(legalEntityId);
  if (!entity) return { legalEntityId, ready: false, checks: [{ key: "entity", passed: false, message: "Legal entity was not found or is outside the available scope." }] };

  const configuredBusinessDate = calendarDateInTimeZone(entity.time_zone);
  const fallbackBusinessDate = calendarDateInTimeZone("Asia/Kolkata");
  const effectiveDate = configuredBusinessDate ?? fallbackBusinessDate;
  if (effectiveDate === null) {
    return { legalEntityId, ready: false, checks: [{ key: "businessDate", passed: false, message: "The business date could not be calculated." }] };
  }

  const address = jsonValue(entity.address_json);
  const checks: { key: string; passed: boolean; message: string }[] = [
    { key: "active", passed: Boolean(entity.is_active), message: "Legal entity must be active." },
    { key: "legalName", passed: Boolean(entity.legal_name.trim()), message: "Legal supplier name is required." },
    { key: "address", passed: Boolean(address.line1 && address.city && address.postalCode && address.countryCode && entity.country_code), message: "Registered address must include line 1, city, postal code, and country." },
    { key: "currency", passed: /^[A-Z]{3}$/.test(entity.currency), message: "An explicit document currency must be configured." },
    { key: "businessDate", passed: configuredBusinessDate !== null, message: "The configured business timezone must be valid to evaluate effective-dated settings." },
    { key: "taxApproval", passed: entity.tax_setup_status !== "UNCONFIGURED" && Boolean(entity.tax_setup_approval_reference) && Boolean(entity.tax_setup_approved_by) && Boolean(entity.tax_setup_approved_at), message: "Tax setup must have a recorded finance approver, timestamp and approval reference, including an explicit not-applicable decision where appropriate." },
  ];

  const [versionRows] = await pool.execute<(RowDataPacket & { n: number })[]>(
    "SELECT COUNT(*) AS n FROM legal_entity_config_versions WHERE legal_entity_id = ?", [legalEntityId]);
  checks.push({ key: "configurationVersion", passed: Number(versionRows[0]?.n ?? 0) > 0, message: "An initial versioned configuration snapshot must be recorded before issuance." });

  // A rule and registration in unrelated jurisdictions do not form a usable tax setup.
  const [compatibleTaxRows] = await pool.execute<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n
       FROM tax_rules r
      WHERE r.legal_entity_id = ? AND r.is_active = TRUE AND r.approved_at IS NOT NULL
        AND r.approval_reference IS NOT NULL AND r.effective_from <= ?
        AND (r.effective_until IS NULL OR r.effective_until >= ?)
        AND EXISTS (
          SELECT 1 FROM legal_entity_tax_registrations tr
           WHERE tr.legal_entity_id = r.legal_entity_id
             AND LOWER(TRIM(tr.jurisdiction)) = LOWER(TRIM(r.jurisdiction))
             AND tr.is_active = TRUE AND tr.approved_at IS NOT NULL AND tr.approval_reference IS NOT NULL
             AND tr.effective_from <= ?
             AND (tr.effective_until IS NULL OR tr.effective_until >= ?)
        )`, [legalEntityId, effectiveDate, effectiveDate, effectiveDate, effectiveDate]);
  const hasCompatibleTaxAndRegistration = Number(compatibleTaxRows[0]?.n ?? 0) > 0;
  checks.push({
    key: "taxRules",
    passed: entity.tax_setup_status === "APPROVED_NOT_APPLICABLE" ||
      (entity.tax_setup_status === "APPROVED_CONFIGURED" && hasCompatibleTaxAndRegistration),
    message: "Approved tax setup requires an effective approved tax rule paired with an approved registration for the same jurisdiction, or an explicitly approved not-applicable decision.",
  });

  if (entity.default_tax_code && entity.tax_setup_status === "APPROVED_CONFIGURED") {
    const [defaultTaxRows] = await pool.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n
         FROM tax_rules r
        WHERE r.legal_entity_id = ? AND r.tax_code = ? AND r.is_active = TRUE
          AND r.approved_at IS NOT NULL AND r.approval_reference IS NOT NULL
          AND r.effective_from <= ?
          AND (r.effective_until IS NULL OR r.effective_until >= ?)
          AND EXISTS (
            SELECT 1 FROM legal_entity_tax_registrations tr
             WHERE tr.legal_entity_id = r.legal_entity_id
               AND LOWER(TRIM(tr.jurisdiction)) = LOWER(TRIM(r.jurisdiction))
               AND tr.is_active = TRUE AND tr.approved_at IS NOT NULL AND tr.approval_reference IS NOT NULL
               AND tr.effective_from <= ?
               AND (tr.effective_until IS NULL OR tr.effective_until >= ?)
          )`, [legalEntityId, entity.default_tax_code, effectiveDate, effectiveDate, effectiveDate, effectiveDate]);
    checks.push({ key: "defaultTaxCode", passed: Number(defaultTaxRows[0]?.n ?? 0) === 1,
      message: "The configured default tax code must resolve to exactly one active, approved, effective tax rule with a matching approved registration for the same jurisdiction." });
  }

  const [numberingRows] = await pool.execute<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM invoice_numbering_configs
      WHERE legal_entity_id = ? AND document_type = 'INVOICE' AND is_active = TRUE AND effective_from <= ?
        AND (effective_until IS NULL OR effective_until >= ?)
        AND approval_reference IS NOT NULL`, [legalEntityId, effectiveDate, effectiveDate]);
  checks.push({ key: "numbering", passed: Number(numberingRows[0]?.n ?? 0) === 1, message: "Exactly one active, approved invoice numbering series must be effective." });

  const [templateRows] = await pool.execute<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM invoice_document_templates
      WHERE legal_entity_id = ? AND brand_id IS NULL AND document_type = 'INVOICE' AND is_active = TRUE
        AND effective_from <= ? AND (effective_until IS NULL OR effective_until >= ?)`, [legalEntityId, effectiveDate, effectiveDate]);
  checks.push({ key: "invoiceTemplate", passed: Number(templateRows[0]?.n ?? 0) === 1, message: "Exactly one active invoice template must be effective today." });

  return { legalEntityId, ready: checks.every((check) => check.passed), checks };
}


export type DocumentConfigurationRequest = {
  resourceType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "QUOTATION";
  resourceId: string;
  legalEntityId: string;
  brandId?: string | null;
  documentDate: string;
  actorId: string;
  taxRuleIds: string[];
  taxRegistrationIds: string[];
};

function yearLabel(documentDate: string, startMonth: number, startDay: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(documentDate);
  if (!match) throw new ConfigurationNotReadyError("Document date must use YYYY-MM-DD.");
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    throw new ConfigurationNotReadyError("Document date is not a valid calendar date.");
  }
  const startYear = month > startMonth || (month === startMonth && day >= startDay) ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

/**
 * Allocates a number inside the caller's transaction. Locking the parent legal entity serializes
 * reservations for that entity, including the first insert into an otherwise-empty sequence table.
 */
export async function reserveDocumentNumber(
  conn: PoolConnection,
  legalEntityId: string,
  documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "QUOTATION",
  documentDate: string,
): Promise<{ number: string; numberingConfigId: string; configuration: Record<string, unknown>; financialYearLabel: string; sequenceValue: number }> {
  const [entities] = await conn.execute<(RowDataPacket & { is_active: number })[]>(
    "SELECT is_active FROM legal_entities WHERE id = ? FOR UPDATE", [legalEntityId]);
  if (!entities.length || !entities[0].is_active) throw new ConfigurationNotReadyError("The legal entity is missing or inactive.");
  const [rows] = await conn.execute<(RowDataPacket & {
    id: string; series_code: string; prefix: string; suffix: string; sequence_width: number;
    include_financial_year: number; financial_year_start_month: number; financial_year_start_day: number;
    time_zone: string; version_number: number; effective_from: Date; effective_until: Date | null; approval_reference: string | null;
  })[]>(
    `SELECT id,series_code,prefix,suffix,sequence_width,include_financial_year,financial_year_start_month,
      financial_year_start_day,time_zone,version_number,effective_from,effective_until,approval_reference
     FROM invoice_numbering_configs
     WHERE legal_entity_id = ? AND document_type = ? AND is_active = TRUE AND approval_reference IS NOT NULL
       AND effective_from <= ? AND (effective_until IS NULL OR effective_until >= ?)
     ORDER BY version_number DESC FOR UPDATE`,
    [legalEntityId, documentType, documentDate, documentDate]);
  if (rows.length !== 1) throw new ConfigurationNotReadyError("Exactly one approved, active numbering series must be effective for this document date.");
  const row = rows[0];
  const label = yearLabel(documentDate, Number(row.financial_year_start_month), Number(row.financial_year_start_day));
  await conn.execute(
    `INSERT INTO invoice_number_sequences (legal_entity_id,document_type,financial_year_label,next_value)
     VALUES (?,?,?,2)
     ON DUPLICATE KEY UPDATE next_value = next_value + 1`,
    [legalEntityId, documentType, label]);
  const [sequenceRows] = await conn.execute<(RowDataPacket & { next_value: string | number })[]>(
    "SELECT next_value FROM invoice_number_sequences WHERE legal_entity_id=? AND document_type=? AND financial_year_label=? FOR UPDATE",
    [legalEntityId, documentType, label]);
  const nextValue = Number(sequenceRows[0]?.next_value);
  const allocated = nextValue - 1;
  if (!Number.isSafeInteger(allocated) || allocated < 1) throw new ConfigurationConflictError("Number series returned an invalid sequence value.");
  const display = `${row.prefix}${row.include_financial_year ? label : ""}${String(allocated).padStart(Number(row.sequence_width), "0")}${row.suffix}`;
  const configuration = {
    id: row.id, seriesCode: row.series_code, prefix: row.prefix, suffix: row.suffix,
    sequenceWidth: Number(row.sequence_width), includeFinancialYear: Boolean(row.include_financial_year),
    financialYearStartMonth: Number(row.financial_year_start_month),
    financialYearStartDay: Number(row.financial_year_start_day), timeZone: row.time_zone,
    versionNumber: Number(row.version_number), effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until, approvalReference: row.approval_reference,
    sequenceScope: "ENTITY_FINANCIAL_YEAR_DOCUMENT_TYPE",
  };
  return { number: display, numberingConfigId: row.id, configuration, financialYearLabel: label, sequenceValue: allocated };
}

/**
 * Validates and freezes the exact configuration used by an issuance transaction.
 * Call only inside the same DB transaction that creates/issues the business document.
 * No business entity, tax rate, bank value or template is invented by this function.
 */
export async function captureDocumentConfigurationSnapshot(
  conn: PoolConnection,
  input: DocumentConfigurationRequest,
): Promise<{ snapshotId: string; sha256: string; invoiceNumber: string; numberingConfigId: string; templateId: string; taxRuleIds: string[] }> {
  const [existingSnapshots] = await conn.execute<(RowDataPacket & { id: string })[]>(
    "SELECT id FROM document_configuration_snapshots WHERE resource_type=? AND resource_id=? LIMIT 1 FOR UPDATE",
    [input.resourceType, input.resourceId]);
  if (existingSnapshots.length) throw new ConfigurationConflictError("A configuration snapshot already exists for this issued document.");

  const [entities] = await conn.execute<(RowDataPacket & {
    id: string; legal_name: string; display_name: string; registration_number: string | null; tax_identifier: string | null;
    address_json: unknown; billing_address_json: unknown; country_code: string | null; currency: string; locale: string | null; time_zone: string | null;
    logo_reference: string | null; bank_details_json: unknown; invoice_terms: string | null; invoice_footer: string | null;
    default_tax_code: string | null; tax_setup_status: string; tax_setup_approval_reference: string | null;
    tax_setup_approved_by: string | null; tax_setup_approved_at: Date | null; is_active: number;
  })[]>(
    `SELECT id,legal_name,display_name,registration_number,tax_identifier,address_json,billing_address_json,country_code,currency,locale,time_zone,
      logo_reference,bank_details_json,invoice_terms,invoice_footer,default_tax_code,tax_setup_status,
      tax_setup_approval_reference,tax_setup_approved_by,tax_setup_approved_at,is_active FROM legal_entities WHERE id=? FOR UPDATE`, [input.legalEntityId]);
  const entity = entities[0];
  if (!entity || !entity.is_active) throw new ConfigurationNotReadyError("The legal entity does not exist or is inactive.");
  if (isProductBrandLegalEntityName(entity.legal_name) || isProductBrandLegalEntityName(entity.display_name)) {
    throw new ConfigurationNotReadyError("A product brand cannot be used as the legal supplier. Verify the registered Falchion Xeniaa supplier profile and reconcile product-brand mappings in Settings before issuing.");
  }
  if (entity.tax_setup_status === "UNCONFIGURED" || !entity.tax_setup_approval_reference ||
      !entity.tax_setup_approved_by || !entity.tax_setup_approved_at) {
    throw new ConfigurationNotReadyError("Tax setup has no recorded finance/tax decision.");
  }
  const address = jsonValue(entity.address_json);
  if (!entity.legal_name.trim() || !/^[A-Z]{3}$/.test(entity.currency) ||
      !address.line1 || !address.city || !address.postalCode || !address.countryCode || !entity.country_code) {
    throw new ConfigurationNotReadyError("Legal supplier identity, registered address, country and currency must be complete.");
  }
  const [entityVersions] = await conn.execute<(RowDataPacket & { id: string; version_number: number; config_snapshot: unknown })[]>(
    `SELECT id,version_number,config_snapshot FROM legal_entity_config_versions
      WHERE legal_entity_id=? AND effective_from<=NOW(3) ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [input.legalEntityId]);
  if (!entityVersions.length) throw new ConfigurationNotReadyError("No versioned legal-entity configuration exists. Save and approve the initial configuration before issuing documents.");

  let brandSnapshot: unknown = null; let brandVersionId: string | null = null;
  if (input.brandId) {
    const [mappings] = await conn.execute<(RowDataPacket & { is_active: number })[]>(
      `SELECT b.is_active FROM brand_legal_entities m JOIN brands b ON b.id=m.brand_id
        WHERE m.brand_id=? AND m.legal_entity_id=? AND m.effective_from<=NOW(3) AND (m.effective_until IS NULL OR m.effective_until>NOW(3)) LIMIT 1 FOR UPDATE`, [input.brandId, input.legalEntityId]);
    if (!mappings.length || !mappings[0].is_active) throw new ConfigurationNotReadyError("The selected brand is inactive or is not explicitly mapped to this legal entity.");
    const [brandVersions] = await conn.execute<(RowDataPacket & { id: string; config_snapshot: unknown })[]>(
      `SELECT v.id,v.config_snapshot FROM brand_config_versions v
        WHERE v.brand_id=? AND v.effective_from<=NOW(3) ORDER BY v.version_number DESC LIMIT 1 FOR UPDATE`, [input.brandId]);
    if (!brandVersions.length) throw new ConfigurationNotReadyError("The selected brand has no versioned configuration.");
    brandSnapshot = jsonValue(brandVersions[0].config_snapshot);
    brandVersionId = brandVersions[0].id;
  }

  const [effectiveTaxRows] = await conn.execute<(RowDataPacket & { id: string; tax_code: string; display_name: string; jurisdiction: string; rate: string; calculation_mode: string; effective_from: Date; effective_until: Date | null; approval_reference: string | null })[]>(
    `SELECT id,tax_code,display_name,jurisdiction,rate,calculation_mode,effective_from,effective_until,approval_reference
      FROM tax_rules WHERE legal_entity_id=? AND is_active=TRUE AND approved_at IS NOT NULL AND approval_reference IS NOT NULL
        AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
      ORDER BY tax_code,id FOR UPDATE`, [input.legalEntityId, input.documentDate, input.documentDate]);
  if (entity.tax_setup_status === "APPROVED_CONFIGURED" && effectiveTaxRows.length === 0) {
    throw new ConfigurationNotReadyError("No approved tax rule is effective for the document date.");
  }
  const taxIds = [...new Set(input.taxRuleIds)];
  const registrationIds = [...new Set(input.taxRegistrationIds)];
  if (taxIds.length !== input.taxRuleIds.length) throw new ConfigurationConflictError("Duplicate tax-rule identifiers were supplied.");
  if (registrationIds.length !== input.taxRegistrationIds.length) throw new ConfigurationConflictError("Duplicate tax-registration identifiers were supplied.");
  if (entity.tax_setup_status === "APPROVED_NOT_APPLICABLE" && (taxIds.length || registrationIds.length)) {
    throw new ConfigurationConflictError("The approved tax decision is not applicable; this document cannot reference tax rules or registrations.");
  }
  if (entity.tax_setup_status === "APPROVED_CONFIGURED" && taxIds.length === 0) {
    throw new ConfigurationNotReadyError("Select at least one approved tax rule for a configured-tax document.");
  }
  if (entity.tax_setup_status === "APPROVED_CONFIGURED" && registrationIds.length === 0) {
    throw new ConfigurationNotReadyError("Select the approved legal-entity tax registration applicable to this document.");
  }
  type RegistrationSnapshotRow = RowDataPacket & {
    id:string; registration_key:string; version_number:number; registration_type:string; jurisdiction:string;
    registration_number:string; display_label:string; is_primary:number; effective_from:Date; effective_until:Date|null; approval_reference:string;
  };
  let registrationRows: RegistrationSnapshotRow[] = [];
  if (registrationIds.length) {
    const [fetchedRegistrationRows] = await conn.execute<RegistrationSnapshotRow[]>(
      `SELECT id,registration_key,version_number,registration_type,jurisdiction,registration_number,display_label,is_primary,
        effective_from,effective_until,approval_reference
       FROM legal_entity_tax_registrations WHERE legal_entity_id=? AND id IN (${registrationIds.map(()=>"?").join(",")})
        AND is_active=TRUE AND approved_at IS NOT NULL AND approval_reference IS NOT NULL
        AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?) FOR UPDATE`,
      [input.legalEntityId,...registrationIds,input.documentDate,input.documentDate]);
    registrationRows = fetchedRegistrationRows;
  }
  if (registrationRows.length !== registrationIds.length) {
    throw new ConfigurationNotReadyError("A selected tax registration is inactive, unapproved, out of date, or belongs to another legal entity.");
  }
  const registrationById = new Map(registrationRows.map((row)=>[row.id,row]));
  const taxById = new Map(effectiveTaxRows.map((row)=>[row.id,row]));
  for (const taxId of taxIds) {
    const rule=taxById.get(taxId);
    if (!rule) throw new ConfigurationNotReadyError("A selected tax rule is inactive, unapproved, out of date, or belongs to another legal entity.");
    if (!registrationRows.some((reg)=>reg.jurisdiction.trim().toLowerCase()===rule.jurisdiction.trim().toLowerCase())) {
      throw new ConfigurationNotReadyError("Each selected tax rule must have an explicitly selected approved registration for the same configured jurisdiction.");
    }
  }

  const effectiveById = new Map(effectiveTaxRows.map((row) => [row.id, row]));
  if (taxIds.some((id) => !effectiveById.has(id))) throw new ConfigurationNotReadyError("A selected tax rule is inactive, unapproved, out of date, or belongs to another legal entity.");

  const number = await reserveDocumentNumber(conn, input.legalEntityId, input.resourceType, input.documentDate);
  const [templates] = await conn.execute<(RowDataPacket & {
    id: string; template_key: string; display_name: string; version_number: number; template_config: unknown; effective_from: Date; effective_until: Date | null;
  })[]>(
    `SELECT id,template_key,display_name,version_number,template_config,effective_from,effective_until
     FROM invoice_document_templates
     WHERE legal_entity_id=? AND brand_id <=> ? AND document_type=? AND is_active=TRUE
       AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
     ORDER BY version_number DESC FOR UPDATE`,
    [input.legalEntityId, input.brandId ?? null, input.resourceType, input.documentDate, input.documentDate]);
  if (templates.length > 1) throw new ConfigurationConflictError("More than one active template is effective for this entity, brand and document type.");
  let template = templates[0];
  if (!template && input.brandId) {
    const [fallbacks] = await conn.execute<typeof templates>(
      `SELECT id,template_key,display_name,version_number,template_config,effective_from,effective_until
       FROM invoice_document_templates WHERE legal_entity_id=? AND brand_id IS NULL AND document_type=? AND is_active=TRUE
        AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
       ORDER BY version_number DESC FOR UPDATE`,
      [input.legalEntityId, input.resourceType, input.documentDate, input.documentDate]);
    if (fallbacks.length > 1) throw new ConfigurationConflictError("More than one entity-wide template is effective for this document type.");
    template = fallbacks[0];
  }
  if (!template) throw new ConfigurationNotReadyError("No effective, active document template exists for this entity, brand and document type.");
  const snapshot = {
    schemaVersion: 1,
    resource: { type: input.resourceType, id: input.resourceId, documentDate: input.documentDate },
    capturedBy: input.actorId,
    capturedAt: new Date().toISOString(),
    legalEntity: jsonValue(entityVersions[0].config_snapshot),
    legalEntityConfigVersion: { id: entityVersions[0].id, versionNumber: Number(entityVersions[0].version_number) },
    brand: brandSnapshot,
    brandConfigVersionId: brandVersionId,
    numbering: number.configuration,
    numberAllocation: { financialYearLabel: number.financialYearLabel, sequenceValue: number.sequenceValue, displayNumber: number.number },
    template: { id: template.id, key: template.template_key, name: template.display_name, versionNumber: Number(template.version_number), config: jsonValue(template.template_config) },
    selectedTaxRules: taxIds.map((id) => {
      const row = effectiveById.get(id)!;
      return { id: row.id, taxCode: row.tax_code, displayName: row.display_name, jurisdiction: row.jurisdiction, rate: row.rate,
        calculationMode: row.calculation_mode, effectiveFrom: row.effective_from, effectiveUntil: row.effective_until, approvalReference: row.approval_reference };
    }),
    selectedTaxRegistrations: registrationIds.map((id) => {
      const row = registrationById.get(id)!;
      return { id:row.id, registrationKey:row.registration_key, versionNumber:Number(row.version_number), registrationType:row.registration_type,
        jurisdiction:row.jurisdiction, registrationNumber:row.registration_number, displayLabel:row.display_label, isPrimary:Boolean(row.is_primary),
        effectiveFrom:row.effective_from, effectiveUntil:row.effective_until, approvalReference:row.approval_reference };
    }),
  };
  const serialized = canonicalJson(snapshot);
  const hash = sha256(serialized);
  const snapshotId = randomUUID();
  await conn.execute(
    `INSERT INTO document_configuration_snapshots
     (id,resource_type,resource_id,legal_entity_id,brand_id,legal_entity_config_version_id,brand_config_version_id,
      numbering_config_id,template_id,tax_rule_ids,tax_registration_ids,configuration_snapshot,configuration_sha256,captured_by,captured_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))`,
    [snapshotId,input.resourceType,input.resourceId,input.legalEntityId,input.brandId??null,entityVersions[0].id,brandVersionId,
      number.numberingConfigId,template.id,JSON.stringify(taxIds),JSON.stringify(registrationIds),serialized,hash,input.actorId]);
  return { snapshotId, sha256: hash, invoiceNumber: number.number, numberingConfigId: number.numberingConfigId, templateId: template.id, taxRuleIds: taxIds };
}

async function loadEntityFromPool(id: string): Promise<LegalEntityRecord | null> {
  const [rows] = await pool.execute<LegalEntityRecord[]>(
    `SELECT id, legal_name, display_name, registration_number, tax_identifier, address_json, country_code,
      invoice_email, invoice_phone, website, currency, locale, time_zone, logo_reference, signature_reference, bank_details_json,
      invoice_terms, invoice_footer, default_tax_code, tax_setup_status, tax_setup_approval_reference,
      tax_setup_approved_by, tax_setup_approved_at, is_active, created_at, updated_at FROM legal_entities WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}
