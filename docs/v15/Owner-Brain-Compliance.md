# Owner Brain Compliance Report

_V15.5 · Maturity Audit & Continuous Reduction Guard_

Generated: 2026-06-10T22:27:22.860Z — by `node scripts/verify-owner-brain-compliance.mjs` (static, no app/DB).

> Every release before V15.5 asked "what should we add?". V15.5 asks "what should
> never return?". This report is regenerated on every run of the guard, so the
> answer is checked continuously — not signed off once.

## 1. Automated guard results

**PASS** — 36/36 checks green. No dashboard, metric, score or ranking regression; the three-action rule and the action pipeline are intact.

- ✅ decision surface shows no dashboard language: src/app/admin/today/page.tsx — plain operator language only
- ✅ decision surface shows no dashboard language: src/app/admin/today/[id]/page.tsx — plain operator language only
- ✅ decision surface shows no dashboard language: src/app/admin/today/walk/page.tsx — plain operator language only
- ✅ decision surface shows no dashboard language: src/components/owner-brain/decision-detail.tsx — plain operator language only
- ✅ decision surface shows no dashboard language: src/components/owner-brain/guided-day.tsx — plain operator language only
- ✅ decision surface shows no dashboard language: src/components/owner-brain/action-context.tsx — plain operator language only
- ✅ decision surface shows no dashboard language: src/lib/owner-brain/briefing.ts — plain operator language only
- ✅ work surface shows no metric/score values: src/app/admin/stock-count/page.tsx — honest figures only, no scores
- ✅ work surface shows no metric/score values: src/app/admin/purchasing/page.tsx — honest figures only, no scores
- ✅ work surface shows no metric/score values: src/app/admin/inventory/page.tsx — honest figures only, no scores
- ✅ work surface shows no metric/score values: src/app/admin/compliance/page.tsx — honest figures only, no scores
- ✅ work surface shows no metric/score values: src/components/admin-inventory-client.tsx — honest figures only, no scores
- ✅ work surface shows no metric/score values: src/components/ops-capture/stock-count.tsx — honest figures only, no scores
- ✅ work surface shows no metric/score values: src/components/counter-dashboard.tsx — honest figures only, no scores
- ✅ no new dashboard/metric panel: src/app/admin/today/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/app/admin/today/[id]/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/app/admin/today/walk/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/components/owner-brain/decision-detail.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/components/owner-brain/guided-day.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/components/owner-brain/action-context.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/lib/owner-brain/briefing.ts — no metric/chart panel
- ✅ no new dashboard/metric panel: src/app/admin/stock-count/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/app/admin/purchasing/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/app/admin/inventory/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/app/admin/compliance/page.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/components/admin-inventory-client.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/components/ops-capture/stock-count.tsx — no metric/chart panel
- ✅ no new dashboard/metric panel: src/components/counter-dashboard.tsx — no metric/chart panel
- ✅ DO_NOW_MAX is permanently 3 — src/lib/owner-brain/action-compression.ts
- ✅ the Do-now slice is capped by DO_NOW_MAX — ranked.slice(0, DO_NOW_MAX)
- ✅ DO_NOW_MAX is never raised above 3 — single source of truth = 3
- ✅ pipeline stage present: Candidates (findings → decisions) — wired
- ✅ pipeline stage present: Scoring (rankDecisions) — wired
- ✅ pipeline stage present: Competition + Compression (compressActions) — wired
- ✅ pipeline stage present: Execution + Presentation boundary (toOperatorActions) — wired
- ✅ no bypass — Do Now is fed by the compression boundary — buildOwnerBrain.doNow = toOperatorActions(engine.doNow)

## 2. Doctrine surface audit (Mission 1)

For every operator surface: does it require **interpretation, calculation, training or prioritisation**? If yes, that is a violation. None do.

| Surface | Requires interpretation/calc/training/prioritisation? | Notes |
|---|---|---|
| TODAY | No | Three numbered Do-now cards in plain verbs. No interpretation, calculation, training or prioritisation — the engine already prioritised. |
| Later | No | Collapsed reserve of the same plain cards. No ranking shown; opening it changes nothing the operator must decide. |
| Morning Briefing | No | Three qualitative sentences (Yesterday / Today / Ignore), ≤100 words, zero numbers or confidence. |
| One-Tap Context Screens | No | A banner naming the one thing to do, then the work itself. No re-prioritisation on arrival. |
| Counter | No | Order columns and statuses. Operational state, not metrics; no scores or percentages. |
| Stock Count | No | Counted vs system shown as honest kg, with 'Matches the system' when equal. A figure to act on, not a variance KPI. |
| Inventory | No | Quantities and dates. No coverage ratios, no trend scores. |
| Purchasing | No | What to order and when. Supplier date confidence is a word ('estimated'), never a number. |
| Compliance | No | Temperature capture and certificate state. Pass/attention, never a compliance score. |
| Guided Walks | No | A fixed sequence of the same plain actions. The order is decided for the operator. |

## 3. Ten-second rule (Mission 4)

> Can an experienced butcher understand what matters within 10 seconds?

**Yes.** TODAY opens with at most three numbered Do-now cards above the fold (proven
by `verify:today-os`). Each card is a single plain verb — Count / Order / Sell / Fix —
with the item named. No reading of charts, no comparison, no ranking to decode.

## 4. One-minute rule (Mission 5)

> Can a *new* operator understand the day within one minute, with no training?

**Yes**, using only the Morning Briefing (three sentences: what happened yesterday,
what to do today, what to ignore) and the three Do-now cards. No dashboard to learn,
no glossary, no metric definitions. Everything is an instruction in shop English.

## 5. Cognitive load audit (Mission 6)

Decisions the system asks the operator to make, by category. Goal: every release
**reduces** decisions, never increases them.

| Decision type | Count on TODAY | Why |
|---|---|---|
| Navigation | 0 to start | TODAY is the single home; cards link straight to the work (V15.2). |
| Interpretation | 0 | Status is words, not numbers; nothing to read into. |
| Prioritisation | 0 | The engine ran the single global contest; the order is decided. |
| Configuration | 0 | No settings, thresholds or filters on the operator path. |
| Search | 0 | The three things are presented; the operator never hunts. |

The operator makes **at most three decisions**: whether to do each Do-now action now.

## 6. Action pipeline seal (Mission 7)

```
Signals  →  Candidates  →  Scoring  →  Competition  →  Compression  →  Execution  →  Presentation
 (intel)   (toOwnerDecision)  (rankDecisions)  (compareActions)  (compressActions ≤3)  (toOperatorActions)  (TODAY)
```

Verified intact above, with no bypass: the operator's Do-now is fed only by the
compression boundary, and confidence is spent on choosing the verb — never shown.

## 7. Risk areas

- **Legacy heading language.** `admin-compliance-client.tsx` and a few nav links read
  "Compliance Dashboard" / "Back to dashboard". These are screen titles and navigation
  to the Business Insights hub, not metric panels, so they are not failed here — but
  they are the kind of wording a future tidy-up should retire.
- **Business Insights hub (`/admin`).** Analysis, health score and confidence are
  *allowed* there by design and are intentionally out of this guard's scope. It must stay
  off the operator action path so the two never blur.
- **New surfaces.** Any new operator screen must be added to this guard's surface lists,
  or it escapes the doctrine silently.

## 8. Future recommendations

1. Add every new operator-facing screen to `STRICT_SURFACES` / `WORK_SURFACES` in the
   guard at the same time it is built.
2. Keep `verify:owner-brain-compliance` and `verify:intelligence-firewall` in the
   required gate set; together they hold the boundary (no scored *fields*) and the
   doctrine (no metric *language*).
3. Treat any request for a new chart, score or percentage on an operator surface as a
   doctrine change requiring explicit sign-off, not a feature.

---

_Future development must actively fight the doctrine to violate it. The architecture
protects itself: the software keeps doing the thinking, the butcher keeps doing less._