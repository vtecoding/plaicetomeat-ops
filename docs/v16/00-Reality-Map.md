# V16 Reality Map — spec vs. shipped code

**Status:** Analysis (no code changed)
**Date:** 2026-06-11
**Author:** Owner Brain / V16 planning pass

> The V16 brief — *Operational Intelligence & Cognitive Compression* — is written as if
> the platform were a raw "Operational Management System." It is not. V15 (certified and
> **deployed to production 2026-06-10**) already built most of V16's engine half: the Owner
> Brain, action compression, the one-tap action layer, the morning briefing, the
> intelligence firewall, and the compliance guard. This document maps every V16 clause to
> what already exists, so we build the genuine gaps and don't rebuild certified work.

---

## 1. Clause-by-clause map

Legend: ✅ shipped · ◓ partial / stub · ❌ genuinely new · ⚠️ conflicts with existing doctrine

| V16 clause | Intent | Status | Evidence |
|---|---|---|---|
| **16.1 Owner Brain** | Single command centre at `/admin/today` | ✅ | `src/lib/owner-brain/brain.ts` → `buildOwnerBrain`; rendered at `src/app/admin/today/page.tsx` |
| **16.1 `ActionCard` schema** | `{title, impact, category, recommendation, evidence, actionUrl}` | ✅ (by design, minus `impact`) | `OperatorAction` (`owner-brain/operator-action.ts`) + `resolveActionTarget` (`owner-brain/action-target.ts`). **V15.4 firewall deliberately strips score/impact/evidence from the UI object** — see §2. |
| **16.1 input sources** | Orders, inventory, waste, purchasing, compliance, open/close, customers | ✅ | `shop-intelligence/snapshot.ts` + `engine.ts` aggregate all of these into `Finding[]`, which the brain consumes. |
| **16.2 Compression Engine** | Audit every page; collapse non-actionable blocks; 40–60% targets | ◓ | Doctrine + guard exist (`verify:owner-brain-compliance`); applied to the **strict surfaces only**. The ~12 secondary admin pages are untouched. → real work, see §3. |
| **16.3 Guided Operations** | Step-of-N workflow for procedures | ✅ core | `src/app/admin/today/walk/page.tsx` (guided walk) + open/close checklists (`open/page.tsx`, `close/page.tsx`). Could extend to stock-count. |
| **16.4 Inventory Intelligence** | Inventory → decisions | ✅ | `src/lib/server/inventory-truth-guidance.ts` + `domain/operator-guidance.ts`; surfaced via `buildOperatorGuidanceFindings`. |
| **16.5 Purchasing Intelligence** | Recommendation engine | ✅ | `src/lib/domain/purchasing-intelligence.ts` (+ `.test.ts`), `server/purchasing-intelligence.ts`. |
| **16.6 Waste Intelligence** | Expiry 24h/48h, low turnover, waste trend, margin impact + a **new `/admin/waste-intelligence` page** | ◓ engine stub / ⚠️ new page | `action-intelligence/waste-actions.ts` is a **single rule** (top product >50% of week waste). None of the 24h/48h/trend/margin signals exist. The **new page conflicts with the firewall** — see §2. |
| **16.7 Customer Return Engine** | Per-customer `last_order`/`frequency`/`basket`/`favourites`; lapsed-regular alerts | ◓ stub | `action-intelligence/customer-actions.ts` fires only when `repeatRate === 0` exactly. No per-customer history, no "absent 21 days / £47 / call" output. → real work, see §4. |
| **16.8 KPI rationalisation** | ≤5 primary KPIs/screen; rest expandable | ✅ on strict surfaces | `verify:owner-brain-compliance` bans bare %/score/confidence/ranking on strict surfaces. Not yet enforced on the secondary pages. |
| **16.9 Mobile-first operator pass** | One-handed; <10s actions | ◓ | One-tap layer (V15.2) gives the *routing*; no systematic mobile audit of the secondary screens. |
| **16.10 Screen consolidation** | 20–30% fewer destinations | ◓ | V11.3 already did "one door per job" (Today is sole home, Briefing→redirect, counter-mode removed). Remaining merge candidates are few — needs a destination audit, not a cull. |
| **16.11 Language compression** | Plain operator copy | ✅ | `owner-brain/language.ts` (`deJargon`, `FORBIDDEN_TERMS`) + `verify:operator-language`. |
| **16.12 Observability** | Track visits, completion, ignored recs, acceptance, abandonment | ❌ | No event/telemetry layer exists. Genuinely new — but note it needs a data sink decision before building. |

**Headline:** of the 12 V16 sub-programs, **7 are effectively shipped** (16.1, .3, .4, .5, .8, .11, and most of .10), **3 are partial/stub** with real remaining work (16.2 compression, 16.6 waste engine, 16.7 customer), and **1 is genuinely new** (16.12 observability). The spec's own #1 (Owner Brain) is done.

---

## 2. The 16.6 conflict — new page vs. the Intelligence Firewall

V16.6 asks for a new `/admin/waste-intelligence` screen listing raw signals (margin impact,
waste trend, turnover). This **contradicts the doctrine V15.4 + V15.5 made law in this
codebase**:

- **V15.4 Intelligence Firewall** — intelligence is converted to an `OperatorAction` (safe
  display strings, no score/confidence/priority) before it can reach any operator surface.
- **V15.5 Compliance Guard** (`verify:owner-brain-compliance`) — **bans** bare `%`, "variance",
  scores, confidence, ranking and new metric panels on strict surfaces, and forbids new
  dashboards that bypass the action pipeline.

A raw-signals waste page would fail the guard on sight. It also violates V16's *own* core
principle — *"answer 'what should I do?' before 'why?' before 'show me evidence'."* A trend
chart is the third question wearing the first question's clothes.

**Resolution (recommended):** keep the spec's *intent* — surface waste risk early and act on
it — but deliver it the V15 way. The waste **logic** (`waste-actions.ts`) is enriched (§4) so
it emits proper expiry-window actions; those actions flow through the existing brain →
`doNow`/`later` and one-tap into the existing stock-count / offer flows. The "evidence"
(turnover, margin) lives behind the existing `▼ Why` disclosure on the decision-detail page,
not on a standing dashboard. **No new top-level page.** This needs an explicit owner sign-off
before we treat 16.6 as "the page is descoped."

---

## 3. Compression pass — concrete scope (16.2 / 16.9)

V15 restyled the strict + primary work surfaces (today, login, purchasing, stock-count,
open/close, counter, compliance, inventory, admin hub). The pages still on the **old dense
styling** (`font-black` present, no `Masthead`) are the real 16.2 target set:

| Page | Route | Notes |
|---|---|---|
| `validation/pricing/page.tsx` | /admin/validation/pricing | data-dense; strong compression candidate |
| `setup/page.tsx` | /admin/setup | |
| `settings/page.tsx` | /admin/settings | |
| `releases/page.tsx` | /admin/releases | internal/ops |
| `playbooks/page.tsx` + `[slug]` | /admin/playbooks | long-form copy; restyle not compress |
| `orders/page.tsx` | /admin/orders | |
| `guide/page.tsx` | /admin/guide | |
| `cutting-guide/page.tsx` | /admin/cutting-guide | |
| `audit/page.tsx` | /admin/audit | evidence surface — **compress chrome, never the evidence** |

`today/walk/page.tsx` also still matches `font-black` but is a **strict surface** — treat any
change there as guarded by `verify:owner-brain-compliance`; check whether that `font-black` is
intentional before touching it.

**Pattern to apply** (the spec's universal pattern, already proven on the primary screens):
`Masthead` → action cards → `▼` expandable intelligence → `▼` expandable audit. Reuse
`components/ui/page.tsx` primitives — do not invent new ones.

---

## 4. Engine-strengthening — concrete scope (16.6 / 16.7)

Two engines are stubs and are where "strengthen existing" delivers real signal quality. The
mature engines (yield reality, consistency monitor, operator guidance, purchasing) are good
references for the bar — see `shop-intelligence/findings.ts`.

**Waste (`action-intelligence/waste-actions.ts`)** — currently one rule. Add, honesty-gated
(no finding without evidence, as the existing engines do):
- expiry within 24h / 48h on active batches (data already in `snapshot.batches[].daysToExpiry`);
- low-turnover / slow-moving stock;
- waste trend vs. prior week.
Each emits an `OwnerAction` → flows through the brain. Recommended verb stays an existing one
(reduce order / short-dated offer / dispose), so the one-tap target already resolves.

**Customer (`action-intelligence/customer-actions.ts`)** — currently fires only on
`repeatRate === 0`. To deliver 16.7 we need per-customer history (`last_order`,
`order_frequency`, `average_basket`, `favourite_products`). **Open question:** does the
snapshot expose per-customer rows today? If not, this needs a snapshot/query addition before
the engine can produce the "regular absent 21 days" action — that is the one place 16.7 may
touch the data layer.

---

## 5. Recommended sequencing

1. **This doc + owner sign-off on §2** (16.6 page descoped to action-only). Cheap, unblocks the rest.
2. **Compression pass** (§3) — visible value, no data-layer risk, reuses shipped primitives. Page by page, each behind the existing gates.
3. **Waste engine enrichment** (§4) — no schema change; pure functions + tests, mirrors `findings.ts` honesty rules.
4. **Customer return engine** (§4) — only after confirming per-customer snapshot data; may need a query addition.
5. **(Deferred) 16.12 observability** — needs a telemetry-sink decision; not a blocker for the value above.

## 6. Validation gates (unchanged — V16 must keep them green)

`pnpm typecheck` · `pnpm test` (unit 527/527) · the four live operator-journey gates
(action-compression, today-os, one-tap, morning-briefing) · `verify:operator-language` ·
`verify:intelligence-firewall` · `verify:owner-brain-compliance` · `probe:v14`.

Every removed block must be justified; no loss of audit/compliance/inventory evidence
(V16 validation gates 1–10).
