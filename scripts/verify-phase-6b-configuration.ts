import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import {
  calendarDateInTimeZone, canonicalJson, captureDocumentConfigurationSnapshot, captureLegalEntityConfigVersion,
  loadEntity, readinessForEntity, reserveDocumentNumber, sha256,
} from "@/lib/configuration/service";
import { ConfigurationConflictError, ConfigurationNotReadyError } from "@/lib/configuration/errors";
import { isQuotationExpired } from "@/lib/finance/quotation-expiry";
import {
  numberingCreateSchema, taxRegistrationCreateSchema, taxRuleCreateSchema, templateCreateSchema,
} from "@/lib/validation/configuration";

type SnapshotRow = RowDataPacket & { id:string; configuration_snapshot:unknown; configuration_sha256:string };

function verifyConfigurationDateValidation() {
  const boundaryInstant = new Date("2026-10-15T20:00:00.000Z");
  assert.equal(calendarDateInTimeZone("Asia/Kolkata", boundaryInstant), "2026-10-16",
    "India business date advances at UTC 18:30, not at UTC midnight");
  assert.equal(calendarDateInTimeZone("UTC", boundaryInstant), "2026-10-15",
    "UTC effective-date evaluation stays on the UTC calendar date");
  assert.equal(calendarDateInTimeZone(null, boundaryInstant), "2026-10-16",
    "entities without a timezone use the Asia/Kolkata product default");
  assert.equal(calendarDateInTimeZone("Invalid/Timezone", boundaryInstant), null,
    "invalid configured timezones fail closed");
  assert.equal(isQuotationExpired("2026-10-15", "UTC", boundaryInstant), false,
    "a quotation remains valid through its validUntil date in UTC");
  assert.equal(isQuotationExpired("2026-10-15", "Asia/Kolkata", boundaryInstant), true,
    "quotation expiry uses the entity's business date when it differs from UTC");
  assert.equal(isQuotationExpired("2026-10-16", "Asia/Kolkata", boundaryInstant), false,
    "quotation validUntil remains inclusive through the entity's business calendar day");
  assert.equal(isQuotationExpired("2026-10-15", "Invalid/Timezone", boundaryInstant), null,
    "invalid timezones leave quotation expiry indeterminate instead of falling back to UTC");
  const legalEntityId = randomUUID();
  const taxRule = {
    legalEntityId, taxCode: "CI_DATE_TEST", displayName: "CI date test",
    jurisdiction: "CI-JURISDICTION", ratePercent: "18", calculationMode: "EXCLUSIVE" as const,
    effectiveFrom: "2026-01-01", effectiveUntil: "", approvalReference: "CI-DATE-APPROVAL",
    changeReason: "CI calendar-date validation",
  };
  const numbering = {
    legalEntityId, documentType: "INVOICE" as const, seriesCode: "CI_DATE_TEST", prefix: "CI-", suffix: "",
    sequenceWidth: 5, includeFinancialYear: true, financialYearStartMonth: 4, financialYearStartDay: 1,
    timeZone: "Asia/Kolkata", effectiveFrom: "2026-01-01", effectiveUntil: "",
    approvalReference: "CI-DATE-APPROVAL", activate: true, changeReason: "CI calendar-date validation",
  };
  const template = {
    legalEntityId, documentType: "INVOICE" as const, templateKey: "CI_DATE_TEST",
    displayName: "CI date test template",
    templateConfig: {
      pageSize: "A4" as const, orientation: "PORTRAIT" as const, layout: "STANDARD" as const,
      accentColor: "#931314", showLogo: true, showTaxBreakdown: true, showBankDetails: false,
      showPaymentTerms: true, showCustomerTaxIdentifier: false, showFooter: true,
    },
    effectiveFrom: "2026-01-01", effectiveUntil: "", activate: true,
    changeReason: "CI calendar-date validation",
  };
  const registration = {
    registrationKey: "CI_DATE_TEST", registrationType: "OTHER" as const, jurisdiction: "CI-JURISDICTION",
    registrationNumber: "CI-DATE-REG", displayLabel: "CI date test", isPrimary: false,
    effectiveFrom: "2026-01-01", effectiveUntil: "", approvalReference: "CI-DATE-APPROVAL",
    changeReason: "CI calendar-date validation",
  };
  assert.equal(taxRuleCreateSchema.safeParse(taxRule).success, true);
  assert.equal(numberingCreateSchema.safeParse(numbering).success, true);
  assert.equal(templateCreateSchema.safeParse(template).success, true);
  assert.equal(taxRegistrationCreateSchema.safeParse(registration).success, true);

  const impossibleDates = ["2026-02-30", "2026-13-01", "2026-04-31"];
  for (const date of impossibleDates) {
    assert.equal(taxRuleCreateSchema.safeParse({ ...taxRule, effectiveFrom: date }).success, false, `tax rule start date rejects ${date}`);
    assert.equal(taxRuleCreateSchema.safeParse({ ...taxRule, effectiveUntil: date }).success, false, `tax rule end date rejects ${date}`);
    assert.equal(numberingCreateSchema.safeParse({ ...numbering, effectiveFrom: date }).success, false, `numbering start date rejects ${date}`);
    assert.equal(numberingCreateSchema.safeParse({ ...numbering, effectiveUntil: date }).success, false, `numbering end date rejects ${date}`);
    assert.equal(templateCreateSchema.safeParse({ ...template, effectiveFrom: date }).success, false, `template start date rejects ${date}`);
    assert.equal(templateCreateSchema.safeParse({ ...template, effectiveUntil: date }).success, false, `template end date rejects ${date}`);
    assert.equal(taxRegistrationCreateSchema.safeParse({ ...registration, effectiveFrom: date }).success, false, `registration start date rejects ${date}`);
    assert.equal(taxRegistrationCreateSchema.safeParse({ ...registration, effectiveUntil: date }).success, false, `registration end date rejects ${date}`);
  }
  assert.equal(
    numberingCreateSchema.safeParse({ ...numbering, financialYearStartMonth: 2, financialYearStartDay: 29 }).success,
    false,
    "an annual financial-year boundary must exist every year; February 29 is not a valid recurring start date",
  );
  console.log("PASS: Phase 6 configuration schemas reject impossible effective dates and recurring February 29 fiscal-year starts.");
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  throw new Error("Expected a JSON object from MySQL.");
}
async function main() {
  verifyConfigurationDateValidation();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const actorId = randomUUID(), entityId = randomUUID(), brandId = randomUUID();
  const taxRuleId = randomUUID(), registrationId = randomUUID();
  const entityVersionId = randomUUID(), brandVersionId = randomUUID();
  const numberingId = randomUUID(), invoiceTemplateId = randomUUID(), brandTemplateId = randomUUID();
  const address = { line1:"CI only, never production", city:"Test City", state:"Test", postalCode:"00000", countryCode:"IN" };
  const bank = { accountName:"CI test only", bankName:"Example Test Bank", accountNumber:"123456789012", ifsc:"TEST0000001", swift:"TESTINXX" };
  const legalName = "CI Tax Legal Entity "+suffix, displayName = "CI Entity "+suffix, taxCode = "CI_STD_"+suffix;
  const entityConfig = {
    schemaVersion:1, legalEntityId:entityId, legalName, displayName, registrationNumber:null, taxIdentifier:null,
    address, billingAddress:null, countryCode:"IN", invoiceEmail:"ci@example.invalid", invoicePhone:null, website:null,
    currency:"INR", locale:"en-IN", timeZone:"Asia/Kolkata", logoReference:null, bankDetails:bank,
    invoiceTerms:"CI terms", invoiceFooter:"CI footer", defaultTaxCode:taxCode, taxSetupStatus:"APPROVED_CONFIGURED",
    taxSetupApprovalReference:"CI-APPROVAL-"+suffix, taxSetupApprovedBy:actorId, taxSetupApprovedAt:new Date().toISOString(), isActive:true,
  };
  const brandConfig = {
    schemaVersion:1, brandId, name:"CI Brand "+suffix, code:"CI6B_"+suffix, description:"Synthetic test only",
    logoReference:"asset://ci-only", theme:{accent:"#123456"}, defaultTemplateKey:"CI_BRAND", isActive:true, legalEntityIds:[entityId],
  };
  try {
    await pool.execute(
      "INSERT INTO app_users (id,email,display_name,identity_provider,provider_subject,account_status) VALUES (?,?,?,'phase6b-ci',?,'ACTIVE')",
      [actorId,"phase6b-"+suffix.toLowerCase()+"@example.invalid","Phase 6B CI Actor "+suffix,"phase6b-"+suffix],
    );
    await pool.execute(
      "INSERT INTO legal_entities (id,legal_name,display_name,address_json,billing_address_json,country_code,currency,locale,time_zone,bank_details_json,invoice_terms,invoice_footer,default_tax_code,tax_setup_status,tax_setup_approval_reference,tax_setup_approved_by,tax_setup_approved_at,is_active) VALUES (?,?,?, ?,NULL,'IN','INR','en-IN','Asia/Kolkata', ?, 'CI terms','CI footer',?,'APPROVED_CONFIGURED',?,?,NOW(3),TRUE)",
      [entityId,legalName,displayName,JSON.stringify(address),JSON.stringify(bank),taxCode,"CI-APPROVAL-"+suffix,actorId],
    );
    await pool.execute(
      "INSERT INTO legal_entity_config_versions (id,legal_entity_id,version_number,effective_from,config_snapshot,change_reason,changed_by) VALUES (?,?,1,'2020-01-01 00:00:00.000',?,'Phase 6B synthetic initial configuration',?)",
      [entityVersionId,entityId,canonicalJson(entityConfig),actorId],
    );
    await pool.execute(
      "INSERT INTO brands (id,name,code,is_active,description,logo_reference,theme_json,default_template_key) VALUES (?,?,?,TRUE,?,?,?,?)",
      [brandId,brandConfig.name,brandConfig.code,brandConfig.description,brandConfig.logoReference,JSON.stringify(brandConfig.theme),brandConfig.defaultTemplateKey],
    );
    await pool.execute(
      "INSERT INTO brand_legal_entities (brand_id,legal_entity_id,is_default,effective_from) VALUES (?,?,TRUE,'2020-01-01 00:00:00.000')",
      [brandId,entityId],
    );
    await pool.execute(
      "INSERT INTO brand_config_versions (id,brand_id,version_number,effective_from,config_snapshot,change_reason,changed_by) VALUES (?,?,1,'2020-01-01 00:00:00.000',?,'Phase 6B synthetic brand configuration',?)",
      [brandVersionId,brandId,canonicalJson(brandConfig),actorId],
    );
    await pool.execute(
      "INSERT INTO tax_rules (id,legal_entity_id,tax_code,display_name,jurisdiction,rate,calculation_mode,effective_from,effective_until,is_active,approved_by,approved_at,approval_reference,deactivated_at) VALUES (?,?,?,?,?,18.000000,'EXCLUSIVE',DATE_SUB(CURRENT_DATE(),INTERVAL 30 DAY),NULL,TRUE,?,NOW(3),?,NULL)",
      [taxRuleId,entityId,taxCode,"CI standard tax","CI-JURISDICTION",actorId,"CI-TAX-APPROVAL-"+suffix],
    );
    await pool.execute(
      "INSERT INTO legal_entity_tax_registrations (id,legal_entity_id,registration_key,version_number,registration_type,jurisdiction,registration_number,display_label,is_primary,effective_from,effective_until,approval_reference,approved_by,approved_at,is_active,created_by) VALUES (?,?,?,1,'OTHER','CI-JURISDICTION',?,'CI test registration',TRUE,DATE_SUB(CURRENT_DATE(),INTERVAL 30 DAY),NULL,?,?,NOW(3),TRUE,?)",
      [registrationId,entityId,"CI_REG_"+suffix,"CI-REG-NUMBER-"+suffix,"CI-REG-APPROVAL-"+suffix,actorId,actorId],
    );
    await pool.execute(
      "INSERT INTO invoice_numbering_configs (id,legal_entity_id,document_type,series_code,prefix,suffix,sequence_width,include_financial_year,sequence_scope,financial_year_start_month,financial_year_start_day,time_zone,version_number,effective_from,effective_until,approval_reference,is_active,created_by) VALUES (?,?, 'INVOICE', ?, 'CI-', '', 5, TRUE,'ENTITY_FINANCIAL_YEAR_DOCUMENT_TYPE',4,1,'Asia/Kolkata',1,'2010-01-01',NULL,?,TRUE,?)",
      [numberingId,entityId,"CI_INV_"+suffix,"CI-NUMBER-APPROVAL-"+suffix,actorId],
    );
    await pool.execute(
      "INSERT INTO invoice_document_templates (id,legal_entity_id,brand_id,document_type,template_key,display_name,version_number,template_config,effective_from,effective_until,is_active,created_by) VALUES (?, ?, NULL,'INVOICE','CI_DEFAULT','CI entity default',1,?,'2010-01-01',NULL,TRUE,?)",
      [invoiceTemplateId,entityId,JSON.stringify({pageSize:"A4",orientation:"PORTRAIT",layout:"STANDARD",showLogo:true,showTaxBreakdown:true,showPaymentTerms:true,showBankDetails:false,showFooter:true,footerText:"CI footer"}),actorId],
    );
    await pool.execute(
      "INSERT INTO invoice_document_templates (id,legal_entity_id,brand_id,document_type,template_key,display_name,version_number,template_config,effective_from,effective_until,is_active,created_by) VALUES (?, ?, ?,'INVOICE','CI_BRAND','CI brand template',1,?,'2010-01-01',NULL,TRUE,?)",
      [brandTemplateId,entityId,brandId,JSON.stringify({pageSize:"A4",orientation:"LANDSCAPE",layout:"BRAND",showLogo:true,showTaxBreakdown:true,showPaymentTerms:true,showBankDetails:true,showFooter:true,footerText:"CI branded footer"}),actorId],
    );

    const readiness = await readinessForEntity(entityId);
    assert.equal(readiness.ready,true,"approved full configuration must pass issuance readiness: "+JSON.stringify(readiness.checks));

    // Readiness must reject a tax rule/registration pair that only looks complete by count.
    await pool.execute("UPDATE tax_rules SET jurisdiction='CI-UNREGISTERED-JURISDICTION' WHERE id=?",[taxRuleId]);
    const mismatchedReadiness=await readinessForEntity(entityId);
    assert.equal(mismatchedReadiness.checks.find(check=>check.key==="taxRules")?.passed,false,
      "tax readiness must require a registered matching jurisdiction, not merely one rule and one registration");
    assert.equal(mismatchedReadiness.checks.find(check=>check.key==="defaultTaxCode")?.passed,false,
      "default tax-code readiness must reject a rule whose jurisdiction has no approved registration");
    await pool.execute("UPDATE tax_rules SET jurisdiction='CI-JURISDICTION' WHERE id=?",[taxRuleId]);
    const restoredReadiness=await readinessForEntity(entityId);
    assert.equal(restoredReadiness.checks.find(check=>check.key==="defaultTaxCode")?.passed,true,
      "the default tax code must become ready again when its matching approved registration is restored");
    assert.equal(restoredReadiness.ready,true,"restoring the matching jurisdiction restores readiness");

    // An approved not-applicable decision is independent of a stale historical default tax-code field.
    await pool.execute("UPDATE legal_entities SET tax_setup_status='APPROVED_NOT_APPLICABLE' WHERE id=?",[entityId]);
    const notApplicableReadiness=await readinessForEntity(entityId);
    assert.equal(notApplicableReadiness.checks.find(check=>check.key==="taxRules")?.passed,true,
      "approved not-applicable setup does not require configured rates/registrations");
    assert.equal(notApplicableReadiness.checks.some(check=>check.key==="defaultTaxCode"),false,
      "an unused default tax code must not block an approved not-applicable decision");
    await pool.execute("UPDATE legal_entities SET tax_setup_status='APPROVED_CONFIGURED' WHERE id=?",[entityId]);

    const dateRows = await pool.execute<(RowDataPacket & { today:string; before_tax_date:string })[]>(
      "SELECT DATE_FORMAT(CURRENT_DATE(),'%Y-%m-%d') AS today,DATE_FORMAT(DATE_SUB(CURRENT_DATE(),INTERVAL 31 DAY),'%Y-%m-%d') AS before_tax_date",
    );
    const today = dateRows[0][0].today, beforeTaxDate = dateRows[0][0].before_tax_date;

    const concurrent = await Promise.all(Array.from({length:12},async()=>{
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const value = await reserveDocumentNumber(conn,entityId,"INVOICE",today);
        await conn.commit();
        return value;
      } catch(error) { await conn.rollback(); throw error; }
      finally { conn.release(); }
    }));
    assert.equal(new Set(concurrent.map(x=>x.number)).size,12,"concurrent callers must never allocate duplicate display numbers");
    assert.deepEqual(concurrent.map(x=>x.sequenceValue).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1),
      "counter allocations must be sequential even when requests run concurrently");

    const year = Number(today.slice(0,4));
    const fyBeforeConn = await pool.getConnection();
    let fyBefore: Awaited<ReturnType<typeof reserveDocumentNumber>>;
    try { await fyBeforeConn.beginTransaction(); fyBefore=await reserveDocumentNumber(fyBeforeConn,entityId,"INVOICE",year+"-03-31"); await fyBeforeConn.commit(); }
    catch(error) { await fyBeforeConn.rollback(); throw error; } finally { fyBeforeConn.release(); }
    const fyStartConn = await pool.getConnection();
    let fyStart: Awaited<ReturnType<typeof reserveDocumentNumber>>;
    try { await fyStartConn.beginTransaction(); fyStart=await reserveDocumentNumber(fyStartConn,entityId,"INVOICE",year+"-04-01"); await fyStartConn.commit(); }
    catch(error) { await fyStartConn.rollback(); throw error; } finally { fyStartConn.release(); }
    assert.equal(fyBefore.financialYearLabel,(year-1)+"-"+year,"day before FY boundary belongs to the previous financial year");
    assert.equal(fyStart.financialYearLabel,year+"-"+(year+1),"FY start day belongs to the new financial year");

    const resourceId = randomUUID();
    const conn = await pool.getConnection();
    let captured: Awaited<ReturnType<typeof captureDocumentConfigurationSnapshot>>;
    try {
      await conn.beginTransaction();
      captured = await captureDocumentConfigurationSnapshot(conn,{
        resourceType:"INVOICE",resourceId,legalEntityId:entityId,brandId,documentDate:today,actorId,
        taxRuleIds:[taxRuleId],taxRegistrationIds:[registrationId],
      });
      await conn.commit();
    } catch(error) { await conn.rollback(); throw error; } finally { conn.release(); }
    assert.equal(captured.numberingConfigId,numberingId);
    assert.equal(captured.templateId,brandTemplateId,"brand-specific template is preferred when explicitly mapped");
    const [snapshotRows] = await pool.execute<SnapshotRow[]>(
      "SELECT id,configuration_snapshot,configuration_sha256 FROM document_configuration_snapshots WHERE resource_type='INVOICE' AND resource_id=?",
      [resourceId],
    );
    assert.equal(snapshotRows.length,1);
    const snapshot = parseObject(snapshotRows[0].configuration_snapshot);
    assert.equal(sha256(canonicalJson(snapshot)),snapshotRows[0].configuration_sha256,"stored snapshot hash verifies against canonical JSON");
    assert.equal(parseObject(snapshot.legalEntityConfigVersion).id,entityVersionId);
    assert.equal(snapshot.brandConfigVersionId,brandVersionId);
    assert.equal((snapshot.selectedTaxRules as Array<Record<string,unknown>>)[0].id,taxRuleId);
    assert.equal((snapshot.selectedTaxRegistrations as Array<Record<string,unknown>>)[0].id,registrationId);
    assert.equal(parseObject(snapshot.numberAllocation).displayNumber,captured.invoiceNumber);

    await assert.rejects(async()=>{
      const duplicate = await pool.getConnection();
      try {
        await duplicate.beginTransaction();
        await captureDocumentConfigurationSnapshot(duplicate,{
          resourceType:"INVOICE",resourceId,legalEntityId:entityId,brandId,documentDate:today,actorId,
          taxRuleIds:[taxRuleId],taxRegistrationIds:[registrationId],
        });
      } finally { await duplicate.rollback(); duplicate.release(); }
    },ConfigurationConflictError,"the same document cannot receive two configuration snapshots");

    await assert.rejects(async()=>{
      const bad = await pool.getConnection();
      try {
        await bad.beginTransaction();
        await captureDocumentConfigurationSnapshot(bad,{
          resourceType:"INVOICE",resourceId:randomUUID(),legalEntityId:entityId,brandId,documentDate:beforeTaxDate,actorId,
          taxRuleIds:[taxRuleId],taxRegistrationIds:[registrationId],
        });
      } finally { await bad.rollback(); bad.release(); }
    },ConfigurationNotReadyError,"tax and registration effective-date boundaries must block back-dated issuance outside the approved period");

    const originalConfig=JSON.stringify(snapshotRows[0].configuration_snapshot), originalHash=snapshotRows[0].configuration_sha256;
    const editConn=await pool.getConnection();
    try {
      await editConn.beginTransaction();
      await editConn.execute("UPDATE legal_entities SET display_name=? WHERE id=?",["CI Entity Updated "+suffix,entityId]);
      const latest=await loadEntity(editConn,entityId);
      assert.ok(latest);
      await captureLegalEntityConfigVersion(editConn,latest,actorId,"Phase 6B snapshot preservation test");
      await editConn.commit();
    } catch(error) { await editConn.rollback(); throw error; } finally { editConn.release(); }
    const [afterEditRows] = await pool.execute<SnapshotRow[]>(
      "SELECT id,configuration_snapshot,configuration_sha256 FROM document_configuration_snapshots WHERE id=?",[captured.snapshotId],
    );
    assert.equal(JSON.stringify(afterEditRows[0].configuration_snapshot),originalConfig,"later entity edits cannot rewrite an issued configuration snapshot");
    assert.equal(afterEditRows[0].configuration_sha256,originalHash);
    const afterSnapshot=parseObject(afterEditRows[0].configuration_snapshot);
    assert.equal(parseObject(afterSnapshot.legalEntity).displayName,displayName);

    await assert.rejects(
      async () => { await pool.execute("UPDATE document_configuration_snapshots SET configuration_sha256=? WHERE id=?",["0".repeat(64),captured.snapshotId]); },
      /immutable/i,
      "database must reject snapshot mutation",
    );
    console.log("PASS: Phase 6B integration tests cover 12 concurrent number allocations, fiscal-year boundaries, approved tax/registration effective-date boundaries, brand-specific template selection, canonical SHA-256, immutable snapshots, history preservation and readiness.");
  } finally {
    await pool.end();
  }
}
main().catch((error)=>{ console.error("Phase 6B configuration integration test failed:",error instanceof Error?error.message:"unknown error"); process.exitCode=1; });
