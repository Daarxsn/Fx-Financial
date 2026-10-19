# Phases 01–06 closure gates (2026-10-16)

This is the pre-Phase-07 release checklist. Do not use this page to infer business approval.

## Verified in the developer's dedicated development environment

- [x] Aiven MySQL reachable with verified TLS: `npm run db:verify` passed with an active TLS cipher and `rejectUnauthorized=true`.
- [x] Migrations 001–010 applied to the selected empty development database, then safely rerun.
- [x] Reference seed safely rerun: 22 permission definitions, seven roles and baseline role-permission templates; no extra users or scopes created by the seed.
- [x] `/api/health` and `/api/v1/health` return HTTP 200 with `database: ok`.
- [x] Administrator bootstrap succeeded and the developer signed in locally.
- [x] Closure PR #4 merged to `main` as `7b7e591128facbb66beda6cbe4b781e42759d6ff`; PR #5 and PR #6 also merged, with consolidated `main` at `b8297972f31ab18d87632dfa718c4ef49c70d35e` and CI/bootstrap green.

## Code/document work merged to main (PRs #4, #5 and #6, plus follow-up commits)

- [x] Align global UI tokens to the uploaded brand guide's primary palette.
- [x] Add SVG logo/template reference reconstructions in PR #4; invoice-layout visuals remain reference-only and not active templates.
- [x] Replace stale repository audit text with a dated, evidence-bounded audit and document remaining gates in PR #4/#5.
- [x] PR #6 merge revision `c837e4fae5b6e0ec1dbc42828f2c46aff1c4ee69` passed post-merge CI/bootstrap: [CI](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38889236087), [bootstrap](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38889236031). The brand-picker/palette-validation follow-up and audit-branch history are now integrated into `main`; latest CI/bootstrap passed: [CI](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38893456152), [bootstrap](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38893456184).

## UI fidelity work merged in PR #6

- [x] Use exact supplied WebP exports for Falchion Xeniaa, MyFX POS, FX Digitech and Coworks in the UI; test WebP signatures, paths and expected CSS classes.
- [x] Keep three invoice-layout SVGs sanitized and reference-only rather than exposing raw sample sheets in `public/`.
- [x] PR #6 merged to `main` as `c837e4fae5b6e0ec1dbc42828f2c46aff1c4ee69`; post-merge CI and lockfile/bootstrap passed: [CI](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38889236087), [bootstrap](https://github.com/Daarxsn/Fx-Fanancial/actions/runs/38889236031).
- [x] Port the useful brand-selection changes from draft PR #3 directly onto `main` while retaining the newer WebP assets: approved logo picker, selected-brand template-preview logo, responsive picker styling, API palette allow-list validation, and overview mark. Current main CI/bootstrap passed at `b8297972f31ab18d87632dfa718c4ef49c70d35e`.
- [ ] Manually inspect desktop/tablet/mobile and light/dark logo sizing in a real browser.

## Must remain open until independently verified/approved

- [ ] Phase 02 business owner sign-off and finance/accounting policy approval; tax/legal review where applicable. The decision packet currently says PENDING.
- [ ] Confirm exact approved legal identity, actual brand-to-entity mapping, legal/tax registrations, rates, numbering, currency, rounding, payment and correction policy. Keep unknowns unconfigured.
- [ ] Review actual Aiven backup retention and complete a provider-level restore drill into an isolated environment.
- [ ] Approve RPO/RTO and monthly infrastructure spend ceiling.
- [ ] Review production database grants, session secret, HTTPS APP_ORIGIN, trusted ingress/proxy configuration and any company-mandated MFA/SSO controls.
- [ ] Approve the Google Fonts dependency or supply licensed self-hosted Sansation/Open Sans fonts.
- [ ] Perform manual desktop/tablet/mobile + light/dark visual review in a real browser.
- [ ] Implement/verify an actual branded PDF renderer, private object storage, authorized download and email delivery before claiming those capabilities are live.

## Explicit phase boundary

Phase 07 (customer and catalog master data) is **in progress** on `main`; see `docs/phase-07-customer-and-catalog.md` for what is implemented and what is still open. The gates above still apply and are not closed by Phase 07 work. A sample image or a template config JSON is not an issued invoice.
