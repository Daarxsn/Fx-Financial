# Pack 10 — Business UAT and controlled release

**Purpose:** prove the actual business workflows against an isolated non-production tenant, capture owner-specific acceptance, and make release eligibility a deliberate, evidence-backed decision.

**Release boundary:** Pack 10 does not override Pack 9. The Pack 9 readiness ledger currently reports open provider/recovery/monitoring gates. Pack 10 work can prepare the UAT process and automate its evidence contract, but production release remains blocked until Pack 9 is formally accepted against the exact candidate SHA.

## Part A — UAT tenant, role matrix, brand checks and end-to-end acceptance

### Environment and data rules

1. Use a dedicated non-production deployment and isolated database/storage bucket. Never point the UAT suite at production or run test imports, issued documents, test payments, or cleanup against a production tenant.
2. Use synthetic customer, catalogue, quotation, invoice, receipt and contact data. Record the fixture version, seed method, owner, creation date and disposal procedure. Do not copy real financial/customer records unless a privacy owner approved and documented the minimum required set.
3. Keep preview/staging secrets distinct from production. Use approved test email recipients/domains only; the evidence record must not include credentials, session cookies, private keys, raw customer payloads, or full financial document content.
4. Preserve enough synthetic evidence for reconciliation during the test window, then dispose of tenant data and temporary PDF/export/email fixtures using the environment's approved retention policy. Record disposal evidence.
5. Run automated cases against disposable MySQL and local/provider test doubles in CI first. External provider UAT is a separate step with a named operator and controlled data.

### Role acceptance matrix

| Role | Must succeed | Must be denied |
|---|---|---|
| Super Administrator | Manage authorized settings and users; inspect security/audit evidence; exercise the configured UAT brand/entity controls. | Cannot bypass required policy approvals, audit records, or server-side validation. |
| Finance / Operator | Manage only permitted customers/catalogue, quotations, invoices, PDFs, mail actions, payment/receipt and reporting tasks in assigned legal-entity scope. | Cannot use out-of-scope entity IDs, bypass approval separation, issue with unresolved issuer/tax/numbering settings, or exceed payment balances. |
| Read-only / limited | Read only the resources and reports explicitly granted by role and entity scope. | Cannot mutate drafts, issue/correct documents, configure a brand, record/reverse payments, or download restricted data without the matching permission. |

Role membership alone is not proof of authorization. Confirm endpoint-level permissions, entity scope, CSRF/origin checks and audit events with both allowed and prohibited requests.

### Brand and issuer acceptance

Run the configuration review independently for MyFX POS, FX Digitech, and FX Coworks. For each brand, verify and record the actual approved mapping for:

- legal issuer identity and legal-entity mapping;
- brand logo and invoice/quotation/receipt template;
- invoice and quotation numbering, including relevant financial-year rules;
- currency, payment terms/methods and approved tax registrations/rules;
- required legal/statutory disclosures and document fields;
- who approved the configuration, when, and the evidence/version reviewed.

A brand is not a legal entity. Do not infer an issuer mapping from a logo, template sample, or seed record. An unknown, ambiguous, expired or unapproved configuration is a failed UAT case and must not issue a financial document.

### Required UAT scenarios

The machine-readable scenario IDs in this directory are the canonical minimum contract. Every scenario needs a result, operator, timestamp, release SHA where applicable, and an evidence reference. A skipped, blocked or failed scenario does not count as passed.

| Area | Expected evidence |
|---|---|
| Tenant isolation | Non-production target identity; synthetic-only fixtures; access and cleanup confirmation. |
| Roles and scope | Positive and negative tests for administrator, finance/operator and read-only roles; cross-entity access denied. |
| Three brands | Approved issuer/settings mapping and readiness checks; invalid/unapproved configuration prevents issuance. |
| Customer/catalogue to quotation to invoice | Create/test customer and item, draft/send/accept quotation, safely convert to editable invoice draft, review and issue only after readiness approval. |
| PDF and email | Branded PDF generated from immutable source snapshot, private storage and checksum verified, authorized download confirmed; controlled email accepted/delivered and event history checked. |
| Payments and receipt | Partial then full allocation reconciled using exact decimal values; receipt identity/history confirmed; reversal and correction tested only under the approved policy. |
| Failure handling | Duplicate submission, timeout/retry, storage/PDF failure, email failure, stale edit, invalid tax, access denial, payment overrun and database outage. Recovery must be clear and no false success or duplicate financial side effect may occur. |
| Reporting/export | Reconcile report values to source API/database fixtures by legal entity and currency; never sum different currencies; verify CSV allowlists and spreadsheet-formula protection. |
| Manual acceptance | Desktop/tablet/mobile, keyboard, labels, contrast, focus/announcements, PDF visual inspection, and an explicit defect disposition. |
| Operations | Successful provider restore into an isolated target; measured RPO/RTO against approved targets; alert delivery; second-operator rollback/recovery rehearsal. |

### Part B — release evidence and controlled rollout

A release evidence file is a structured checklist record, not a substitute for inspecting the referenced evidence. The Pack 10 gate checker validates required fields and consistency and fails closed for missing, mismatched, pending or incomplete gates. A reviewer must still open the evidence links and confirm that they are authentic and relevant.

Before a release can be eligible, all of the following must be true:

1. Pack 9 is formally accepted for the exact release candidate; Preview deploys the same SHA and the deployment smoke succeeds.
2. The required UAT tenant and all canonical scenarios are passed, including the documented manual/operator cases.
3. All three brand configuration sheets have explicit approvals and the expected setting fields reviewed.
4. Business, finance/accounting, tax/legal (or evidenced not-applicable decision), security and operations each sign their own scope against the exact SHA.
5. The latest complete CI run passed against that exact SHA; secret scan and dependency review are resolved or have a documented, authorized exception.
6. Backup/restore, monitoring alert delivery, second-operator drill, production migration plan and rollback plan have evidence. Measured recovery must meet recorded, approved RPO/RTO targets.
7. The production change window and owner are approved, there are no open critical blockers, and a named decision-maker records GO against the exact SHA.
8. The release operator promotes only the tested commit, executes approved post-deploy smoke checks, observes the defined rollback triggers, and records the outcome.

The checker does not deploy, mutate production, perform a migration, contact the email provider, or certify evidence links. Production actions remain explicit operator responsibilities under the Pack 9 runbook.

### Commands

Run source-level checks and synthetic contract tests:

~~~bash
npm run pack10:validate
npm run pack10:gate-test
~~~

To check a completed evidence packet without deploying:

~~~bash
node scripts/check-pack-10-release-gate.mjs --evidence=/secure/path/pack-10-release-evidence.json --sha=<40-character-release-commit-sha>
~~~

Keep the completed evidence packet outside Git if it contains business-sensitive information. Do not commit credentials, customer data, private PDFs, cookies, or raw invoice exports. Any example/template must contain placeholders only.

### Known limitations and lock semantics

Pack 10 code can be integrated before business UAT occurs. **Pack 10 cannot be marked release-locked merely because its code/tests are green.** Lock requires a completed evidence ledger, exact-SHA green CI, signed area approvals, passed recovery and alert drills, an explicit GO decision, and a dated final release audit. A pending owner or missing proof keeps the release blocked.
