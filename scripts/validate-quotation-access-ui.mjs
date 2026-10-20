import { readFile } from "node:fs/promises";

const [invoice, quotation, shell, access, accessPage, home] = await Promise.all([
  readFile("src/components/invoice-workspace.tsx", "utf8"),
  readFile("src/components/quotation-workspace.tsx", "utf8"),
  readFile("src/components/app-shell.tsx", "utf8"),
  readFile("src/components/access-workspace.tsx", "utf8"),
  readFile("src/app/(workspace)/access/page.tsx", "utf8"),
  readFile("src/app/(workspace)/page.tsx", "utf8"),
]);
const checks = [
  ["invoice workspace explicitly explains missing read permission", invoice.includes("Invoice access is not assigned") && invoice.includes("invoices:read")],
  ["invoice workspace explicitly explains missing draft-create permission", invoice.includes("Invoice creation permission required") && invoice.includes("invoices:draft:create")],
  ["invoice workspace explains legal entity/customer setup prerequisites", invoice.includes("Invoice creation is not configured") && invoice.includes("active legal entity")],
  ["quotation workspace explicitly explains missing write permission", quotation.includes("Quotation creation permission required") && quotation.includes("quotations:write")],
  ["users & access route is discoverable for authorized administrators", shell.includes('href: "/access"') && shell.includes('permission: "users:manage"') && accessPage.includes("<AccessWorkspace />")],
  ["dashboard directly exposes both invoice and quotation workspaces", home.includes('title: "Invoices"') && home.includes('href: "/invoices"') && home.includes('title: "Quotations"') && home.includes('href: "/quotations"')],
  ["dashboard explains draft conversion and current PDF/email limitations", home.includes("convert accepted quotes into invoice drafts") && home.includes("PDF generation and email delivery are not enabled yet")],
  ["invitation UI requires an explicit finance role and entity scope", access.includes("roleKeys: [roleKey], legalEntityIds: entityIds") && access.includes("Select at least one active legal entity")],
  ["activation link is treated as a one-time bearer secret", access.includes("single-use, 24-hour") && access.includes("Copy activation link") && access.includes("expiresInHours")],
  ["finance access is not silently elevated for system administrators", access.includes("System Administrator is intentionally not a finance superuser") && !access.includes('roleKeys.includes("finance_admin")')],
  ["team directory shows account state, role and legal-entity scope count", access.includes("Team access") && access.includes("legalEntityCount") && access.includes("accountStatus")],
];
for (const [name, pass] of checks) {
  if (!pass) { console.error("FAIL: " + name); process.exitCode = 1; }
  else console.log("PASS: " + name);
}
if (process.exitCode) console.error("Quotation-access UI validation failed.");
else console.log(`PASS: ${checks.length} quotation-access acceptance checks.`);
