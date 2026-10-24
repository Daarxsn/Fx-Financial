import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { assertCsrf } from "@/lib/auth/csrf";
import { requirePermission } from "@/lib/auth/authorize";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { ConfigurationConflictError, ConfigurationNotReadyError } from "@/lib/configuration/errors";
import { captureDocumentConfigurationSnapshot, jsonValue } from "@/lib/configuration/service";
import { unresolvedInvoicePolicyDecisions } from "@/lib/configuration/policy-decisions";
import { calculateInvoice, calculateInvoiceTaxComponents, defaultDueDate, assertValidDueDate } from "@/lib/finance/invoice-calculation";
import { calendarDateSchema } from "@/lib/validation/configuration";
import { z } from "zod";
import { captureDocumentSourceSnapshot } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const issueSchema = z.object({ documentDate: calendarDateSchema }).strict();

function isDuplicateInvoiceKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY");
}

function safeIssueErrorMetadata(error: unknown): { errorName: string; databaseCode?: string } {
  if (!error || typeof error !== "object") return { errorName: "UnknownError" };
  const candidate = error as { name?: unknown; code?: unknown };
  const errorName = typeof candidate.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate.name)
    ? candidate.name
    : "UnknownError";
  // Database error codes are finite diagnostic categories. Never log the raw exception/message, SQL, or parameters.
  const databaseCode = typeof candidate.code === "string" && /^[A-Z0-9_]{1,64}$/.test(candidate.code)
    ? candidate.code
    : undefined;
  return { errorName, ...(databaseCode ? { databaseCode } : {}) };
}

type InvoiceRow = RowDataPacket & {
  id: string;
  legal_entity_id: string;
  brand_id: string | null;
  customer_id: string;
  document_type: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  lifecycle_status: string;
  payment_terms_days: number;
  invoice_number: string | null;
  financial_year: string | null;
  invoice_date: Date | string | null;
  due_date: Date | string | null;
  invoice_valid_until: Date | string | null;
  tax_mode: "LINE" | "COMPONENTS";
  cgst_enabled: number; cgst_rate: string | null; sgst_enabled: number; sgst_rate: string | null;
  cgst_amount: string; sgst_amount: string;
  currency: string;
  grand_total: string | number;
  issue_idempotency_key: string | null;
  draft_recipient_email: string;
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* invalid stored JSON is rejected by the domain checks below */ }
  }
  return {};
}

export async function POST(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  let requestInvoiceId: string | undefined;
  let requestIdempotencyKey: string | undefined;
  try {
    await assertCsrf(request);
    const actor = await requirePermission("invoices:issue");
    const { invoiceId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "invoiceId must be a UUID." } }, 400);
    }
    requestInvoiceId = invoiceId;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey)) {
      return jsonNoStore({ error: { code: "VALIDATION_ERROR", message: "Idempotency-Key must contain 16–128 visible ASCII characters." } }, 400);
    }
    requestIdempotencyKey = idempotencyKey;
    const parsedBody = issueSchema.parse(await request.json());
    const documentDate = parsedBody.documentDate;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [invoiceRows] = await conn.execute<InvoiceRow[]>(
      "SELECT id,legal_entity_id,brand_id,customer_id,document_type,lifecycle_status,payment_terms_days,invoice_number,financial_year,invoice_date,due_date,invoice_valid_until,tax_mode,cgst_enabled,cgst_rate,sgst_enabled,sgst_rate,cgst_amount,sgst_amount,currency,grand_total,issue_idempotency_key,draft_recipient_email FROM invoices WHERE id=? FOR UPDATE",
      [invoiceId],
    );
    if (!invoiceRows.length) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Invoice not found." } }, 404);
    }
    const invoice = invoiceRows[0];
    if (!actor.legalEntityIds.includes(invoice.legal_entity_id)) {
      await conn.rollback();
      return jsonNoStore({ error: { code: "NOT_FOUND", message: "Invoice not found in your assigned scope." } }, 404);
    }
    if (invoice.lifecycle_status === "ISSUED") {
      const issuedDocumentDate = invoice.invoice_date instanceof Date
        ? invoice.invoice_date.toISOString().slice(0, 10)
        : invoice.invoice_date === null ? null : String(invoice.invoice_date).slice(0, 10);
      if (invoice.issue_idempotency_key !== idempotencyKey || issuedDocumentDate !== documentDate) {
        await conn.rollback();
        return jsonNoStore({ error: { code: "CONFIGURATION_CONFLICT", message: "This invoice has already been issued with a different idempotency key or document date." } }, 409);
      }
      const [snapshots] = await conn.execute<(RowDataPacket & { id: string; configuration_sha256: string })[]>(
        "SELECT id,configuration_sha256 FROM document_configuration_snapshots WHERE resource_type=? AND resource_id=? LIMIT 1",
        [invoice.document_type, invoice.id],
      );
      if (!snapshots.length) throw new ConfigurationConflictError("Issued invoice has no immutable configuration snapshot; manual reconciliation is required.");
      await conn.commit();
      return jsonNoStore({ data: {
        id: invoice.id, status: invoice.lifecycle_status, invoiceNumber: invoice.invoice_number,
        financialYear: invoice.financial_year, invoiceDate: invoice.invoice_date, dueDate: invoice.due_date,
        currency: invoice.currency, grandTotal: String(invoice.grand_total),
        configurationSnapshotId: snapshots[0].id, configurationSha256: snapshots[0].configuration_sha256,
        idempotentReplay: true,
      } });
    }
    // Credit/debit-note sequencing and templates alone do not make a legal correction flow.
    // Until an issuer-approved workflow creates a linked note with verified tax/statutory
    // treatment, never issue or replay note documents through the generic invoice endpoint.
    if (invoice.document_type === "CREDIT_NOTE" || invoice.document_type === "DEBIT_NOTE") {
      await conn.rollback();
      return jsonNoStore({ error: {
        code: "CORRECTION_TREATMENT_BLOCKED",
        message: "Credit/debit notes cannot be issued through the generic invoice endpoint. An approved, source-linked correction workflow with issuer-specific tax, numbering and statutory treatment is required.",
      } }, 409);
    }
    if (invoice.lifecycle_status !== "DRAFT") {
      await conn.rollback();
      return jsonNoStore({ error: { code: "CONFIGURATION_CONFLICT", message: "Only draft invoices can be issued." } }, 409);
    }
    if (invoice.document_type !== "INVOICE") {
      throw new ConfigurationConflictError("Only an invoice can be issued through this endpoint; credit/debit notes require the governed correction workflow.");
    }
    const unresolvedPolicyDecisions = await unresolvedInvoicePolicyDecisions(conn, invoice.legal_entity_id);
    if (unresolvedPolicyDecisions.length) {
      await conn.rollback();
      return jsonNoStore({ error: {
        code: "POLICY_APPROVAL_REQUIRED",
        message: "Issuance is blocked until required global and legal-entity decisions are approved or explicitly marked not applicable with evidence.",
        details: { unresolvedDecisions: unresolvedPolicyDecisions },
      } }, 409);
    }
    const [keyRows] = await conn.execute<(RowDataPacket & { id: string })[]>(
      // Use a non-locking advisory read for the unique key. A missing-key locking read
      // can acquire compatible gap locks on concurrent transactions and deadlock when they
      // later write their distinct keys. The unique constraint below remains authoritative.
      "SELECT id FROM invoices WHERE legal_entity_id=? AND issue_idempotency_key=? AND id<>? LIMIT 1",
      [invoice.legal_entity_id, idempotencyKey, invoice.id],
    );
    if (keyRows.length) throw new ConfigurationConflictError("Idempotency-Key has already been used for another invoice in this legal entity.");

    const [customers] = await conn.execute<(RowDataPacket & {
      id: string; name: string; email: string | null; phone: string | null; billing_address_json: unknown; tax_identifier: string | null;
    })[]>(
      "SELECT id,name,email,phone,billing_address_json,tax_identifier FROM customers WHERE id=? AND is_active=TRUE LIMIT 1 FOR UPDATE",
      [invoice.customer_id],
    );
    if (!customers.length) throw new ConfigurationNotReadyError("An active customer record is required before issuing this invoice.");
    const customer = customers[0];

    const [lineRows] = await conn.execute<(RowDataPacket & {
      id: string; line_number: number; line_kind: "ITEM"|"CHARGE"; description: string; quantity:string|number; unit_price:string|number;
      discount_type:"AMOUNT"|"PERCENT"; discount_value:string|number; tax_calculation_mode:"EXCLUSIVE"|"INCLUSIVE";
      tax_code: string | null; tax_rule_id: string | null; tax_registration_id: string | null;
      tax_rate: string | number; tax_amount: string | number; configured_tax_code: string | null; configured_rate: string | number | null;
      configured_tax_calculation_mode:"EXCLUSIVE"|"INCLUSIVE"|null; configured_tax_jurisdiction: string | null;
      configured_registration_jurisdiction: string | null;
    })[]>(
      "SELECT l.id,l.line_number,l.line_kind,l.description,l.quantity,l.unit_price,l.discount_type,l.discount_value,l.tax_calculation_mode,l.tax_code,l.tax_rule_id,l.tax_registration_id,l.tax_rate,l.tax_amount,r.tax_code AS configured_tax_code,r.rate AS configured_rate,r.calculation_mode AS configured_tax_calculation_mode,r.jurisdiction AS configured_tax_jurisdiction,tr.jurisdiction AS configured_registration_jurisdiction FROM invoice_lines l LEFT JOIN tax_rules r ON r.id=l.tax_rule_id LEFT JOIN legal_entity_tax_registrations tr ON tr.id=l.tax_registration_id WHERE l.invoice_id=? ORDER BY l.line_number FOR UPDATE",
      [invoice.id],
    );
    if (!lineRows.length) throw new ConfigurationNotReadyError("At least one invoice line is required before issuance.");

    const [entityRows] = await conn.execute<(RowDataPacket & { tax_setup_status: string; currency: string; is_active: number })[]>(
      "SELECT tax_setup_status,currency,is_active FROM legal_entities WHERE id=? FOR UPDATE", [invoice.legal_entity_id],
    );
    const taxStatus = entityRows[0]?.tax_setup_status;
    if (!entityRows.length || !entityRows[0].is_active) {
      throw new ConfigurationNotReadyError("An active legal entity is required before invoice issuance.");
    }
    // Multi-currency and FX conversion are not implemented as approved business rules yet.
    // Do not issue a document in a currency other than the legal entity's configured currency.
    if (invoice.currency !== entityRows[0].currency) {
      throw new ConfigurationNotReadyError("Invoice currency must match the legal entity currency until an approved multi-currency and FX policy is configured.");
    }
    let taxRuleIds: string[] = [];
    let taxRegistrationIds: string[] = [];
    let calculation: ReturnType<typeof calculateInvoice>;
    let componentTotals = { cgstAmount:"0.0000", sgstAmount:"0.0000", taxTotal:"0.0000", grandTotal:"0.0000" };
    const percentUnits = (value: string | number): bigint => {
      const [whole, fraction = ""] = String(value).split(".");
      return BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0,6));
    };

    if (invoice.tax_mode === "COMPONENTS") {
      if (lineRows.some(line => line.tax_rule_id !== null || line.tax_registration_id !== null || line.tax_code !== null)) {
        throw new ConfigurationConflictError("Invoice-level CGST/SGST cannot be mixed with line-level tax rules.");
      }
      if (taxStatus === "UNCONFIGURED") {
        throw new ConfigurationNotReadyError("A recorded, approved tax decision is required before invoice issuance.");
      }
      const cgstEnabled = Boolean(invoice.cgst_enabled);
      const sgstEnabled = Boolean(invoice.sgst_enabled);
      if (taxStatus === "APPROVED_NOT_APPLICABLE" && (cgstEnabled || sgstEnabled)) {
        throw new ConfigurationConflictError("The approved tax decision is not applicable. Disable CGST and SGST or obtain an approved configured-tax decision.");
      }
      if (taxStatus === "APPROVED_CONFIGURED" && !cgstEnabled && !sgstEnabled) {
        throw new ConfigurationNotReadyError("This supplier has configured tax. Select the applicable approved CGST and/or SGST components; tax-exempt treatment needs an approved not-applicable decision.");
      }
      if (taxStatus === "APPROVED_CONFIGURED") {
        if ((cgstEnabled && !invoice.cgst_rate) || (sgstEnabled && !invoice.sgst_rate)) {
          throw new ConfigurationNotReadyError("Enter a rate for each enabled tax component.");
        }
        const combinedRate = (cgstEnabled ? percentUnits(String(invoice.cgst_rate)) : 0n) +
          (sgstEnabled ? percentUnits(String(invoice.sgst_rate)) : 0n);
        const [candidateRules] = await conn.execute<(RowDataPacket & {id:string;rate:string|number;jurisdiction:string})[]>(
          `SELECT id,rate,jurisdiction FROM tax_rules
            WHERE legal_entity_id=? AND is_active=TRUE AND approved_at IS NOT NULL AND approval_reference IS NOT NULL
              AND calculation_mode="EXCLUSIVE" AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
            ORDER BY effective_from DESC,id FOR UPDATE`,
          [invoice.legal_entity_id,documentDate,documentDate],
        );
        const matchingRule = candidateRules.find(rule => percentUnits(rule.rate) === combinedRate);
        if (!matchingRule) {
          throw new ConfigurationNotReadyError("The enabled CGST/SGST rates must add up to an approved, effective tax rule for this supplier and invoice date. Update the rates in Tax settings if the combination is not approved.");
        }
        const [registrations] = await conn.execute<(RowDataPacket & {id:string})[]>(
          `SELECT id FROM legal_entity_tax_registrations
            WHERE legal_entity_id=? AND is_active=TRUE AND approved_at IS NOT NULL AND approval_reference IS NOT NULL
              AND LOWER(TRIM(jurisdiction))=LOWER(TRIM(?)) AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?)
            ORDER BY is_primary DESC,effective_from DESC,version_number DESC LIMIT 1 FOR UPDATE`,
          [invoice.legal_entity_id,matchingRule.jurisdiction,documentDate,documentDate],
        );
        if (!registrations.length) {
          throw new ConfigurationNotReadyError("The approved tax rule has no matching approved registration effective on this invoice date.");
        }
        taxRuleIds = [matchingRule.id];
        taxRegistrationIds = [registrations[0].id];
      }
      const baseCalculation = calculateInvoice(lineRows.map(line => ({
        lineKind:line.line_kind,description:line.description,quantity:String(line.quantity),unitPrice:String(line.unit_price),
        discountType:line.discount_type,discountValue:String(line.discount_value),taxRatePercent:"0.000000",taxCalculationMode:"EXCLUSIVE" as const,
      })));
      componentTotals = calculateInvoiceTaxComponents(baseCalculation.taxableValue,cgstEnabled,String(invoice.cgst_rate??"0.000000"),sgstEnabled,String(invoice.sgst_rate??"0.000000"));
      calculation = {...baseCalculation,taxTotal:componentTotals.taxTotal,grandTotal:componentTotals.grandTotal};
      for (let index=0;index<lineRows.length;index++) {
        const line=lineRows[index], calculated=calculation.lines[index];
        await conn.execute(
          "UPDATE invoice_lines SET discount_amount=?,tax_rate='0.000000',tax_calculation_mode='EXCLUSIVE',tax_amount='0.0000',line_total=? WHERE id=? AND invoice_id=?",
          [calculated.discountAmount,calculated.lineTotal,line.id,invoice.id],
        );
      }
    } else {
      if (taxStatus === "APPROVED_CONFIGURED") {
        const invalid = lineRows.find((line) => {
          const taxJurisdiction=line.configured_tax_jurisdiction?.trim().toLowerCase();
          const registrationJurisdiction=line.configured_registration_jurisdiction?.trim().toLowerCase();
          return !line.tax_rule_id || !line.tax_registration_id || !line.tax_code ||
            line.configured_tax_code!==line.tax_code || line.configured_tax_calculation_mode!==line.tax_calculation_mode ||
            !taxJurisdiction || !registrationJurisdiction || taxJurisdiction!==registrationJurisdiction;
        });
        if (invalid) throw new ConfigurationNotReadyError("Every invoice line must reference an approved tax rule and a registration for the same jurisdiction, with a matching tax code and rate.");
        taxRuleIds=[...new Set(lineRows.map(line=>String(line.tax_rule_id)))];
        taxRegistrationIds=[...new Set(lineRows.map(line=>String(line.tax_registration_id)))];
      } else if (taxStatus === "APPROVED_NOT_APPLICABLE") {
        const inconsistent=lineRows.some(line=>line.tax_rule_id!==null || line.tax_registration_id!==null || line.tax_code!==null);
        if (inconsistent) throw new ConfigurationConflictError("The approved tax setup is not applicable; invoice lines must not contain tax rule references.");
      } else {
        throw new ConfigurationNotReadyError("A recorded, approved tax decision is required before invoice issuance.");
      }
      calculation = calculateInvoice(lineRows.map(line=>({
        lineKind:line.line_kind,description:line.description,quantity:String(line.quantity),unitPrice:String(line.unit_price),
        discountType:line.discount_type,discountValue:String(line.discount_value),
        taxRatePercent:taxStatus==="APPROVED_CONFIGURED"?String(line.configured_rate):"0.000000",
        taxCalculationMode:taxStatus==="APPROVED_CONFIGURED"?line.configured_tax_calculation_mode!:"EXCLUSIVE",
      })));
      for(let index=0;index<lineRows.length;index++){
        const line=lineRows[index],calculated=calculation.lines[index];
        const rate=taxStatus==="APPROVED_CONFIGURED"?String(line.configured_rate):"0.000000";
        await conn.execute("UPDATE invoice_lines SET discount_amount=?,tax_rate=?,tax_calculation_mode=?,tax_amount=?,line_total=? WHERE id=? AND invoice_id=?",
          [calculated.discountAmount,rate,calculated.taxCalculationMode,calculated.taxAmount,calculated.lineTotal,line.id,invoice.id]);
      }
    }
    const expiryDate = invoice.invoice_valid_until instanceof Date ? invoice.invoice_valid_until.toISOString().slice(0,10) : invoice.invoice_valid_until === null ? null : String(invoice.invoice_valid_until).slice(0,10);
    if (expiryDate && expiryDate < documentDate) throw new ConfigurationConflictError("The proforma expiry date cannot be earlier than the issue date.");
    const invoiceDueDate = invoice.due_date instanceof Date
      ? invoice.due_date.toISOString().slice(0,10)
      : invoice.due_date === null ? defaultDueDate(documentDate, Number(invoice.payment_terms_days)) : String(invoice.due_date).slice(0,10);
    try { assertValidDueDate(documentDate, invoiceDueDate); }
    catch (error) { throw new ConfigurationConflictError(error instanceof Error ? error.message : "Invoice due date is invalid."); }
    await conn.execute(
      "UPDATE invoices SET subtotal=?,discount_total=?,tax_total=?,grand_total=?,cgst_amount=?,sgst_amount=? WHERE id=? AND lifecycle_status='DRAFT'",
      [calculation.subtotal,calculation.discountTotal,calculation.taxTotal,calculation.grandTotal,componentTotals.cgstAmount,componentTotals.sgstAmount,invoice.id],
    );

    const snapshotResult = await captureDocumentConfigurationSnapshot(conn, {
      resourceType: invoice.document_type, resourceId: invoice.id, legalEntityId: invoice.legal_entity_id,
      brandId: invoice.brand_id, documentDate, actorId: actor.userId, taxRuleIds, taxRegistrationIds,
    });
    const [snapshotRows] = await conn.execute<(RowDataPacket & { configuration_snapshot: unknown })[]>(
      "SELECT configuration_snapshot FROM document_configuration_snapshots WHERE id=? LIMIT 1", [snapshotResult.snapshotId],
    );
    if (!snapshotRows.length) throw new ConfigurationConflictError("The configuration snapshot could not be reloaded after capture.");
    const configSnapshot = jsonObject(snapshotRows[0].configuration_snapshot);
    const supplierSnapshot = configSnapshot.legalEntity;
    if (!supplierSnapshot || typeof supplierSnapshot !== "object") {
      throw new ConfigurationNotReadyError("The approved supplier configuration snapshot is incomplete.");
    }
    const numberAllocation = jsonObject(configSnapshot.numberAllocation);
    const financialYearLabel = String(numberAllocation.financialYearLabel ?? "");
    if (!financialYearLabel) throw new ConfigurationNotReadyError("The approved numbering configuration did not produce a financial-year label.");
    const supplierForInvoice = { ...jsonObject(supplierSnapshot) };
    delete supplierForInvoice.bankDetails;
    const customerSnapshot = {
      customerId: customer.id, name: customer.name, email: invoice.draft_recipient_email || customer.email, phone: customer.phone,
      billingAddress: jsonValue(customer.billing_address_json), taxIdentifier: customer.tax_identifier,
    };

    const [updated] = await conn.execute<ResultSetHeader>(
      "UPDATE invoices SET lifecycle_status='ISSUED',invoice_number=?,financial_year=?,invoice_date=?,due_date=?,supplier_snapshot=?,customer_snapshot=?,issued_at=NOW(3),issued_by=?,issue_idempotency_key=?,updated_at=NOW(3) WHERE id=? AND lifecycle_status='DRAFT'",
      [snapshotResult.invoiceNumber, financialYearLabel, documentDate, invoiceDueDate, JSON.stringify(supplierForInvoice),
        JSON.stringify(customerSnapshot), actor.userId, idempotencyKey, invoice.id],
    );
    if (updated.affectedRows !== 1) throw new ConfigurationConflictError("Invoice state changed during issuance; retry after refreshing the invoice.");

    // Capture the issued content inside the same transaction as numbering and source snapshots.
    await captureDocumentSourceSnapshot(conn, "INVOICE", invoice.id, actor.userId, "ISSUED");

    await conn.execute(
      "INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,outcome,before_json,after_json,correlation_id,change_reason) VALUES (?,?,'invoice.issued','invoice',?,'SUCCESS',?,?,?,?)",
      [randomUUID(),actor.userId,invoice.id,JSON.stringify({status:"DRAFT"}),
        JSON.stringify({status:"ISSUED",invoiceNumber:snapshotResult.invoiceNumber,configurationSnapshotId:snapshotResult.snapshotId,
          configurationSha256:snapshotResult.sha256}),randomUUID(),"Approved configuration validated and snapshotted during issuance"],
    );
    await conn.commit();
    return jsonNoStore({ data: {
      id: invoice.id, status: "ISSUED", invoiceNumber: snapshotResult.invoiceNumber,
      financialYear: financialYearLabel, invoiceDate: documentDate, validUntil: expiryDate, currency: invoice.currency,
      grandTotal: calculation.grandTotal, subtotal: calculation.subtotal, discountTotal: calculation.discountTotal,
      taxableValue: calculation.taxableValue, taxTotal: calculation.taxTotal, cgstAmount:componentTotals.cgstAmount, sgstAmount:componentTotals.sgstAmount, dueDate: invoiceDueDate, configurationSnapshotId: snapshotResult.snapshotId,
      configurationSha256: snapshotResult.sha256, idempotentReplay: false,
    } });
  } catch (error) {
    if (conn) try { await conn.rollback(); } catch { /* preserve original error */ }
    if (isDuplicateInvoiceKeyError(error) && requestInvoiceId && requestIdempotencyKey) {
      // A simultaneous request may win the unique legal-entity/idempotency-key constraint
      // after this request's advisory check. Translate only a proven key collision to 409;
      // unrelated unique-key errors keep the safe generic error path.
      try {
        const [sourceRows] = await pool.execute<(RowDataPacket & { legal_entity_id: string })[]>(
          "SELECT legal_entity_id FROM invoices WHERE id=? LIMIT 1", [requestInvoiceId],
        );
        if (sourceRows.length) {
          const [owners] = await pool.execute<(RowDataPacket & { id: string })[]>(
            "SELECT id FROM invoices WHERE legal_entity_id=? AND issue_idempotency_key=? AND id<>? LIMIT 1",
            [sourceRows[0].legal_entity_id, requestIdempotencyKey, requestInvoiceId],
          );
          if (owners.length) {
            return jsonNoStore({ error: {
              code: "CONFIGURATION_CONFLICT",
              message: "Idempotency-Key has already been used for another invoice in this legal entity.",
            } }, 409);
          }
        }
      } catch {
        // Retain the safe original API error if collision reconciliation cannot complete.
      }
    }
    console.error("Invoice issuance failed", safeIssueErrorMetadata(error));
    return apiError(error);
  } finally {
    conn?.release();
  }
}
