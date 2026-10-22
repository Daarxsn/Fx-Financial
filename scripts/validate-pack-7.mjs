import { readFile } from "node:fs/promises";

const paths = [
  "src/lib/reports/service.ts", "src/lib/reports/http.ts", "src/lib/audit/service.ts",
  "src/app/api/v1/reports/summary/route.ts", "src/app/api/v1/reports/invoices/route.ts",
  "src/app/api/v1/reports/quotations/route.ts", "src/app/api/v1/reports/payments/route.ts",
  "src/app/api/v1/reports/customers/route.ts", "src/app/api/v1/audit/route.ts",
  "src/app/api/v1/reports/invoices/export/route.ts", "src/app/api/v1/reports/quotations/export/route.ts",
  "src/app/api/v1/reports/payments/export/route.ts", "src/app/api/v1/reports/customers/export/route.ts",
  "src/components/report-workspace.tsx", "src/components/audit-workspace.tsx", "src/components/dashboard-report-summary.tsx",
  "src/app/(workspace)/[section]/page.tsx", "src/components/app-shell.tsx",
  "src/lib/master-data/csv.ts", "docs/pack-7-metric-glossary.md", "scripts/verify-pack-7-api.mjs",
  ".github/workflows/ci.yml",
];
const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(path, "utf8")])));
const service=sources["src/lib/reports/service.ts"], http=sources["src/lib/reports/http.ts"];
const audit=sources["src/lib/audit/service.ts"], auditRoute=sources["src/app/api/v1/audit/route.ts"];
const glossary=sources["docs/pack-7-metric-glossary.md"], csv=sources["src/lib/master-data/csv.ts"];
const workflow=sources[".github/workflows/ci.yml"], apiTest=sources["scripts/verify-pack-7-api.mjs"];
const checks=[
 ["five report read APIs are wired",["summary","invoices","quotations","payments","customers"].every(name=>sources["src/app/api/v1/reports/"+name+"/route.ts"].includes("force-dynamic")&&sources["src/app/api/v1/reports/"+name+"/route.ts"].includes("handleReport"))],
 ["four CSV exports are POST-only and force-dynamic",["invoices","quotations","payments","customers"].every(name=>sources["src/app/api/v1/reports/"+name+"/export/route.ts"].includes("export async function POST")&&sources["src/app/api/v1/reports/"+name+"/export/route.ts"].includes("force-dynamic"))],
 ["report and domain read permissions are enforced",http.includes('requirePermission("reports:read")')&&http.includes("RESOURCE_PERMISSION[kind]")&&http.includes('requirePermission("invoices:read")')],
 ["legal-entity scope can only be narrowed",service.includes("unique.includes(requestedId)")&&http.includes("actor.legalEntityIds")],
 ["report dates are real and the inclusive period is bounded to 366 days",service.includes("dateValue(from)")&&service.includes("spanDays > 366")],
 ["pagination is bounded and empty later pages preserve true totals",service.includes("limit > 100")&&service.includes("offset > 1000000")&&service.includes("SELECT COUNT(*) AS total_count FROM (")],
 ["money is normalized as DECIMAL with BigInt",service.includes("DECIMAL(19,4)")&&service.includes("BigInt(parts[0])")],
 ["draft invoices are not presented as receivables",service.includes('outstandingBalance:r.lifecycle_status === "ISSUED"')],
 ["cancellations and credit/debit notes remain separately reported",service.includes("cancelledInvoiceValue")&&service.includes("creditNoteIssuedValue")&&service.includes("debitNoteIssuedValue")],
 ["won and expired quotation states are distinguished",service.includes("quotationsWonCount")&&service.includes("q.status='SENT'")],
 ["receipt values distinguish recorded, reversed and unapplied receipts",service.includes("payment_reversal_events")&&service.includes("unallocated_total")],
 ["current balance snapshots are separate from period movements",service.includes("currentOutstandingBalance")&&service.includes("currentOverdueBalance")],
 ["customer activity is linked through scoped documents",service.includes("WITH scoped_documents AS")&&service.includes("UNION SELECT q.legal_entity_id,q.customer_id,q.currency")],
 ["metric glossary retains finance owner approval gate",glossary.includes("business/finance approval pending")&&glossary.includes("PENDING_FINANCE_APPROVAL")],
 ["different currencies are never added together",glossary.includes("Amounts in different currencies are never added together")],
 ["exports use field allowlists, formula-safe CSV, CSRF, limits and audit",http.includes("EXPORT_FIELDS")&&http.includes("buildCsv")&&http.includes("assertCsrf(request)")&&http.includes("rowLimit > 10000")&&http.includes('"report.exported"')],
 ["report and audit pagination use the documented meta shape",http.includes("meta: { pagination: result.pagination")&&auditRoute.includes("meta: { pagination: result.pagination")],
 ["audit requires permission and omits raw payloads",auditRoute.includes('requirePermission("audit:read")')&&!audit.includes("before_json")&&!audit.includes("after_json")],
 ["audit search includes policy decisions, correction actions, payment reversals, documents, email and reminders",["business_policy_decision_events","invoice_correction_request_events","payment_reversal_events","generated_document_events","email_outbox_events","reminder_policy_events"].every(name=>audit.includes(name))],
 ["audit resources and operational events are scoped",audit.includes("scoped_audit_resources")&&audit.includes("allowed_entities")&&audit.includes("generated_document_events")&&audit.includes("email_outbox_events")&&audit.includes("reminder_policy_events")],
 ["report/audit screens are routed and nav is permission-filtered",sources["src/app/(workspace)/[section]/page.tsx"].includes("<ReportWorkspace />")&&sources["src/app/(workspace)/[section]/page.tsx"].includes("<AuditWorkspace />")&&sources["src/components/app-shell.tsx"].includes('permission: "reports:read"')&&sources["src/components/app-shell.tsx"].includes('permission: "audit:read"')],
 ["overview dashboard displays scoped metrics but hides them from users without reporting access",sources["src/components/dashboard-report-summary.tsx"].includes("/api/v1/reports/summary")&&sources["src/components/dashboard-report-summary.tsx"].includes("if (hidden) return null")&&sources["src/app/(workspace)/page.tsx"].includes("<DashboardReportSummary />")&&sources["src/components/dashboard-report-summary.tsx"].includes("currency")],
 ["CSV helper escapes formula-leading values",csv.includes("FORMULA_LEAD")&&csv.includes("FORMULA_LEAD.test(text)")],
 ["disposable MySQL tests cover scope, metrics, reversal history, redaction and exports",apiTest.includes('process.env.DATABASE_NAME !== "falchion_ci"')&&apiTest.includes("OUT-OF-SCOPE")&&apiTest.includes("payloadSecret")&&apiTest.includes('["quotations", "payments", "customers"]')&&apiTest.includes('summary.reversedReceiptValue, "5.0000"')&&apiTest.includes("emptyPage.payload.meta.pagination.total")],
 ["Pack 7 API integration runs in CI",workflow.includes("npm run pack7:api-test")],
];
for(const [name,passed] of checks){if(!passed){console.error("FAIL: "+name);process.exitCode=1;}else console.log("PASS: "+name);}
if(process.exitCode) console.error("Pack 7 reporting/audit contract validation failed."); else console.log("PASS: "+checks.length+" Pack 7 reporting/audit contract checks.");
