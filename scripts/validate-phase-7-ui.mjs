import { readFile } from "node:fs/promises";

const [workspace, css, apiTests, workflow] = await Promise.all([
  readFile("src/components/master-data-workspace.tsx", "utf8"),
  readFile("src/app/globals.css", "utf8"),
  readFile("scripts/verify-master-data-api.mjs", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
]);

const permissionHelper = await readFile("src/lib/master-data/permissions.ts", "utf8");

const checks = [
  ["customer and catalog workspaces share the secured master-data component", workspace.includes('type Resource = "customers" | "catalog"') && workspace.includes('const basePath=resource==="customers"?"/api/v1/customers":"/api/v1/catalog/items"')],
  ["API reads are no-store and mutations obtain CSRF tokens", workspace.includes('cache:"no-store"') && workspace.includes("X-CSRF-Token") && workspace.includes("getCsrf=async")],
  ["search and status filters have explicit associated labels", workspace.includes('htmlFor={resource+"-search"}') && workspace.includes('htmlFor={resource+"-status"}')],
  ["list is a semantic table with status and action headings", workspace.includes('<table className="data-table">') && workspace.includes("<th>Status</th>") && workspace.includes("<th>Actions</th>")],
  ["pagination is bounded and exposes disabled previous/next states", workspace.includes('const [status,setStatus]=useState("active");const [offset,setOffset]=useState(0);const limit=25') && workspace.includes("disabled={offset===0||loading}") && workspace.includes("disabled={!pagination.hasMore||loading}")],
  ["create/edit form has a labelled section rather than a false modal-dialog declaration", workspace.includes('<section ref={editorPanelRef} className="master-data-panel" aria-labelledby="master-data-form-title">') && !workspace.includes('className="master-data-panel" role="dialog" aria-modal="true"')],
  ["customer and catalog required inputs are explicitly labelled", workspace.includes('customerFields.filter(f=>f.key!=="taxIdentifier"||permissions.includes("settings:manage")).map(f=><div className="form-field" key={f.key}>') && workspace.includes('catalogFields.map(f=><div className="form-field" key={f.key}>') && workspace.includes("htmlFor={f.key}")],
  ["customer contacts, billing/shipping addresses and restricted tax identifiers are represented", workspace.includes("legend>Billing address") && workspace.includes("legend>Shipping / service address") && workspace.includes("legend>Contacts (optional)") && workspace.includes("legend>Tax identifiers (optional)") && workspace.includes('permissions.includes("settings:manage")')],
  ["CSV import separates validation from commit and requires duplicate confirmation", workspace.includes('runImport("validate")') && workspace.includes('runImport("commit")') && workspace.includes("confirmDuplicates=true") && workspace.includes("I reviewed the duplicate warnings")],
  ["archive requires a reason and sends optimistic-concurrency version", workspace.includes("reason:archiveReason.trim()") && workspace.includes("expectedVersion:Number(archiveTarget.recordVersion)") && workspace.includes("minLength={3}")],
  ["detail view explains history and shows linked records only when API returns authorized fields", workspace.includes("Historical references") && workspace.includes("Invoices you can access") && workspace.includes("Quotations you can access")],
  ["master-data layout has responsive toolbar, forms, details and narrow-screen rules", css.includes(".master-data-toolbar") && css.includes(".master-data-form-grid") && css.includes(".master-data-detail__grid") && css.includes("@media (max-width: 650px)")],
  ["API integration tests cover customer/catalog permission-denied cases and archive/import routes", apiTests.includes("customers:create") && apiTests.includes("customers:update") && apiTests.includes("catalog:create") && apiTests.includes("catalog:update") && apiTests.includes("/archive") && apiTests.includes("/import") && apiTests.includes("/export")],
  ["Phase 7 UI validator is wired into CI", workflow.includes("Validate Phase 7 customer/catalog UI foundation") && workflow.includes("npm run phase7:ui-test")],

  ["create, update and archive permissions are independent", workspace.includes('const canCreate=permissions.includes(resource==="customers"?"customers:create":"catalog:create")') && workspace.includes('const canUpdate=permissions.includes(resource==="customers"?"customers:update":"catalog:update")') && workspace.includes('const canArchive=permissions.includes(resource==="customers"?"customers:archive":"catalog:archive")') && !workspace.includes("const canWrite=")],
  ["CSV commit sends the validation token and invalidates it when needed", workspace.includes('responseData.validationToken==="string"') && workspace.includes('"x-import-validation-token":importValidationToken') && workspace.includes("setImportValidationToken(null)") && workspace.includes("VALIDATION_TOKEN_EXPIRED")],
  ["server field errors are mapped to accessible form controls", workspace.includes("const serverFields=result.body.error?.fields;") && workspace.includes("controlIdForField(serverPath,contactIndexes,taxIndexes)") && workspace.includes('<FieldError id={f.key} errors={fieldErrors}/>') && workspace.includes('aria-invalid')],
  ["stale refresh responses cannot replace newer results", workspace.includes("const generation=++refreshGeneration.current") && workspace.includes("if(generation!==refreshGeneration.current)return;") && workspace.includes("if(generation===refreshGeneration.current)setLoading(false)")],
  ["editor and archive panels have keyboard focus management", workspace.includes("useDialogFocus(editorOpen,editorPanelRef") && workspace.includes("useDialogFocus(Boolean(archiveTarget),archivePanelRef")],
  ["reference counts use a readable summary", workspace.includes("{referenceSummary(resource,detail.referenceCounts)}") && !workspace.includes("{JSON.stringify(detail.referenceCounts)}")],
  ["API test source covers import-token rejection and duplicate confirmation", apiTests.includes("X-Import-Validation-Token") && apiTests.includes("VALIDATION_TOKEN_EXPIRED") && apiTests.includes("confirmDuplicates=true")],
  ["internal catalog descriptions require update or settings access", permissionHelper.includes('permissions.includes("catalog:update")') && permissionHelper.includes('permissions.includes("settings:manage")') && !permissionHelper.includes('permissions.includes("catalog:create")')],
];

for (const [name, pass] of checks) {
  if (!pass) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
  }
}
if (process.exitCode) console.error("Phase 7 UI validation failed.");
else console.log(`PASS: ${checks.length} Phase 7 UI and acceptance checks.`);
