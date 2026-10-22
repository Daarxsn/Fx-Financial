# Pack 8 Security, Correctness and Reliability — Audit Ledger

**Audit phase:** Pack 8 Part A — read-only review  
**Baseline commit:** `47769d809fe479cbda30d227cb7f7ad07e97f1d4`  
**Scope:** security-sensitive API paths, authentication/session controls, payment and document lifecycles, dependency/CI controls, and release configuration.  
**Method:** repository source review and existing CI/test inventory. No production database was accessed or changed. The findings below are not a claim that every one of the 76 route handlers has undergone an independent penetration test.

## Prioritized findings

| ID | Severity | Status at baseline | Finding | Impact | Planned closure evidence |
|---|---|---|---|---|---|
| P8-001 | High (P1) | Confirmed | Invoice draft creation checks a globally unique idempotency key and can return the prior invoice ID/status before validating that the caller has access to the payload's legal entity. | A user with invoice-create permission but no access to that entity may recover metadata for an existing invoice using a matching payload/key. | Scope-check before key lookup/replay; automated regression proves a no-scope caller receives a non-disclosing denial. |
| P8-002 | High (P1) | Confirmed | Quotation draft creation has the equivalent idempotency replay ordering issue. | A user with quotation-write permission but no access to the entity may recover quotation ID/status using a matching payload/key. | Scope-check before key lookup/replay; automated regression proves a no-scope caller receives a non-disclosing denial. |
| P8-003 | Medium (P2) | Confirmed | `next.config.ts` disables the powered-by header but does not define application-wide security headers. PDF responses set some headers independently; that does not protect HTML and JSON responses globally. | Clickjacking and browser-policy protections rely on page-specific behavior rather than a central release baseline. | Global CSP, frame, MIME, referrer, permissions and production HSTS headers; CI validator checks the configuration. |
| P8-004 | Medium (P2) | Confirmed | CSRF origin validation can infer the expected origin from request Host / forwarded scheme when `APP_ORIGIN` is absent, including in production. | A reverse-proxy configuration mistake or unexpected host routing can weaken the intended explicit public-origin deployment contract. | Fail closed for unsafe requests in production when exact HTTPS `APP_ORIGIN` is absent/invalid; document the exact per-environment setting. |
| P8-005 | Medium (P2) | Confirmed | CI installs with `npm ci --no-audit` and does not run an explicit dependency advisory audit. Secret scanning is already present. | Known dependency advisories can go unreported by the release pipeline. | Add an explicit high-severity dependency audit to CI and preserve its result on the release SHA. |
| P8-006 | Medium (P2) | Needs measured evidence | Query code has explicit pagination caps on core invoice, quotation and payment lists and fixed-size document/email histories. A repository pass alone does not establish query latency or lock behavior at realistic table volume. | Large-volume performance and contention behavior remain unmeasured. | Add a reproducible query-plan/volume verification step where it can run safely on disposable CI data; record measurements and limitations. |
| P8-007 | Medium (P2) | Needs operational verification | Production secret scopes, provider database grants, actual Vercel environment values, backup policy, object-storage access and production TLS cannot be proved from this source review. | These remain release gates for Pack 9 and are not represented as passed by Pack 8 engineering tests. | Pack 9 verifies the deployed provider configuration and recovery drill without exposing values. |

## Controls observed at baseline

- Session lookup checks expiration, idle timeout, revocation, and active-account status in MySQL; current roles, permissions and legal-entity access are reloaded from the RBAC tables instead of trusting client-held claims.
- Mutating browser routes generally call the shared CSRF verifier. It checks Origin/Referer, the same-site fetch signal, a cookie/header token match using constant-time comparison, and the session-bound CSRF hash.
- Login and account-activation flows use the database-backed rate-limit buckets; forwarded client IP headers are only considered when the deployment explicitly enables `TRUST_PROXY_HEADERS`.
- Invoice issuance, quote conversion, payments and reversals use transactional locking and idempotency/version controls in their respective workflow paths. Invoice and quotation draft-create **replay ordering** is the exception captured above.
- Document access resolves the generated-document record, checks source-specific read permission and legal-entity scope, then reads private storage and verifies size/SHA-256 before returning the PDF. Storage configuration restricts production to private object storage and validates object integrity.
- Webhook input is bounded and signature-checked; the email worker uses row leases and `SKIP LOCKED`; API errors are generally returned through a no-store envelope with request IDs and without stack traces.
- Existing CI already runs the database migration/restore checks, secret-history scan, auth/API contract harness, financial-calculation tests, PDF/private-storage tests, lint, TypeScript, production build, and Playwright acceptance.

## Part A decision

Part A identified two authorization replay defects and three release-hardening gaps. They are not accepted exceptions. Part B must fix P8-001 through P8-005, add regression/CI gates, rerun the full suite on the resulting commit, and update this ledger with actual retest evidence. P8-006 is only closable to the degree that safe, repeatable CI measurements can be added; live-provider readiness belongs to Pack 9.

**No production-readiness or Pack 8 lock claim is made in this audit-only record.**
