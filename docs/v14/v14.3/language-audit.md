# V14.3 · Language Audit (Workstreams D + F)

Goal: zero legacy inventory wording and zero operator jargon on operator-facing
surfaces. Enforced going forward by `scripts/verify-operator-language.mjs`
(`pnpm verify:operator-language`) and the owner-brain language firewall
(`src/lib/owner-brain/language.ts`).

## Scope

**Scanned (operator surfaces):** TODAY, Counter, Inventory, Purchasing,
Compliance, open/close/stock-count, guide/playbooks, and the text generators in
`src/lib/owner-brain/*` and `src/lib/domain/operator-guidance.ts` — 26 files.

**Exempt (by design):** the `/admin` "Business Insights" analysis hub (analysis,
health and confidence are *allowed* there), deploy/audit pages (`/admin/releases`
"Deployment Ledger", `/admin/audit`), the validation page, and the language
firewall dictionary itself. Comments are stripped before scanning, so
engineering notes that mention jargon do not count — only text the operator can
see is checked.

## Removed phrases → replacements

| Surface | Removed (legacy / wrong) | Replacement (V14-true) |
|---|---|---|
| `/admin/inventory` stock-honesty stamp (`admin-inventory-client.tsx:60`) | "Stock is intake/count based — **sales are not deducted automatically yet.**" | "**Collected orders are already taken off stock.** … Use Stock count to keep figures honest." (now matches `/admin/purchasing` exactly; restyled green to read as a truth statement, not a warning) |
| `purchasing-intelligence.test.ts` (comments, ll. 192–230) | "sales are not decremented", "intake/count based", "no-sales-decrement caveat" | Reframed to the **two-confidence-axes** model: data-quality cap ≠ inventory-truth; the order verb is gated downstream by the confidence→verb contract |

## Jargon firewall additions (`language.ts`)

The owner-brain firewall (`deJargon` + `FORBIDDEN_TERMS`, build-enforced by
`language.test.ts`) was extended with V14 inventory-truth jargon, each paired
with a plain-English translation:

| Forbidden | Translation |
|---|---|
| forecasted exhaustion / stock exhaustion | "when stock will run out" |
| stock discrepancy | "stock count that doesn't match" |
| inventory variance | "stock that doesn't add up" |
| stock reconciliation | "stock check" |
| movement ledger | "stock history" |
| shortfall event | "stock that ran short" |
| depletion failure | "a sale that didn't update stock" |
| inventory confidence | "how sure we are about stock" |
| confidence degraded | "needs a fresh count" |

(Pre-existing entries — yield variance, operational health, coverage ratio,
confidence score, margin*, depletion forecast, etc. — retained.)

## Result

- `pnpm verify:operator-language` → **PASS** (26 files, 0 violations).
- `language.test.ts` → every forbidden term has a translation and is removed by
  `deJargon` (idempotent).
- Manual review: the only factually-wrong legacy statement found was the
  inventory stock-honesty stamp; it is corrected and now agrees with the
  purchasing surface and V14 truth.

## Allowed operator vocabulary (reference)

The butcher should only ever see: **Count** this, **Sell** this first, **Order**
this, **Fix** this — plus plain explanations like "Stock keeps changing
unexpectedly." All produced by `operator-guidance.ts`.
