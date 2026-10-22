import { readFile } from "node:fs/promises";

const paths = [
  "src/lib/reports/service.ts", "src/lib/reports/http.ts",
  "src/app/api/v1/reports/summary/route.ts", "src/app/api/v1/reports/invoices/route.ts",
  "src/app/api/v1/reports/quotations/route.ts", "src/app/api/v1/reports/payments/route.ts",
  "src/app/api/v1/reports/customers/route.ts", "docs/pack-7-metric-glossary.md",
];
const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(path, "utf8")])));
const service = sources["src/lib/reports/service.ts"], http = sources["src/lib/reports/http.ts"], glossary = sources["docs/pack-7-metric-glossary.md"];
const checks = [
 ["five report APIs are force-dynamic and routed to a shared handler", ["summary","invoices","quotations","payments","customers"].every(name => sources["src/app/api/v1/reports/"+name+"/route.ts"].includes("force-dynamic") && sources["src/app/api/v1/reports/"+name+"/route.ts"].includes("handleReport"))],
 ["reports and source-domain permissions are enforced", http.includes('requirePermission("reports:read")') && http.includes("RESOURCE_PERMISSION[kind]")],
 ["query scope can only narrow the session legal-entity set", service.includes("unique.includes(requestedId)") && http.includes("actor.legalEntityIds")],
 ["real date validation and 366-day maximum are enforced", service.includes("dateValue(from)") && service.includes("spanDays > 366")],
 ["pagination limit and offset are bounded", service.includes("limit > 100") && service.includes("offset > 1000000")],
 ["DECIMAL strings are bounded and normalized with BigInt", service.includes("DECIMAL(19,4)") && service.includes("BigInt(parts[0])")],
 ["invoice metrics keep cancelled/credit/debit documents separate", service.includes("cancelledInvoiceValue") && service.includes("creditNoteIssuedValue") && service.includes("debitNoteIssuedValue")],
 ["quotation reporting recognizes expiry and won statuses", service.includes("q.status='SENT'") && service.includes("'EXPIRED'") && service.includes("quotationsWonCount")],
 ["payment reporting separates receipts, reversals and unapplied value", service.includes("payment_reversal_events") && service.includes("unallocated_total")],
 ["current outstanding and overdue balances are separate from period flows", service.includes("currentOutstandingBalance") && service.includes("currentOverdueBalance") && service.includes("UTC_TIMESTAMP()")],
 ["customer report links customer rows to scoped document activity", service.includes("WITH scoped_documents AS") && service.includes("UNION SELECT q.legal_entity_id,q.customer_id,q.currency")],
 ["metric glossary explicitly leaves finance sign-off pending", glossary.includes("business/finance approval pending") && glossary.includes("PENDING_FINANCE_APPROVAL")],
 ["currency aggregation is deliberately separated", glossary.includes("Amounts in different currencies are never added together")],
 ["report queries use bounded LIMIT/OFFSET and stable ORDER BY", service.includes("ORDER BY") && service.includes("LIMIT ? OFFSET ?")],
];
for (const [name, pass] of checks) {
  if (!pass) { console.error("FAIL: "+name); process.exitCode = 1; }
  else console.log("PASS: "+name);
}
if (process.exitCode) console.error("Pack 7 Part A contract validation failed.");
else console.log("PASS: "+checks.length+" Pack 7 Part A contract checks.");
