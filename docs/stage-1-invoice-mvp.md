# Stage 1 — Core Invoice MVP

**Status:** In progress — implementation slice committed; validation and browser acceptance pending  
**Decision date:** 2026-10-24  
**Branch policy:** `main` only; no branches  
**Primary journey:** Create → Preview → Issue/Send → Manage

## Product boundary

Stage 1 makes the everyday invoice workflow reliable before additional product expansion. Preserve the existing Next.js App Router, React, TypeScript, MySQL, PDFKit, private document storage and email outbox. Do not rewrite working infrastructure merely to simplify the user experience.

### In scope

- Visible route and create-invoice action for authorized users.
- Explicit brand, customer, invoice date and line-item entry.
- Draft save, reopen, edit and server-authoritative totals.
- Saved-data preview before issue/send, clearly distinguished from the final immutable PDF.
- Issuance gated on real, approved issuer, tax and numbering configuration.
- Verified PDF generation/download and permission-checked document history.
- Email queue, explicit recipient confirmation, delivery history, actionable failure and safe retry.
- Manual payment recording and understandable invoice/payment status.
- All seven root project documents kept aligned with verified implementation and open gates.

### Deferred

Do not expand the Stage 1 effort into quotation redesign, advanced reporting, broad CSV import/export, reminder automation, payment gateway or accounting/ERP capabilities unless needed to unblock a core invoice acceptance criterion. Existing secondary modules may remain in the repository.

## Baseline finding

The existing component and APIs did not guarantee a working user journey:

- `src/components/invoice-workspace.tsx` and invoice APIs existed.
- `src/app/(workspace)/invoices/page.tsx` was absent when checked, although navigation linked to `/invoices`.
- The `+ New invoice` action was hidden when issuer/brand/customer prerequisites were absent, rather than showing a visible blocker.
- Opening a draft automatically entered edit mode, making a separate details/preview state difficult to reach.
- PDF/email services already exist: the email outbox generates/verifies a PDF when queuing a send for an issued document. Provider delivery remains dependent on real sender configuration and the worker/provider path.

## Implementation changes on main

- [x] Added `src/app/(workspace)/invoices/page.tsx` to render the existing invoice workspace.
- [x] Added a prominent `Create new invoice` action to the workspace overview and corrected outdated messaging that PDF/email were not enabled in code.
- [x] Kept `+ New invoice` visible for users with `invoices:draft:create` when setup is incomplete; setup/customer blockers are surfaced.
- [x] Changed invoice opening to read/detail mode; edit mode is explicit.
- [x] Added a row-level Preview action and a saved-data invoice preview with print/save-to-PDF affordance.
- [x] Added regression assertions for route existence, home CTA, button visibility, preview access and draft detail/edit behavior.
- [x] Updated `prd.md`, `architecture.md`, `rules.md`, `phases.md`, `design.md`, `memory.md`, `agent.md` and `README.md`.

## Acceptance checklist

### Reachability and visibility
- [x] App Router page exists and renders the invoice workspace (source inspected).
- [x] Sidebar path already points to `/invoices`; the missing page was added.
- [x] Workspace overview has a direct create action (source inspected).
- [x] Create action no longer hides solely because company/brand/customer setup is incomplete (source inspected).
- [ ] Browser-verify intended roles can see and use actions; verify the denied-permission state.

### Draft and preview
- [x] Saved draft opens in details mode (source inspected).
- [x] Row-level and detail-level Preview actions are present (source inspected).
- [x] Dirty draft can be saved before preview; preview uses server-persisted totals (source inspected).
- [ ] Run `npm run invoice:simple-workflow-test` against the checked-out repository.
- [ ] Run lint, typecheck and production build.
- [ ] Browser-test create → save → reopen → preview on desktop and mobile.
- [ ] Manually review printed preview and final issued PDF side by side; this screen preview is not the final PDF.

### Issue and send
- [ ] Verify issuance success and expected blocking when real approved supplier/tax/numbering configuration is absent.
- [ ] Verify PDF generation success, retry/failure, storage checksum and authorized download in non-production.
- [ ] Verify email queue success and failure, worker/provider delivery states, failed-send retry and uncertain-delivery handling in non-production.
- [ ] Verify real sender/domain/provider delivery only after approved credentials and recipient test authorization are available.
- [ ] Do not label queued email as sent/delivered.

### Quality and release
- [ ] Inspect CI for the exact latest main commit. GitHub status was empty when checked after the code/documentation writes; this is not a passing CI result.
- [ ] Complete Product, Architecture, Financial Domain, Security/API, UI/Accessibility and QA review passes with concrete findings. These are review passes unless an actual subagent tool is available; do not claim spawned agents.
- [ ] Record manual browser evidence and unresolved business/provider approvals.
- [ ] Update this tracker and the seven root documents based on actual test results.

## Latest CI failure and correction

The failed CI run for [`8d74d63`](https://github.com/Daarxsn/Fx-Financial/commit/8d74d6307ec03a98ceb9bc978acba7c22f0849b2) was isolated to `npm run invoice:access-ui-test`. The product page had already been updated to describe the actual invoice workflow and correctly state that PDF/email require approved issuer setup and a verified sender configuration; the regression test still expected older copy saying those capabilities were not enabled and that accepted quotations convert directly to invoice drafts. The app behavior is intentional; the stale test assertion has been updated to validate the current user-facing contract. Re-run CI on the fix commit before marking validation complete.

## Current source-level verification (2026-10-24)

- Latest inspected main HEAD at this check: [df145c1](https://github.com/Daarxsn/Fx-Financial/commit/df145c1751831781b341ea6373e2ffad7bbf6f95).
- Source-level checks against fetched main files: **11/11 passed** for route rendering, sidebar route, home CTA, create-button visibility, row preview, save-and-preview/print affordance, detail-mode draft opening, email send/retry controls, PDF generation before email queueing, regression assertions and tracker pending status. These were static source assertions, **not execution of the project test script**.
- GitHub combined status returned no status checks for the inspected latest commit. Treat CI as pending/unverified, not passing.
- Relevant code commits: [route page](https://github.com/Daarxsn/Fx-Financial/commit/faf5442dc2f6741d6d75faa0f3ea0d9df18f42f4), [workspace create action](https://github.com/Daarxsn/Fx-Financial/commit/a924c8dac3bc80c16e8e6c699f9fd84a01de4de7), [visible preview workflow](https://github.com/Daarxsn/Fx-Financial/commit/5dac18b131ce8648aa557aa49ff4b6f20ba45ade), [direct row preview](https://github.com/Daarxsn/Fx-Financial/commit/31624738d897ad82f09289a97279dfa1b8fb6c00), and [regression assertions](https://github.com/Daarxsn/Fx-Financial/commit/c685cd9cc120c4adaf99a2af2dcb452064757a87).

## Known limitations

- The current screen preview is a readable preview of saved invoice data; it is not the generated, immutable issue-time PDF and does not independently display all issuer/customer address fields from the approved snapshot.
- No local repository checkout was available in the execution environment, and cloning from GitHub failed due to DNS/network resolution. Source-level inspection was possible through the connected GitHub integration; local lint/typecheck/build and browser checks were not run.
- No live database mutation, invoice issuance, PDF storage operation or live email delivery was performed.

## Next action

Obtain a local/CI run for the exact latest main commit, fix any compile or workflow-test failures directly on `main`, then browser-verify the full create/preview/issue/send/manage journey in a non-production environment.
