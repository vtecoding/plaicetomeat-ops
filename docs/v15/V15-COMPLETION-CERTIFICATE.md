# V15 — Action Compression Engine · Completion Certificate

**Release:** V15.0 Action Compression Engine
**Date:** 2026-06-09
**Branch:** `v14-p1-inventory-truth`
**Status:** ✅ V15.0 CERTIFIED COMPLETE — all gates green (offline + live-stack). Deploy is the remaining operator step.

---

## 1. V14 Release Certification Evidence (entry gate)

V15 work was gated on V14 being release-certified. All ten V14 entry-gate
requirements are green (see [V14 completion certificate](../v14/v14.3/V14-COMPLETION-CERTIFICATE.md)):

| Requirement | Command | Result |
|---|---|---|
| V14.3 implementation complete | — | ✅ |
| V14.3 validation complete | — | ✅ |
| typecheck | `pnpm typecheck` | ✅ |
| lint | `pnpm lint` | ✅ 0 errors |
| unit tests | `pnpm test` | ✅ 483/483 (pre-V15) |
| operator journey | `node scripts/verify-operator-journeys.mjs` | ✅ |
| probe:v14 | `pnpm probe:v14` | ✅ 23/23 |
| operational-truth | `node scripts/verify-operational-truth.mjs` | ✅ |
| production build | `pnpm build` | ✅ Compiled successfully |
| legacy audit | `pnpm playwright:legacy-audit` | ✅ 13/13 |

Compression only operates on already-trusted guidance. Truth first, compression second.

---

## 2. Mission

The system already knows what matters. V15 makes it choose what matters **most**:
the butcher no longer prioritises an 11-card list — TODAY shows **at most three**
things to do now, and everything else is preserved (never lost) in a "Later" reserve.

V15 builds **ranking and compression only**. It creates no new recommendation; it
chooses the top three from already-certified V14 guidance.

---

## 3. What changed (commit order)

1. **Domain model** — `OwnerDecision` now carries its source `area`; new `DoctrineTier`
   and `ActionEvidence` types (`owner-brain/types.ts`).
2. **Scoring + deterministic ranking** — `owner-brain/action-compression.ts`: the doctrine
   ladder (`prevent_loss > prevent_waste > prevent_stockout > protect_sales > reduce_work >
   improve_profit`), a single global `compareActions` contest (doctrine → money → urgency →
   stable id), and `compressActions` → `{ doNow (≤3), later, evidence, excluded }`.
3. **Owner-brain integration** — `buildOwnerBrain` runs the one global contest over **all**
   decisions and returns `doNow` / `later` / `actionEvidence`. The Urgent/Important/Opportunity
   buckets are retained only as the substrate for the weekly summary and the opt-in guided
   walk; they are no longer TODAY's primary surface and no longer compete in separate capped
   lanes. `DO_NOW_MAX = 3`.
4. **Later reserve + TODAY** — `/admin/today` renders one "Do now" section (≤3) and a
   collapsed "Later" reserve; the three old bucket sections are gone. No path can render a
   fourth primary action.
5. **Tests + journey** — `action-compression.test.ts` (doctrine ladder, compression, Later,
   determinism, no-upgrade, no leakage, bad-input), a `doNow ≤ 3` brain test, updated
   `owner-brain.spec.ts`, and `scripts/verify-action-compression.mjs`
   (`pnpm verify:action-compression`).
6. **Docs** — this certificate.

---

## 4. Doctrine ranking

Actions compete in **one** field, ranked by doctrine tier — not by visual category:

1. **Prevent loss** — food-safety/halal (can't sell), expired stock, lines sold at a loss
2. **Prevent waste** — short-dated stock to sell first
3. **Prevent stock-out** — order more before the shelf is empty
4. **Protect sales** — keep the day's trade healthy
5. **Reduce work** — counting / hygiene that saves future work and error
6. **Improve profit** — buy-less, opportunities, margin upside

Ties break deterministically: doctrine → money at stake → urgency → stable id. Never random.

The butcher never sees a score, rank, confidence value or doctrine word — those live only
in `ActionEvidence` (tests / audit / debugging).

---

## 5. Gate results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | ✅ clean |
| Lint | `pnpm lint` | ✅ 0 errors (5 pre-existing warnings, unrelated files) |
| Unit tests | `pnpm test` | ✅ **497 / 497** (63 files; +14 V15) |
| Production build | `pnpm build` | ✅ Compiled successfully |
| V14 regression probe | `pnpm probe:v14` | ✅ **23 / 23** (FEFO, once-only depletion, oversell-flag, each/box, reversals) |
| Operator journey (compression) | `pnpm verify:action-compression` | ✅ PASSED — live app, **16 candidates → 3 Do-now**, 13 in Later, no score leakage |

No regression in inventory truth, confidence routing, operator language, low-stock or
repeated-shortfall guidance: V15 re-orders certified guidance and never rewrites an action
(a low-confidence "Count" can never become a "Sell"/"Order" — proven in unit test #9).

---

## 6. Exit criteria

- [x] `DO_NOW_MAX = 3` enforced end-to-end; no path can present a 4th primary action.
- [x] All candidate actions compete in one global contest (not separate capped buckets).
- [x] Non-winning actions preserved in Later (lossless).
- [x] No scores/confidence leak to the operator (operator-text leakage test + page never
      renders `actionEvidence`).
- [x] TODAY cannot show more than three primary actions (engine cap + brain test + e2e).
- [x] Seeded journey proves compression on the live app (16 → 3, 13 in Later; screenshot
      `docs/v15/screens/today-compressed.png`, evidence `action-compression-journey-proof.md`).
- [x] typecheck / lint / unit / build pass.

All exit criteria met.

---

## 7. Remaining

1. **Deploy** per house style (build-ahead, deploy separately). V15 is code-only — no new
   migrations. The V14.1-H migrations still require the usual prod DB push (tracked in V14).
