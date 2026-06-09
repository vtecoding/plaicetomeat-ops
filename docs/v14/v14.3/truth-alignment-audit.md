# V14.3 · Truth Alignment Audit (Workstream E)

Goal: every operator surface agrees with the V14 inventory truth model. No
surface may contradict another or the engine.

## The single source of operator truth

1. **Collected orders reduce stock.** Depletion happens on `ORDER_COLLECTED`
   (V14.1). Every surface that mentions stock must reflect this — none may say
   stock is "intake/count based" or that "sales are not deducted".
2. **Low inventory-truth confidence → Count, never Sell/Order.** Enforced by the
   confidence→verb contract (`confidence-routing.ts`), applied on TODAY *and* the
   purchasing page (`buildPurchasingRecommendations` low-confidence suppression).
3. **Repeated discrepancies reduce trust → strongest action.** Recurring
   instability escalates to "count today" with "Stock keeps changing
   unexpectedly" (`operator-guidance.ts`).
4. **Expiry and purchasing use live stock.** Both read the depleted, live batch
   state — not a pre-sale figure.
5. **The operator never sees confidence, scores, variance, or ledger mechanics.**
   Enforced by the language firewall + `verify-operator-language`.

## Per-surface verdicts

| Surface | Source | Verdict | Notes |
|---|---|---|---|
| **TODAY** (`/admin/today`) | `owner-brain/*`, `operator-guidance` via findings | ✅ Aligned | Guidance runs through the confidence→verb chokepoint; text through `deJargon`. |
| **Counter** (`counter-dashboard.tsx`) | server `stockNote` on collect | ✅ Aligned | Shows plain "collected orders move stock" confirmation (V14.1). No legacy wording. |
| **Inventory / Stock** (`admin-inventory-client.tsx`) | stock-honesty stamp | ✅ Fixed | Was "sales are not deducted automatically yet" (false). Now "Collected orders are already taken off stock." — identical to purchasing, restyled as a truth statement. |
| **Purchasing** (`/admin/purchasing`) | `getPurchasingPlan` → `buildPurchasingRecommendations` | ✅ Fixed | Honesty stamp already correct. **Closed the bypass**: order advice now suppressed for low-confidence products via `lowConfidenceProductNames`, reusing `getInventoryTruthGuidance`. The page can no longer say "Order" for a product TODAY says to "Count". |
| **Decision detail** (`/admin/today/[id]`) | owner-brain decision | ✅ Aligned | Renders the same decision objects; no independent stock claims. |
| **Guided flows** (`/admin/today/walk`, open/close/stock-count) | checklist + guidance | ✅ Aligned | No legacy inventory wording (guard-scanned). |

## Contradiction found & resolved

- **Inventory ↔ Purchasing disagreement.** The Stock page claimed sales were not
  deducted while the Purchasing page (correctly) said collected orders are taken
  off stock. The two surfaces now state the **same** sentence. *(Fixed in
  Workstream D; see language-audit.md.)*
- **Purchasing page bypassed the confidence contract.** `getPurchasingPlan`
  called the recommendation builder directly, so a low-confidence product could
  still show "Order tomorrow" on the purchasing page even though TODAY suppressed
  it. The contract is now enforced inside the shared pure builder and fed by the
  same truth signals the snapshot uses (no circular import — extracted to
  `server/inventory-truth-guidance.ts`).

## Architectural note

Both operator paths (TODAY snapshot and purchasing plan) now consume one truth
source (`getInventoryTruthGuidance`) and enforce one contract
(`confidence-routing` / the builder's `lowConfidenceProductNames`). There is no
surface left that can advise selling or ordering a product the engine cannot
trust.

## Result

- `pnpm typecheck` clean · `pnpm test` 483/483 · `pnpm lint` 0 errors.
- `pnpm verify:operator-language` PASS.
- All six operator surfaces verdicts: **Aligned** (two fixed in this pass).
