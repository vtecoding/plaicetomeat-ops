# V14 — Completion Certificate

**Release:** V14.3 Truth Alignment & Operator Completion
**Date:** 2026-06-09
**Branch:** `v14-p1-inventory-truth`
**Status:** ✅ V14 CERTIFIED COMPLETE (code-level + live-journey gates green; production build/deploy is the operator step)

V14.3 closed the six doctrine gaps from the operator-journey audit. No new
capability was added — the existing intelligence is now truthful, consistent,
complete, and operator-safe.

---

## Workstream results

| WS | Title | Outcome | Evidence |
|---|---|---|---|
| A | Confidence → Verb contract | ✅ | `confidence-routing.ts` (pure, tested). Low inventory-truth confidence → **count only**; never sell/order/fix. Enforced at the `buildOperatorGuidanceCards` chokepoint **and** the purchasing builder. `confidence-routing.test.ts`, `operator-guidance.test.ts`. |
| B | Repeated shortfall translation | ✅ | Recurring instability escalates to **"count today" + "Stock keeps changing unexpectedly"**, defensively, even if the raw signal was the weaker `count_soon`. `operator-guidance.ts` / test. |
| C | Low-stock journey validation | ✅ | `scripts/verify-operator-journeys.mjs` — real rendered journey on the live app. 27 low-confidence products on file, **0** shown as Order; TODAY shows count actions; honesty stamp states V14 truth. `low-stock-journey-proof.md` + `screens/`. |
| D | Legacy language eradication | ✅ | Fixed the false Stock-page stamp ("sales are not deducted automatically yet" → "Collected orders are already taken off stock"). Guard `scripts/verify-operator-language.mjs` (26 files, 0 violations). `language-audit.md`. |
| E | Truth alignment pass | ✅ | All six operator surfaces agree with V14 truth; **closed the purchasing-page bypass** of the confidence contract. `truth-alignment-audit.md`. |
| F | Operator language audit | ✅ | Owner-brain language firewall extended with V14 inventory-truth jargon (build-enforced by `language.test.ts`) + static guard. `language-audit.md`. |
| G | V14 completion validation | ✅ | This certificate. |

---

## Gate results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | ✅ clean |
| Lint | `pnpm lint` | ✅ 0 errors (5 pre-existing warnings, unrelated files) |
| Unit tests | `pnpm test` | ✅ **483 / 483** (62 files) |
| Operator language | `pnpm verify:operator-language` | ✅ PASS (26 operator files, 0 violations) |
| V14 DB probe | `pnpm probe:v14` | ✅ **23 / 23** (FEFO, once-only depletion, oversell-flag, each/box, reversals) |
| Operational truth | `node scripts/verify-operational-truth.mjs` | ✅ ALL PASS |
| Operator journey | `node scripts/verify-operator-journeys.mjs` | ✅ PASSED (live app, contract holds on rendered surfaces) |
| Production build + Playwright legacy-audit | `pnpm build` · `pnpm playwright:legacy-audit` | ⏳ **Operator step** — not run here to avoid clobbering the live dev server's `.next` (house style: build-ahead, deploy separately). |

---

## Exit criteria (from the spec)

- [x] Every internal condition translates into butcher language (firewall + guard).
- [x] Every operator surface agrees with inventory truth (truth-alignment audit).
- [x] Low-stock guidance proven through a real journey (Workstream C).
- [x] Confidence → Verb routing enforced and tested (no bypass; purchasing page closed).
- [x] Legacy wording eliminated (guard PASS; Stock stamp corrected).
- [x] Repeated shortfalls produce clear, strong operator action ("count today").

---

## Commits (V14.3, on `v14-p1-inventory-truth`)

1. `b808389` seal V14.1-H + V14.2 checkpoint
2. `a77d5d6` docs(v15) doctrine + roadmap
3. `0d59cf9` Workstreams A + B (confidence→verb + recurring-shortfall wording)
4. `8ee25f5` Workstreams D/E/F (truth alignment + language + purchasing-page contract)
5. `19d0f88` Workstream C (live operator-journey proof)
6. *(this)* G — completion certificate

---

## Hand-back: remaining operator actions

1. **Production build + full Playwright suite** before deploy: `pnpm build` then
   `pnpm playwright:legacy-audit` (and the broader `pnpm playwright:full`). Run
   when the dev server can be stopped.
2. **Deploy** per house style (build-ahead, deploy separately); these changes are
   code-only (no new migrations in V14.3 — the V14.1-H migrations were sealed in
   the checkpoint commit and still require the usual prod DB push).

At that point V14 is fully shipped, and **V15 — Action Compression Engine** may begin.
