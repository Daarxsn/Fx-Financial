import { readFile } from "node:fs/promises";

const sources = {
  css: await readFile("src/app/globals.css", "utf8"),
  layout: await readFile("src/app/layout.tsx", "utf8"),
  shell: await readFile("src/components/app-shell.tsx", "utf8"),
  authForms: await readFile("src/components/auth-forms.tsx", "utf8"),
  primitives: await readFile("src/components/ui.tsx", "utf8"),
  overview: await readFile("src/app/(workspace)/page.tsx", "utf8"),
  paymentSummary: await readFile("src/components/payment-summary.tsx", "utf8"),
  paymentSummaryRoute: await readFile("src/app/api/v1/payments/summary/route.ts", "utf8"),
  sectionPage: await readFile("src/app/(workspace)/[section]/page.tsx", "utf8"),
  configurationSettings: await readFile("src/app/(workspace)/settings/page.tsx", "utf8"),
  brandAssets: await readFile("src/lib/brand-assets.ts", "utf8"),
  brandMark: await readFile("public/brand/falchion-xeniaa-mark.svg", "utf8"),
  configurationValidation: await readFile("src/lib/validation/configuration.ts", "utf8"),
  brandLogo: await readFile("public/brand/falchion-xeniaa-logo.webp"),
  myfxBrand: await readFile("public/brand/myfx-pos.webp"),
  digitechBrand: await readFile("public/brand/fx-digitech.webp"),
  coworksBrand: await readFile("public/brand/fx-coworks.webp"),
  myfxReference: await readFile("public/brand/templates/myfx-pos-sample.svg", "utf8"),
  digitechReference: await readFile("public/brand/templates/digitech-sample.svg", "utf8"),
  coworksReference: await readFile("public/brand/templates/coworks-sample.svg", "utf8"),
  workspaceLayout: await readFile("src/app/(workspace)/layout.tsx", "utf8"),
  proxy: await readFile("src/proxy.ts", "utf8"),
  loading: await readFile("src/app/loading.tsx", "utf8"),
  error: await readFile("src/app/error.tsx", "utf8"),
  notFound: await readFile("src/app/not-found.tsx", "utf8"),
};

const checks = [
  ["shared AppShell mounted at the app root", sources.layout.includes("<AppShell>{children}</AppShell>")],
  ["semantic skip link and main landmark", sources.shell.includes("Skip to main content") && sources.shell.includes('id="main-content"') && sources.shell.includes("<main")],
  ["primary navigation is labeled and active links expose aria-current", sources.shell.includes('aria-label="Primary navigation"') && sources.shell.includes("aria-current={active ? \"page\" : undefined}")],
  ["mobile menu exposes expanded state and has Escape/focus handling", sources.shell.includes("expanded={mobileOpen}") && sources.shell.includes('event.key === "Escape"') && sources.shell.includes("mobileWasOpen.current") && sources.shell.includes("document.body.style.overflow")],
  ["theme switch persists preference and sets document theme", sources.shell.includes('localStorage.setItem("fx-theme", next)') && sources.shell.includes("document.documentElement.dataset.theme = next")],
  ["light and dark tokens are defined centrally", sources.css.includes(":root {") && sources.css.includes(':root[data-theme="dark"]') && sources.css.includes("--canvas:") && sources.css.includes("--surface:") && sources.css.includes("--ink:")],
  ["keyboard focus indicator is globally visible", sources.css.includes(":focus-visible") && sources.css.includes("--focus:")],
  ["mobile/tablet breakpoints are defined", sources.css.includes("@media (max-width: 1120px)") && sources.css.includes("@media (max-width: 900px)") && sources.css.includes("@media (max-width: 650px)")],
  ["reduced-motion preferences are respected", sources.css.includes("@media (prefers-reduced-motion: reduce)")],
  ["loading, empty, error and success/notice primitives exist", sources.primitives.includes("function LoadingState") && sources.primitives.includes("function EmptyState") && sources.primitives.includes("function ErrorState") && sources.primitives.includes("function InlineAlert")],
  ["accessible form and table primitives exist", sources.primitives.includes("function TextField") && sources.primitives.includes("function SelectField") && sources.primitives.includes("function TextAreaField") && sources.primitives.includes("function FieldError") && sources.primitives.includes("function DataTable") && sources.primitives.includes("function PaginationControls") && sources.css.includes(".data-table-scroll") && sources.css.includes(".form-control--invalid")],
  ["live notification region and confirmation dialog are accessible", sources.primitives.includes("aria-live=") && sources.primitives.includes('role="dialog"') && sources.primitives.includes('aria-modal="true"') && sources.primitives.includes('event.key !== "Tab"')],
  ["route-level loading, error and not-found experiences exist", sources.loading.includes("LoadingState") && sources.error.includes('role="alert"') && sources.notFound.includes("This page isn’t here.")],
  ["Phase 6 settings includes a live, non-issued document template preview", sources.configurationSettings.includes('aria-label="Live document template preview"') && sources.configurationSettings.includes("DOCUMENT PREVIEW") && sources.configurationSettings.includes("NOT ISSUED")],
  ["template preview safely handles malformed JSON and does not expose actual bank details", sources.configurationSettings.includes("Invalid JSON should not be rendered as a document.") && sources.configurationSettings.includes("no bank information is shown in this preview")],
  ["supplied corporate logo WebP is valid and used in shell/auth UI", sources.brandLogo.subarray(0,4).toString("ascii")==="RIFF" && sources.brandLogo.subarray(8,12).toString("ascii")==="WEBP" && sources.shell.includes("/brand/falchion-xeniaa-logo.webp") && sources.authForms.includes("/brand/falchion-xeniaa-logo.webp") && !sources.shell.includes('<span className="brand-mark">FX</span>') && !sources.authForms.includes('<span className="brand-mark">FX</span>')],
  ["brand guide palette is centralized and primary fonts have fallbacks", sources.css.includes("--gold: #DCAF51") && sources.css.includes("--red: #931314") && sources.css.includes("--canvas: #F4F4F5") && sources.css.includes('"Sansation"') && sources.css.includes('"Open Sans"')],
  ["all three product logo WebPs are valid and referenced", sources.myfxBrand.subarray(0,4).toString("ascii")==="RIFF" && sources.myfxBrand.subarray(8,12).toString("ascii")==="WEBP" && sources.digitechBrand.subarray(0,4).toString("ascii")==="RIFF" && sources.digitechBrand.subarray(8,12).toString("ascii")==="WEBP" && sources.coworksBrand.subarray(0,4).toString("ascii")==="RIFF" && sources.coworksBrand.subarray(8,12).toString("ascii")==="WEBP" && sources.configurationSettings.includes("/brand/myfx-pos.webp") && sources.configurationSettings.includes("/brand/fx-digitech.webp") && sources.configurationSettings.includes("/brand/fx-coworks.webp")],
  ["three SVG reference layout reconstructions are present and explicitly not issued", sources.myfxReference.includes("NOT ISSUED") && sources.digitechReference.includes("NOT ISSUED") && sources.coworksReference.includes("NOT ISSUED") && sources.configurationSettings.includes("not pixel copies of the source sheets") && sources.configurationSettings.includes("Reference only · not active") && sources.configurationSettings.includes("Invoice layout reference reconstructions") && !sources.configurationSettings.includes("Approved invoice sample references")],
  ["logo JSX classes have corresponding size/contrast styles", sources.css.includes(".sidebar-brand__logo-wrap") && sources.css.includes(".sidebar-brand__logo {") && sources.css.includes(".auth-card__logo-wrap") && sources.css.includes(".auth-card__logo {") && sources.css.includes(".auth-card__brand-caption") && sources.css.includes(".config-template-paper__logo-image") && sources.css.includes(".config-template-reference-card__brand--myfx")],
  ["effective-date defaults use the configured business-date convention rather than UTC slicing", sources.configurationSettings.includes('new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"})') && !sources.configurationSettings.includes('const today=()=>new Date().toISOString().slice(0,10);')],
  ["overview reconciles scoped receivables instead of showing an unconnected activity placeholder", sources.overview.includes("<PaymentSummary />") && sources.paymentSummary.includes('fetch("/api/v1/payments/summary", { cache: "no-store" })') && sources.paymentSummaryRoute.includes('requirePermission("payments:read")') && sources.paymentSummaryRoute.includes("actor.legalEntityIds") && sources.paymentSummaryRoute.includes("outstanding_balance") && sources.sectionPage.includes('status: "Planned"') && sources.sectionPage.includes("Reports will be connected to verified data") && sources.sectionPage.includes("Audit events are not connected to this view yet")],
  ["workspace pages require a server-side active session", sources.workspaceLayout.includes("getSession()") && sources.workspaceLayout.includes('redirect("/login")')],
  ["cookie-less workspace navigation is redirected before rendering", sources.proxy.includes('request.cookies.get("fx_session")') && sources.proxy.includes('NextResponse.redirect(new URL("/login", request.url))') && sources.proxy.includes('pathname.startsWith("/api/")')],
  ["approved brand asset picker uses the supplied WebP identities and selected logo in preview", sources.brandAssets.includes("/brand/falchion-xeniaa-logo.webp") && sources.brandAssets.includes("/brand/myfx-pos.webp") && sources.brandAssets.includes("/brand/fx-digitech.webp") && sources.brandAssets.includes("/brand/fx-coworks.webp") && sources.configurationSettings.includes("brand-logo-picker") && sources.configurationSettings.includes("logoSource={selectedLogo.logoReference}")],
  ["overview illustration uses the dedicated Falchion mark asset", sources.brandMark.includes("<svg") && sources.brandMark.includes("</svg>") && sources.overview.includes('src="/brand/falchion-xeniaa-mark.svg"')],
  ["brand and template API validation reject unapproved accent colours", sources.configurationValidation.includes("approvedAccentColors") && sources.configurationValidation.includes("Accent must use an approved brand-guide colour.") && sources.configurationValidation.includes("accentColor: z.enum(approvedAccentColors)")],
];

for (const [name, pass] of checks) {
  if (!pass) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
  }
}

if (process.exitCode) {
  console.error("UI foundation checks failed.");
} else {
  console.log(`PASS: ${checks.length} responsive/accessibility/UI foundation checks.`);
}
