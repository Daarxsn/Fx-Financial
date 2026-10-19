# Phase 05 — Authentication and Access Control

**Status:** **Phase 05 acceptance gate PASSED** for the implemented local-password authentication and current protected API surface on code revision `36af6321f4584726acc7226775c4d6343bd7aac1`. CI and lockfile/bootstrap passed, including negative authorization, idle/absolute expiry, revocation, migration 004, OpenAPI validation, lint, TypeScript and production build. The shared client shell also gates workspace rendering while the current session is checked. This does not imply that future business APIs, SSO/MFA, automated invitation delivery or a live Aiven rollout are complete.

## 1. Implemented authentication strategy and limits

The initial supported strategy is **invited local-password accounts**. Users are not self-registered. An administrator who already has `users:manage` creates an invitation, chooses approved role templates and legal-entity scopes, then delivers the one-time activation token to the invitee through the company's approved secure channel.

- `/login`: email/password sign-in.
- `/activate`: invited account password setup from a single-use token.
- `GET /api/v1/auth/csrf`: short-lived, host-only CSRF cookie and bootstrap token.
- `POST /api/v1/auth/login`: credential verification, rate limit, session creation and success/failure security event.
- `POST /api/v1/auth/logout`: revokes current session and clears auth cookies.
- `GET /api/v1/auth/me`: current active user, current roles/permissions/scopes and session expiry.
- `POST /api/v1/auth/activate`: consumes invitation and activates account transactionally.
- `POST /api/v1/auth/sessions/revoke-all`: revoke all sessions for current user.
- `GET /api/v1/users`: protected user directory.
- `POST /api/v1/users/invitations`: protected invitation creation with role and entity scoping.
- `PATCH /api/v1/users/{userId}`: protected account-status, role and legal-entity-scope management; privilege changes revoke sessions.

External OIDC/SSO, MFA/step-up, password reset/recovery, automated invitation email delivery, emergency access and identity-provider federation are **not implemented** in this pass. Do not claim them as capabilities. The invitation API returns a newly generated activation token once to a caller with `users:manage`; the API uses no-store and never logs the token. The caller must deliver it out-of-band through an approved secure channel until a mail provider and its controls are configured.

## 2. Credentials, token and session handling

- `app_users.password_hash` stores scrypt hashes only; raw passwords are never persisted. Current policy is 12–128 characters.
- Successful sign-in generates an unpredictable opaque token. Only its SHA-256 hash is stored in `auth_sessions`; the token itself is delivered only through the `HttpOnly` `fx_session` cookie.
- Cookie flags: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, eight-hour absolute lifetime. The session is rejected after 30 minutes of inactivity. Last activity is refreshed at most once every five minutes.
- Every protected request looks up the live session and checks revocation, expiration, idle time and current account status. Suspended or deactivated accounts are denied immediately.
- Roles, permissions and legal-entity access are read from current database assignments at request time. The cookie does not carry authoritative client-controlled roles/permissions/scopes.
- Logout marks the row revoked before clearing cookies. Account status, role or scope changes revoke all sessions for the affected user. Revoke-all also supports self-service session invalidation.
- Session tokens are not stored in localStorage/sessionStorage or returned from the login response body.
- The activation token is random, hashed before persistence, 24-hour expiry, single-use and transactionally consumed. The UI removes the token query string from the visible URL after hydration and the app sets a `no-referrer` metadata policy.

## 3. CSRF and same-origin protection

- Cookie-authenticated unsafe requests require an `X-CSRF-Token` header matching the readable, host-only `fx_csrf` cookie.
- State-changing requests must include an `Origin` or `Referer` matching the expected origin; `Sec-Fetch-Site: cross-site` is rejected. `APP_ORIGIN` may pin the exact public origin (scheme and host, no path); in production it must use HTTPS. If unset, the checker compares the origin with the received `Host` and the first `X-Forwarded-Proto` value or request protocol. Behind a reverse proxy, set `APP_ORIGIN` to the public origin and allow forwarding headers only from the trusted proxy.
- For an authenticated request, the CSRF token hash must also match the hash stored against the current server-side session.
- CSRF validation is applied to login, logout, invitation activation, session revocation, invitation/user administration and customer/catalog mutations. Authentication/authorization still runs independently after CSRF validation.
- CSRF rejections return a generic client error. Server diagnostics, when enabled in logs, contain only a fixed reason category, never the actual cookie/header token.

## 4. Rate limits and security-event logging

Migration `004_auth_sessions_and_security.sql` adds session, invitation, rate-limit and security-event tables.

| Scope | Current limit | Response |
|---|---|---|
| Login per normalized email | 5 attempts per 15-minute window | HTTP 429 with `Retry-After` |
| Login per source IP | 20 attempts per 15-minute window, only when a trusted proxy source IP is configured | HTTP 429 with `Retry-After` |
| Invitation activation token | 10 attempts per 15-minute window | HTTP 429 with `Retry-After` |
| Invitation create per administrator | 20 attempts per 15-minute window | HTTP 429 with `Retry-After` |

Rate-limit identifiers are HMAC digests rather than raw emails, tokens or IPs. These are per-database buckets, not a distributed edge/WAF rate limit. IP-based throttling and source-IP event metadata use forwarded headers only when `TRUST_PROXY_HEADERS=true`. Set that flag only when the application is reachable through a trusted ingress that strips inbound client-supplied `X-Forwarded-For` / `X-Real-IP` and writes its own values. When the flag is unset, the app deliberately ignores those headers, skips the IP bucket, and retains the email and invitation-token throttles. Do not expose the application directly while trusting proxy headers.

Security events record action, outcome and optional actor/subject/network metadata. Subject/IP/user-agent values are keyed HMAC digests using `SESSION_SECRET`, including source metadata copied to session rows; credentials, passwords, session cookies, CSRF tokens and invitation bearer tokens are not persisted to logs. Auth events are separate from business audit events.

## 5. Roles and permission templates

Reference seed supplies 24 permission keys and seven role definitions (Phase 07 migration 016 split `customers:write`/`catalog:write` into `:create` and `:update`). On first seed only, when `role_permissions` is empty, it assigns a baseline least-privilege permission template to each role. It never creates users, assigns roles to users, or grants legal-entity scopes. If role-permission mappings already exist, the seed does not overwrite them.

| Role key | Baseline responsibility | Important boundary |
|---|---|---|
| `system_admin` | User access, application settings and audit read | No automatic invoice issue, payment reversal or other financial mutation grant |
| `finance_admin` | Approved finance master data and finance workflows | No automatic user administration grant |
| `invoice_creator` | Customer/catalog read and write; invoice draft and quotation work | Cannot issue/cancel invoices or reverse receipts under the baseline |
| `invoice_issuer` | Read customer/catalog/invoices and issue within assigned scope | Does not get payment reversal or user administration |
| `payment_recorder` | Read customers/invoices/payments and record payments | Reversal remains a distinct permission |
| `approver` | Read and decide approval requests | Assignment thresholds/self-approval rules still require business workflow implementation |
| `auditor` | Read-only access to the explicitly granted read surfaces and audit | No customer/catalog/finance mutation grants |

Access still requires both the specific permission and legal-entity scope where applicable. These are starter templates, not approval to assign any actual staff member or issuer entity.

## 6. User and privilege lifecycle

- Invitation creates an `INVITED` local-password account, role mappings, approved entity scopes and hashed single-use token in a transaction.
- Account activation uses a password policy, hashes the password, changes status to `ACTIVE`, consumes the token and revokes other outstanding invitations.
- User administration supports `ACTIVE`, `SUSPENDED` and `DEACTIVATED`; invitation activation transitions from `INVITED` to `ACTIVE`.
- A status, role or scope change is audited and revokes active sessions immediately.
- A user cannot change their own administrative record through the current user-admin route; this avoids accidental lockout.
- Only an existing `system_admin` may grant/change a `system_admin` assignment. The final active system administrator cannot be demoted or suspended.
- Passwordless invitation records cannot be changed directly to `ACTIVE`; activation through the single-use flow must set a password first.
- A one-time bootstrap script creates the first system administrator when no user has the `system_admin` role. It requires explicit confirmation and environment-provided values; no account or password is committed to source code.

### One-time first administrator bootstrap

After applying the migrations and seeding role templates in the intended database, set the following **in the operator's private shell/deployment environment only** and run `npm run auth:bootstrap-admin`:

- `BOOTSTRAP_ADMIN_CONFIRM=CREATE_FIRST_ADMIN`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_PASSWORD` (12–128 characters)
- Existing database connection/TLS variables and `SESSION_SECRET`
- Optional `BOOTSTRAP_ADMIN_LEGAL_ENTITY_IDS` with only approved entity UUIDs; leave unset if no issuer scope has been approved yet.

Do not store these in a tracked `.env` file, paste them into chat, or include them in CI secrets for ordinary application builds. The script is one-time by design, checks for an existing system-admin assignment and prints no credential values. Run it only against the deliberately selected target database. Confirm the actual legal entity mappings before giving any user a billing scope.

## 7. Server-side authorization boundaries

- The default is deny. API handlers call `requirePermission` against the current session's permission set.
- Client-provided permission, role, actor ID and legal-entity scope are not trusted.
- Customer/catalog create routes require write permissions and CSRF; list routes require read permission.
- User directory, invitation creation and user privilege changes require `users:manage`, with additional system-admin and last-admin checks.
- Cross-entity access helpers are available; resource endpoints that operate on a legal-entity resource must call `requirePermissionForEntity`/equivalent and enforce scope in the SQL/service predicate. An ID's existence is not access authorization.
- Future invoice/quotation/payment/document/PDF/export/report routes still need their own server-side permission and scope checks when implemented. The OpenAPI `x-implementation-status` marker distinguishes real routes from planned workflows. This phase does not claim unavailable business routes are protected by their presence in the spec.
- Private downloads, server actions and background jobs must use the same authorization boundary when those capabilities are introduced; never rely on disabled buttons or hidden UI.

## 8. Negative authorization test coverage

The CI API contract test was upgraded from client-signed permission claims to database-created test users with seeded role grants and actual sign-in. It is designed to assert:

- Unauthenticated customer reads are denied with 401.
- Anonymous workspace page requests redirect to sign-in before content is served.
- A forged, client-claimed signed permission payload without a matching database session cannot authenticate.
- The server-side workspace layout redirects unauthenticated requests; client-side navigation stays behind a loading/redirect state while `/api/v1/auth/me` verifies the current session.
- Authenticated writes without a CSRF header are rejected.
- Wrong CSRF tokens and cross-origin / `Sec-Fetch-Site: cross-site` unsafe requests are rejected.
- An invoice-creator role can use allowed master-data routes.
- An auditor can read but cannot write customer records or list users.
- A finance administrator without `users:manage` cannot create invitations or escalate privileges; an administrator cannot edit their own privileged account through the user-management endpoint.
- Suspended accounts cannot log in.
- Valid invitation activation works; replaying its token fails.
- Role changes and entity-scope changes invalidate old sessions; tests verify that removing an assigned entity scope revokes the prior session. Suspended accounts lose access.
- Logout invalidates replayed old cookies; revoke-all invalidates existing sessions.
- Idle and absolute session expiry both deny a previously valid cookie.
- Account rate limits return 429 with `Retry-After`.
- Existing customer/catalog request validation, response envelopes, pagination and exact-decimal serialization remain covered.

**Completion gate: PASSED** for the implemented authentication and currently exposed protected surfaces. Evidence: [CI run 38072384541](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38072384541) and [lockfile/bootstrap run 38072384583](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38072384583), both on code revision `36af6321f4584726acc7226775c4d6343bd7aac1`.

## Phase 05B authorization-matrix regression gate

**Status: PASSED** on commit `be0d8fdee22bc8a2076a33a3761db0222baa64ec`. CI asserts the exact 22-key permission catalog, all seven least-privilege role mappings, and effective permission/read-write outcomes on all currently implemented customer, catalog and user-directory endpoints.

- Full CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38354956754
- Lockfile/bootstrap: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38354956749

Future invoice/document/download/export APIs remain out of scope until implemented with explicit entity-scope guards and negative tests.

## 9. Remaining production decisions and limitations

- Confirm whether company-managed OIDC/SSO, MFA and step-up are required before general production rollout. Local-password authentication is implemented for invited users; that is not a substitute for those requirements if policy mandates them.
- Configure secure invitation delivery and password recovery before relying on manual activation token transfer at scale.
- Configure `TRUST_PROXY_HEADERS=true` only after verifying that a trusted ingress overwrites forwarded headers and blocks direct app access; otherwise leave it unset and rely on the email/invitation throttles until a trusted source-IP signal is available.
- Review external edge/WAF rate limiting and security-event/session retention before production deployment.
- Apply migration 004 and seed role templates only after confirming the intended Aiven database, backup/restore readiness and appropriate runtime grants.
- Assign no actual users or entity scopes until the authorized business owner approves the staff roster, roles and legal-entity mappings.
- The permission and account tables exist, but each future invoice/payment/file/export/report handler must independently enforce permission and entity scope before that feature can ship.

Phase 05 is accepted for the local-password/session/RBAC foundation and its current protected surfaces. Future invoice/payment/document/download/export routes must add entity-scope and negative authorization tests when implemented. CI success is not production SSO/MFA approval, mail configuration, approval of actual user/entity assignments, or a live Aiven migration.
