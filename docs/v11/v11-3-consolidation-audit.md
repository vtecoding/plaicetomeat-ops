# V11.3 — Owner Operating System Consolidation: Deletion Audit

**Branch:** `v11-3-owner-os-consolidation` (stacked on `v11-2-audit-authenticity` / PR #13).
**Scope (owner decision):** core consolidation now; the compliance 4-domain split and
temperature single-source dedup are **deferred to V11.3b** (they touch compliance data
capture). This phase is consolidation only — no new analytics, no security/audit/
checkout/inventory-architecture changes.

## Principle proven: one door per job

| Job | Before (competing doors) | After (single authority) |
|---|---|---|
| "How's the shop today / what do I do next?" | `/admin/today`, `/admin/briefing`, `/admin` | **`/admin/today`** only |
| Live counter service | `/counter` **and** `/admin?mode=counter` | **`/counter`** only |
| Stock correction (normal workflow) | `/admin/inventory` adjust, `/admin/stock-count`, close ritual | **`/admin/stock-count`** (inventory adjust is owner-only exception) |
| Historical analysis | `/admin` (mixed operational + analysis) | **`/admin` "Business Insights"** (analysis only) |

## Removed / merged / redirected

### Routes
- **`/admin/briefing` → retired.** Page body replaced with `redirect("/admin/today")`
  (file kept as a 9-line redirect stub so bookmarks land on Today). Its V8
  shop-intelligence analysis (health score, findings, weekly report, confidence) was
  **moved** to the analysis hub `/admin`.
- **`/admin?mode=counter` → removed.** The `mode=counter` query branch no longer
  renders anything; the legacy URL falls through to Business Insights. `/counter` is the
  sole counter authority. (0 `mode=counter` / `CounterServiceMode` references remain in
  `src/`.)

### Components / functions deleted from `src/app/admin/page.tsx`
- `CounterServiceMode` (duplicate counter view)
- `buildOperationalIssues`, `buildDailyFocus` (operational logic → belongs to Today)
- `LaunchReadinessCard`, `LaunchReadinessRow` (onboarding has one home: Today setup-mode
  + `/admin/setup`)
- `BadgePill`, `CompactMetricCard`, `severityTone` (only used by the removed sections)
- Removed sections: "What needs attention?" (priority actions), "Today's Focus",
  "What needs fixing?" (operational issues), the Launch Readiness card, the
  "Counter-service mode" link.

### Components added (consolidation, not duplication)
- `src/components/admin/business-insights.tsx` — the shop-intelligence analysis sections
  lifted out of the retired briefing page so `/admin` is their single home.

### Queries / calculations de-duplicated
- `/admin` no longer calls `getLaunchReadiness` (that data now only feeds `/admin/setup`
  + Today setup-mode).
- `getShopIntelligence` is now called in **one** admin surface (`/admin`) instead of the
  separate briefing page.
- The operational "issues / daily focus / priority actions" computations (which
  overlapped Today's owner-brain) were deleted from `/admin` rather than maintained in
  two places.

### Navigation depth reduced (`src/components/site-header.tsx`)
- Managers: `Today` + `Briefing` → **`Today` + `Business Insights`** (Briefing link gone).
- Staff: `Counter` + `Compliance` → **`Counter` + `Food safety`** (relabel; route
  `/counter/compliance` unchanged — structural split deferred).
- Today's "More" grid: dropped the Briefing card; the `/admin` card relabelled to
  **Business Insights**.

### Stock authority (`src/components/admin-inventory-client.tsx`)
- The per-batch "Correct stock" form is now an **owner-only** exception. Managers/staff
  see a link **"Correct stock in Stock count" → `/admin/stock-count`**. The RPC
  (`admin_adjust_inventory_remaining`) and the `compliance-inventory` action are
  unchanged (no inventory-architecture change); waste logging is unaffected.

### Orders authority (`src/app/admin/orders/page.tsx`)
- Reframed as "Order history — past orders, search and exceptions; live preparation
  happens at the Counter." (labelling only; no functional change.)

## Metrics (before → after)

| Metric | Before | After | Note |
|---|---|---|---|
| Operational "today" destinations | 3 | **1** | Today only (briefing redirect; /admin = analysis) |
| Counter experiences | 2 | **1** | `/counter` only |
| Stock-correction doors (normal workflow) | 3 | **1** | `/admin/stock-count` |
| `src/app/admin/page.tsx` lines | 934 | **481** | operational logic removed |
| `src/app/admin/briefing/page.tsx` lines | 502 | **9** | redirect stub |
| admin routes (files) | 23 | 23 | briefing kept as redirect (not deleted) |
| all routes (files) | 40 | 40 | no page files deleted |
| components | 37 | 38 | +`business-insights.tsx` (shared, replaces duplicated render) |
| e2e specs | 33 | 33 | several rewritten to the consolidated structure |

> Route/component **file counts** are flat by design: we used redirects + a shared
> component rather than hard deletes, which is safer on a branch stacked on two
> unmerged PRs. The real reduction is in **duplicated surfaces, queries and ~900 lines
> of duplicated operational code**.

## Validation against spec

1. Every operational task has one authority surface — ✓ (table above).
2. No duplicated daily dashboard — ✓ (briefing redirects; `/admin` is analysis only).
3. No duplicated stock-correction workflow — ✓ (stock-count is the door; inventory
   adjust owner-only).
4. No duplicated temperature workflow — **deferred to V11.3b** (documented below).
5. Navigation depth reduced — ✓ (manager + staff nav simplified; Today is the hub).
6. Existing functionality intact — ✓ (analysis preserved on `/admin`; owner can still
   directly adjust stock as an exception).
7. Full regression passes — see PR evidence (typecheck, 288 unit, build, audit:bundle,
   Playwright).

## Deferred to V11.3b (explicitly out of scope here)
- **Compliance 4-domain split** (Food Safety / Supplier Certificates / Cleaning Records /
  Operational Evidence). Only the nav **relabel** ("Food safety") was done now.
- **Temperature single-source dedup** (opening ritual writing the official
  `compliance_readings`, compliance reading the same record). Touches data capture —
  higher risk; kept for a focused follow-up.
- Any inventory-depletion / sales-decrement / forecasting / AI work (spec Non-Goals).
