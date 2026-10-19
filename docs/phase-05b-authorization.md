# Phase 05B — Role- and Permission-Based Authorization

## Scope

Phase 05B hardens authorization for the **currently implemented** protected API surface. It uses the database-backed session from Phase 05A and checks effective permissions on the server. The UI, role names, request bodies, and client-supplied scope are never proof of access.

## Role model and least privilege

The seven baseline role templates are `system_admin`, `finance_admin`, `invoice_creator`, `invoice_issuer`, `payment_recorder`, `approver`, and `auditor`. The reviewed catalog contains 24 permission keys, defined in `scripts/seed-reference.ts`.

The CI suite now compares the permission catalog and every persisted role-to-permission mapping against the exact baseline. Missing, additional, or reassigned permissions fail validation rather than passing based only on the total mapping count. The test also checks that effective permissions in authenticated session responses exactly match the database grants. `system_admin` intentionally is not a finance-data superuser, and `finance_admin` receives no automatic `users:manage` grant.

## Protected live endpoints

| Surface | Required permission and control |
|---|---|
| `GET /api/v1/customers` | `customers:read` |
| `POST /api/v1/customers` | `customers:create` and valid CSRF |
| `PATCH /api/v1/customers/{customerId}` | `customers:update`, expected version and valid CSRF |
| `POST /api/v1/customers/import` | `customers:create`, valid CSRF; commit also needs the validation token |
| `GET /api/v1/catalog/items` | `catalog:read` |
| `POST /api/v1/catalog/items` | `catalog:create` and valid CSRF |
| `PATCH /api/v1/catalog/items/{itemId}` | `catalog:update`, expected version and valid CSRF |
| `POST /api/v1/catalog/items/import` | `catalog:create`, valid CSRF; commit also needs the validation token |
| `GET /api/v1/users` | `users:manage` |
| `POST /api/v1/users/invitations` | `users:manage`, role-grant constraints and valid CSRF |
| `PATCH /api/v1/users/{userId}` | `users:manage`, self/admin/last-admin restrictions and valid CSRF |

The integration suite exercises all seven roles against the live session profile, the customer/catalog read routes, writes where the role lacks the relevant permission, and the user directory. Anonymous 401s, forged client claims, CSRF failures, invitation replay, suspended accounts, privilege-escalation denials, session invalidation on role/status/scope changes, logout/revoke-all, expiry and rate limiting remain covered.

## Entity scope and future endpoints

`requirePermissionForEntity` and `requireLegalEntityScope` provide server-side scope helpers. Effective permissions and assigned legal-entity IDs are resolved from current database mappings, not client claims. Current customer/catalog endpoints are global master-data surfaces; per-entity finance-resource filtering is not yet implemented on them.

Invoice, quotation, payment, approval, PDF/document download, email, reminder, audit search, report and export handlers are not all implemented as live routes. This phase does **not** claim a route is protected merely because it appears in OpenAPI or a permission key is defined. Before any future entity-sensitive handler ships, it must enforce the relevant permission and scope in both the handler and data query, apply CSRF to cookie-authenticated mutations, audit sensitive actions/exports, and include positive and negative cross-entity tests.

## Acceptance gate

**PASSED on commit `be0d8fdee22bc8a2076a33a3761db0222baa64ec`.** The full CI workflow passed, including the MySQL-backed authentication/authorization and master-data contract suite, migration/seed verification, OpenAPI validation, UI validation, lint, TypeScript and production build. The lockfile/bootstrap workflow also passed on the same commit.

- Full CI: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38354956754
- Lockfile/bootstrap: https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38354956749

