# Design System and UX Rules — Fx Financial

## 1. Design intent

The invoice generator is an internal financial operations product. Prioritize clarity, trust, low-friction billing, explicit choices, readable financial values and safe actions. A polished interface must never hide an unresolved issuer/tax/numbering decision or imply a financial action succeeded when it did not.

## 2. Brand system

Use the approved product palette consistently:

| Token | Value | Intended use |
|---|---|---|
| Gold | `#DCAF51` | Primary brand accent, highlights and selected emphasis |
| Saffron Red | `#931314` | Brand red and carefully used high-attention states |
| Charcoal | `#111111` | Dark surfaces and backing for gold marks where needed |
| Platinum | `#F4F4F5` | Light neutral surfaces |
| White | `#FFFFFF` | Primary light surfaces and contrast |

Use the exact supplied transparent WebP assets for Falchion Xeniaa, MyFX POS, FX Digitech and FX Coworks. Do not redraw, replace or distort supplied logos without approval. Ensure gold marks remain legible against suitable charcoal backing. Reuse existing CSS variables and components rather than introducing near-duplicate tokens.

## 3. Brand and issuer selection

- Make brand selection explicit when starting an invoice; do not silently preselect one.
- The three shipped brand choices are MyFX POS, FX Digitech and FX Coworks.
- Show the selected brand and the resolved legal issuer clearly, but do not conflate the two.
- If a mapping or required issuer configuration is absent, ambiguous, expired or unapproved, explain the blocker and prevent issuance.
- Keep company/brand setup in Settings; daily invoice creation should not require re-entering issuer data.

## 4. Invoice composer principles

- Optimize for a clear path: choose brand, choose/enter customer, set date and line items, optionally expand advanced discount/tax/catalog controls, review, then issue/send.
- Never silently choose the first customer. Keep customer fields blank or require an explicit existing-customer selection according to permissions.
- Show clear field-level validation and a concise form-level summary.
- Keep totals visible and explain discounts, tax and currency. Totals are server-calculated.
- Preserve invoice-specific recipient/billing details on save and reopen.
- If issuance is blocked, preserve the draft and display the actual reason. If issuance succeeds but email queuing fails, make the two outcomes distinct.
- Distinguish draft, issued, queued, accepted, delivered, failed, paid, partially paid and overdue states; only show states backed by server evidence.

## 5. Layout and interaction

- Reuse the existing application shell, spacing, typography, tokens and controls.
- Support desktop, tablet and mobile widths without horizontal overflow in core tasks.
- Prefer readable forms, stable table columns, sensible pagination and explicit filters.
- Provide loading, empty, error, disabled, success and retry states.
- Use confirmation and clear impact copy for irreversible or financially consequential actions.
- Maintain visible keyboard focus, semantic labels, logical tab order, accessible names, screen-reader status announcements and adequate contrast in light/dark modes.
- Avoid decorative motion that delays work or masks state changes.
- Do not rely on color alone to communicate errors, status or selected state.

## 6. Document design and PDFs

- Generate active PDFs using the real PDFKit renderer and the selected brand's approved issuer/configuration snapshot.
- Preserve the agreed A4 layout hierarchy: brand header, issuer block, BILL TO block, invoice metadata, line/milestone table, totals, amount in words, saved beneficiary/bank details, approved terms and signature area where configured.
- Never fill missing legal/tax/bank information with sample values.
- Do not serve raw sample sheets or reference images that expose example business/customer/financial details.
- Validate actual generated PDFs on screen and in print; SVG/reference previews are not proof of PDF output quality.
- Maintain private storage, checksums and authorization for history/download.

## 7. Content and error language

- Be concise, specific and actionable. State what happened, what did not happen and the next safe action.
- Never claim “sent” when only queued, “paid” without recorded allocation, or “issued” if issuance was blocked.
- Do not expose SQL errors, provider secrets or internal stack traces.
- Preserve entered draft data when safe; never conceal a failed save.
- Use explicit labels such as “Issue & send invoice” only where the action and split outcomes are clearly communicated.

## 8. UI acceptance checklist

- [ ] Brand assets and tokens are correct.
- [ ] No silent brand/customer defaults.
- [ ] Legal issuer and readiness blockers are understandable.
- [ ] Financial values and currency are legible and consistent.
- [ ] Loading/empty/error/disabled/success/retry states work.
- [ ] Keyboard, focus, contrast and semantic controls are checked.
- [ ] Desktop/tablet/mobile and light/dark layouts are manually reviewed.
- [ ] Actual PDF screen/print rendering is approved separately.
