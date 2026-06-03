# V8 Capability Map — audit before coding

> Required by the V8 spec: *"Before implementation, generate a Current Capability
> Map. Inventory every existing subsystem… Then build V8 from facts, not
> assumptions."*

Date: 2026-06-03. This is a **facts-from-the-code** inventory, not a wishlist. For
each subsystem it records *what data exists*, *what decisions can already be made*,
and *what is missing* — which is exactly the gap V8 fills.

The headline finding: PlaiceToMeat already computes almost every signal V8 needs.
The platform's weakness is not data, it is **synthesis** — the signals are scattered
across pages, none of them carry a plain-English *consequence* ("what happens if you
ignore this"), an explicit *confidence/evidence* statement, or a *playbook* link, and
nothing rolls them into a single "open the app, know everything in 60 seconds" view.
V8 is therefore a **read-only intelligence layer over existing reads** — it adds no
database tables and never mutates shop data (the spec's Golden Rule, V8.13).

---

## Subsystem inventory

### 1. Orders
- **Data:** `orders`, `order_items`, `order_status_events`, `order_notes`. Status enum
  `incoming/prepping/ready/collected/cancelled`. `is_test` flag; `subtotal`; pickup
  date/window; SMS state.
- **Reads:** `getDashboardMetrics` (today's counts/revenue), `getOperationsIntelligence`
  (120-day history → customer/basket/velocity), counter screen (live).
- **Decisions today:** what to prepare next (counter), today's revenue, repeat-customer
  rate, basket pairings.
- **Missing:** order **flow health** as a scored signal; "is the counter being worked?"

### 2. Inventory / stock
- **Data:** `inventory_batches` (expected/actual/remaining weight, cost_per_kg, expiry,
  status, **expected vs actual variance** from V6.6), `inventory_movements`
  (RECEIVED/SALE/WASTE/…), `inventory_waste_events` (retail waste, V3).
- **Reads:** `getInventoryBatches`, `getBatchesAtRisk` (≤3 days), `buildInventoryDepletionForecast`
  (per-batch days-to-runout from sales velocity), `buildExpiryCommandCentre`.
- **Decisions today:** what's about to expire, value at risk, days of cover left.
- **Missing:** *patterns over time* (repeated low-stock), *consistency* (remaining>0 but
  not active; past-date but still active), *stock-accuracy discipline* (how long since a
  count/correction).

### 3. Pricing / margin / costs
- **Data:** `products.cost_per_kg`, batch blended cost, `product_performance` rows.
- **Reads:** `buildProductPerformance` (best/worst/highest-waste-drag, honest
  "Add a cost to see profit" when cost unknown), carcass calculator.
- **Decisions today:** which products make/lose money *when cost is known*.
- **Missing:** margin findings folded into one ranked briefing with consequence + fix.

### 4. Purchasing
- **Data:** derived only (no PO table). Velocity + waste + cost.
- **Reads:** `getPurchasingPlan` → order-more / order-less recs, **`buildDataQuality`**
  (score → `confidenceCap`), supplier readiness, seasonal prep.
- **Decisions today:** what to buy more/less of, am I ready to order.
- **Missing:** purchasing **discipline** as a health signal; surfacing top recs in the briefing.

### 5. Compliance
- **Data:** `suppliers` (cert expiry/body/number, documents), `compliance_logs`,
  `compliance_readings`.
- **Reads:** `buildCertificateForecast` (band: expired/7d/30d/90d/healthy),
  `summariseCompliance`.
- **Decisions today:** which certificates are expired/expiring.
- **Missing:** compliance **readiness score**; "renew before expiry" coaching with lead time.

### 6. Carcass intake & yield
- **Data:** `carcass_intakes`, `carcass_intake_cuts` (V6.4); batch `expected/actual`
  weight + `actual_confirmed_at` (V6.6); `cut-sheets.ts` expected yields.
- **Reads:** `carcass-breakdown.ts` (pricing engine), `yield-review.ts` (unverified banner).
- **Decisions today:** suggested per-cut prices; per-intake variance.
- **Missing:** **reality learning** — expected vs actual *across many intakes* per product
  ("lamb leg has yielded under estimate for the last N intakes"). This is V8.2 / V8.11 and
  the single biggest untapped asset, because the variance data already lands in every batch.

### 7. Audit
- **Data:** `audit_logs` (append-only: order/price/product/schedule/compliance/inventory
  events), `sms_log`, `login_attempts`.
- **Missing:** nothing for V8 to add — it is the provenance trail behind recommendations.

### 8. Dashboard / Dad Mode
- **Reads:** `/admin` (full insights), `/admin/today` (Dad Mode: ≤5 ranked actions, stock
  & compliance attention, big buttons). `action-intelligence/` engine →
  `OwnerAction { title, explanation, estimatedImpact, recommendedAction, severity, confidence }`.
- **Missing vs V8:** `OwnerAction` already has *why* (explanation) and a rough *consequence*
  (estimatedImpact), but **no explicit `consequence` field, no `dataBasis`/evidence, no
  `playbook` link, and no daily-briefing narrative or health score.** V8.1/V8.3/V8.4/
  V8.6/V8.7 normalise and extend this.

### 9. Storefront / counter
- **Reads:** `getPublicProducts`/`getPublicBranch`; counter realtime.
- **Status:** healthy; V8 only reads order-flow signals from it.

### 10. Launch readiness / setup
- **Reads:** `deriveLaunchReadiness` (V8.9 **already exists** — honest ready/attention/manual),
  `getSetupChecklist`. V8 reuses these as-is and surfaces them in the briefing/health.

---

## What V8 adds (gap → feature)

| Gap found in audit | V8 feature | Built from |
|---|---|---|
| No single morning view | **Daily Briefing** (V8.3) | findings + metrics |
| Findings lack "if ignored" + "do this" | **Explain-everything `Finding`** (V8.1/V8.4) | normalises `OwnerAction` + new builders |
| No evidence behind confidence | **Data Confidence / basis** (V8.7) | reuses `buildDataQuality` + per-finding basis |
| Variance data never learned from | **Reality Learning / Business Memory** (V8.2/V8.11) | `inventory_batches` expected vs actual |
| No contradiction detection | **Consistency Monitor** (V8.12) | batches × products × depletion |
| No process coaching | **Operational Coach** (V8.5) | discipline gaps (stock activity, yields, certs) |
| No business health number | **Operational Health Score** (V8.8) | 6 category sub-scores |
| No weekly summary | **Management Report** (V8.10) | performance + waste + compliance |
| Guidance not linked to how-to | **Knowledge Layer** (V8.6) | `docs/operational-playbooks/` registry |

**Engineering decisions (documented, not assumed):**
1. **No new migration.** Every signal above already lands in existing tables, so V8 ships
   without a production DB change — it stays launch-safe and avoids the release-gate drift
   coupling. (If true persistence of "snoozed findings" is wanted later, that is the only
   thing that would need schema.)
2. **Recommendations only (Golden Rule, V8.13).** The whole layer is pure functions + a
   read-only server aggregator. It cannot change stock, prices, orders or costs.
3. **Honesty is non-negotiable (V8.7).** Confidence is derived from real data volume; weak
   data is never dressed up as strong, and findings disappear rather than guess.
4. **Reuse, don't rebuild.** V8 sits on `getDashboardMetrics`, `getOperationsIntelligence`,
   `getInventoryBatches`, `getPurchasingPlan`, `deriveLaunchReadiness` — no duplicate reads.

See `src/lib/shop-intelligence/` for the engine and `docs/operational-playbooks/` for the
knowledge layer.
