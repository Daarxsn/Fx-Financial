import { readFile } from "node:fs/promises";

const [invoice, quotation, shell, access, accessPage, home, css, proxy] = await Promise.all([
  readFile("src/components/invoice-workspace.tsx", "utf8"),
  readFile("src/components/quotation-workspace.tsx", "utf8"),
  readFile("src/components/app-shell.tsx", "utf8"),
  readFile("src/components/access-workspace.tsx", "utf8"),
  readFile("src/app/(workspace)/access/page.tsx", "utf8"),
  readFile("src/app/(workspace)/page.tsx", "utf8"),
  readFile("src/app/globals.css", "utf8"),
  readFile("src/proxy.ts", "utf8"),
]);
const checks = [
  ["invoice form labels are programmatically associated with unique controls", invoice.includes("const fieldId=useId()") && invoice.includes('htmlFor={fieldId}') && invoice.includes('cloneElement(children as ReactElement<{id?:string}>,{id:fieldId})')],
  ["invoice workspace explicitly explains missing read permission", invoice.includes("Invoice access is not assigned") && invoice.includes("invoices:read")],
  ["invoice workspace explicitly explains missing draft-create permission", invoice.includes("Invoice creation permission required") && invoice.includes("invoices:draft:create")],
  ["invoice workspace explains legal entity/customer setup prerequisites", invoice.includes("Invoice creation is not configured") && invoice.includes("active legal entity")],
  ["quotation workspace explicitly explains missing write permission", quotation.includes("Quotation creation permission required") && quotation.includes("quotations:write")],
  ["invoice tax options are filtered by selected document date", invoice.includes("r.effectiveFrom<=form.invoiceDate") && invoice.includes("r.effectiveUntil>=form.invoiceDate") && invoice.includes("not approved and effective for this invoice date")],
  ["quotation tax options are filtered by selected quotation date", quotation.includes("rule.effectiveFrom <= form.quotationDate") && quotation.includes("rule.effectiveUntil >= form.quotationDate") && quotation.includes("not approved and effective for this quotation date")],
  ["quotation status and conversion feedback survives detail refresh", quotation.includes("const openQuotation = async (id: string, preserveSuccess = false)") && quotation.includes("await openQuotation(pending.quotation.id, true)") && quotation.includes("await openQuotation(quote.id, true)")],
  ["quotation conversion retries reuse the same idempotency key per source quote", quotation.includes("conversionKeys.current[quote.id]") && quotation.includes("idempotencyKey,")],
  ["quotation draft-create idempotency rotates when line payload changes", quotation.includes("const updateLine = (key: string, patch: Partial<LineDraft>) => {") && quotation.includes('setCreateKey("q-" + crypto.randomUUID())')],

  ["users & access route is discoverable for authorized administrators", shell.includes('href: "/access"') && shell.includes('permission: "users:manage"') && accessPage.includes("<AccessWorkspace />")],
  ["dashboard directly exposes both invoice and quotation workspaces", home.includes('title: "Invoices"') && home.includes('href: "/invoices"') && home.includes('title: "Quotations"') && home.includes('href: "/quotations"')],
  ["dashboard explains draft conversion and current PDF/email limitations", home.includes("convert accepted quotes into invoice drafts") && home.includes("PDF generation and email delivery are not enabled yet")],
  ["public brand image assets bypass the login navigation gate", proxy.includes('pathname.startsWith("/brand/")')],
  ["mobile topbar hides redundant environment decorations below 520px", css.includes("@media (max-width: 520px)") && css.includes(".topbar .environment-pill, .topbar .topbar__divider { display: none; }")],
  ["invitation UI requires an explicit finance role and entity scope", access.includes("roleKeys: [roleKey], legalEntityIds: entityIds") && access.includes("Select at least one active legal entity")],
  ["activation link is treated as a one-time bearer secret", access.includes("single-use, 24-hour") && access.includes("Copy activation link") && access.includes("expiresInHours")],
  ["Super Administrator is explicitly labeled and explains global finance access", access.includes('label: "Super Administrator"') && access.includes("Full access to every implemented module") && access.includes('roleKeys: [roleKey], legalEntityIds: entityIds')],
  ["team directory shows account state, role and legal-entity scope count", access.includes("Team access") && access.includes("legalEntityCount") && access.includes("accountStatus")],
];
for (const [name, pass] of checks) {
  if (!pass) { console.error("FAIL: " + name); process.exitCode = 1; }
  else console.log("PASS: " + name);
}
if (process.exitCode) console.error("Quotation-access UI validation failed.");
else console.log(`PASS: ${checks.length} quotation-access acceptance checks.`);
