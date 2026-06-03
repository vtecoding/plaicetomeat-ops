# V9 — Owner Brain & Decision Compression Layer

V9 is a **presentation + prioritisation layer on top of V8**. It computes nothing new:
it compresses the existing `ShopIntelligence` (V8) into **business decisions** a
first-time, non-technical butcher can act on in under a minute. No database migration, no
mutation — the same Golden Rule as V8.

## The four-question rule

Anything on the Owner Brain screen must answer all four, or it doesn't appear:

1. What happened? — `OwnerDecision.whatHappened`
2. Why does it matter? — `whyItMatters`
3. What should I do? — `recommendedAction`
4. How much money is involved? — `estimatedImpact`

## Reuse map (nothing rebuilt)

| V9 need | Reused from V8 |
| --- | --- |
| Source signal | `Finding[]` from `src/lib/shop-intelligence/` (`getShopIntelligence`) |
| Server read | `getShopIntelligence(branchId)` — unchanged; `getOwnerBrain` wraps it |
| Status words | `HealthScore.band` + `strong` / `needsAttention` labels |
| Weekly wins | `WeeklyReport` (`buildWeeklyReport`) |
| Setup mode | `GettingStarted` (`buildGettingStarted`) |
| Playbook links | `Finding.playbook` |

## Module layout (`src/lib/owner-brain/`)

- `types.ts` — `OwnerDecision`, `MoneyImpact`, `ShopStatus`, `OwnerWeeklySummary`, `OwnerBrain`.
- `language.ts` — the **language firewall**: `deJargon()` + `FORBIDDEN_TERMS` + `findForbiddenTerms()`.
- `money.ts` — `estimateMoneyImpact(finding)` (honest; never fabricates a figure) + `moneyMagnitude()` for ranking.
- `decisions.ts` — `toOwnerDecision()`, `categorise()`, `rankDecisions()`.
- `status.ts` — `buildShopStatus(health)` → Good / Needs attention / Unknown (no numbers).
- `weekly-summary.ts` — `buildOwnerWeeklySummary()` → ≤3 wins / risks / opportunities.
- `brain.ts` — `buildOwnerBrain(intel)` orchestrator + `findDecision()`. Caps: urgent ≤5, important ≤10, opportunities ≤6.
- Spec-named entry: `src/lib/domain/owner-brain.ts` re-exports `brain.ts`.
- Server: `src/lib/server/owner-brain.ts` `getOwnerBrain(branchId)`.

## The three sections (the new homepage)

`/admin/today` is rebuilt from the V7 "Dad Mode" big-button screen into **TODAY**:

- 🔴 **Urgent** — action today (severity `urgent`).
- 🟡 **Important** — this week (severity `warning`, plus housekeeping `info`).
- 🟢 **Opportunities** — informational good news only (yield-over, upsell/basket); never mixed with problems.

Each row links to `/admin/today/[id]` — the **standardised decision card**: Title · What
happened · Why it matters · Recommended action · Money impact · Who · When · Learn more.

Below the sections: **How the shop is doing** (Good / Needs attention / Unknown with ✓/⚠
reasons, no score) and a **This week** summary (3 wins / risks / opportunities).

## Setup mode

`setupMode = !dataConfigured || gettingStarted.show`. While true, all three buckets are
empty and the page shows **only Getting Started** — a brand-new owner is never judged on
data they haven't entered. It disappears automatically once the four foundations
(products, costs, stock, certificate) are in place.

## Money impact — honesty first

`estimateMoneyImpact` reads the £ figures and weights a finding already carries:
- a real £ → weekly loss (waste) or one-off risk (everything else);
- a weight with no price → "About 12kg of stock at stake";
- compliance / yield / margin with no figure → a qualitative value line;
- otherwise → **"Hard to put a figure on yet"** (never an invented number).

## Language firewall

`deJargon()` rewrites technical phrases (yield variance → "less sellable meat than
expected", operational health → "how the shop is doing", margin → "profit after meat
costs", stock coverage → "days until stock runs out", …). `FORBIDDEN_TERMS` powers an
enforcement test (`brain.test.ts`) that scans a fully-populated `OwnerBrain` and fails if
any jargon leaks.

## Tests

- Unit (`src/lib/owner-brain/*.test.ts`): language firewall, money (incl. honest
  fallback + ranking), decisions (mapping / categorisation / ranking), status (band
  mapping + **no digits**), brain (setup mode hides decisions, caps, no-jargon scan,
  purity / no input mutation).
- e2e (`tests/e2e/owner-brain.spec.ts`): lands on TODAY; three sections **or** setup mode;
  a decision opens its card with all fields; no scores / raw severity / forbidden jargon;
  "More detail" → `/admin`.

## Not changed

All V8 engines, `/admin/briefing`, `/admin`, playbooks, glossary, reporting remain. No DB
migration. No deploy / Supabase / auth changes (separate launch hard-stops).
