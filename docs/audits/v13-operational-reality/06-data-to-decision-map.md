# 06 — Data-to-Decision Map

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Rule: **data without a decision is bloat** — unless it is legally/audit-required history.
For each important data source: where it comes from, who enters it, what decision it should
drive, whether that decision is actually visible, whether it's effectively unused, and the
verdict (**KEEP / REMOVE / → INSIGHT**).

---

| Data | Source / table | Who enters | Decision it should support | Decision visible in UI? | Unused? | Verdict |
|------|----------------|------------|----------------------------|-------------------------|---------|---------|
| Orders + items | `orders`, `order_items` | customer (checkout) | prep, revenue, demand | ✅ counter, today, admin | No | **KEEP** |
| Order status history | `order_status_events` | staff (transitions) | dispute/audit, throughput | ⚠️ audit only | partly | **KEEP** (audit/legal) |
| Order notes | `order_notes` | staff | handover context | ✅ counter | No | **KEEP** |
| Products + price | `products` | owner | what/price to sell, margin | ✅ shop, admin/products | No | **KEEP** |
| Product cost (fallback) | `products.cost_per_kg` | owner | margin when no batch | ⚠️ feeds margin silently | partly | **KEEP** + show "fallback cost" flag (D8) |
| Inventory batches | `inventory_batches` | owner (receiving/intake) | what's in stock, expiry, cost basis | ✅ inventory/today | No | **KEEP** — but `remaining_weight_kg` is **intake-only (R1)** |
| Inventory movements | `inventory_movements` | system (RECEIVED/WASTE/CORRECTION) | traceability, drift forensics | ❌ not surfaced to owner | mostly | **KEEP** (audit) — no need to surface |
| Waste events | `inventory_waste_events` | owner | waste cost, true margin, buy-less | ✅ admin waste panel | No (when entered) | **KEEP → INSIGHT** (waste-by-product is the genuinely useful one) |
| Stock count lines | `stock_count_lines` | owner | correct drift, detect shrink/theft | ✅ stock-count | No | **KEEP** (the keystone control) |
| Carcass intakes + cuts | `carcass_intakes`, `_cuts` | owner | blended cost, per-cut price, traceability | ✅ cutting-guide/intake | No | **KEEP** (yields need sign-off, R8) |
| Suppliers + cert | `suppliers`, `supplier_documents` | owner | halal/safety compliance, public trust | ✅ compliance + promise page | No | **KEEP → INSIGHT** (add "no cert" nag, R6) |
| Compliance log + temps | `compliance_logs`, `compliance_readings` | staff | legal food-safety evidence | ✅ compliance | No | **KEEP** — single-source the temps (D2) |
| Ops checklist sessions/events | `ops_checklist_sessions/events` | staff | opening/closing done, drift defence | ✅ open/close/today | No | **KEEP** |
| Pickup windows | `pickup_windows` | owner | when customers can collect | ✅ checkout/admin | No | **KEEP** |
| Shop closures | `shop_closures` | owner | block orders on closed days | ✅ checkout/admin | No | **KEEP** |
| Branch settings | `branch_settings` | owner | min order, cutoff, SMS copy | ✅ settings | partly (SMS copy moot, R7) | **KEEP** |
| SMS log | `sms_log` (+ order sms_status) | system | "did the customer get told?" | ⚠️ counter badge / buried | **effectively yes** (sending stubbed, R7) | **KEEP** but **act on R7** — data is honest, decision (call customer) isn't surfaced loudly |
| Customer name/phone | on `orders` (no customer table) | customer | repeat/loyalty, retention offers | ⚠️ admin loyalty panel | **largely unused for action** (R13) | **→ INSIGHT or REMOVE** — needs a real customer entity + a concrete action (offer SMS) before it earns screen space |
| Basket pairings | derived (`buildBasketIntelligence`) | system | cross-sell / bundles | ⚠️ admin panel | **yes — no action taken** | **REMOVE/DEFER** until it drives a bundle/upsell |
| Product performance | derived | system | promote/drop products | ⚠️ admin panel | partly | **→ INSIGHT** (collapse to "top seller / biggest waste") |
| Depletion forecast | derived from batches + order_items | system | when to reorder | ⚠️ purchasing | **misleading (R2)** | **REMOVE from daily surface** until R1 fixed or count-gated |
| Purchasing recommendations | derived (purchasing-intelligence) | system | order more/less | ✅ purchasing | **dangerous (R2)** | **DEFER/REWORK** to "sold vs wasted, you decide" |
| Login attempts | `login_attempts` | system | rate-limit/lockout | ❌ (security only) | n/a | **KEEP** (security, not ops) |
| Public rate limits | `public_rate_limits` | system | abuse protection | ❌ | n/a | **KEEP** (security) |
| Audit logs / events | `audit_logs`, `audit_events` | system | who-did-what, legal | ✅ /admin/audit | No | **KEEP — do not touch (R14)** |
| Release/verification/cert | `release_*`, `expected_migrations` | dev | deploy safety | ✅ /admin/releases | n/a for shop | **KEEP tables, REMOVE from owner nav** (Decorative) |

---

## Patterns

**1. The biggest data-integrity gap: `inventory_batches.remaining_weight_kg` is intake-only.**
Sales never decrement it (R1). Every "stock" decision downstream — depletion (R2), purchasing,
"expiring today," customer stock badges — inherits this. This is the single most important
data-to-decision break in the system. *Fix the source, not the screens (see `03` D5).*

**2. Data collected that doesn't drive a decision (bloat candidates):**
- Basket pairings — computed, never acted on → **REMOVE/DEFER.**
- Customer loyalty (name/phone matching) — no action, fragile, no customer entity → **DEFER** until there's a retention action (needs working SMS, R7).
- Inventory movements / order status events — *not bloat*: they're audit/legal history, correctly not surfaced to the owner.

**3. Data that IS a decision but isn't loud enough:**
- `sms_log` failures → owner should be told "customers aren't being texted" (R7).
- Suppliers with **no** cert → silent (R6); absence should nag.
- "Last stock count N days ago" → exists implicitly, never surfaced; it's the honesty signal for all stock data.

**4. Honest-by-design wins to preserve:** margin shows "unavailable" rather than guessing;
purchasing requires evidence; audit is sealed. Keep this philosophy — it's the brand.

## Net recommendation
- **Convert to insight:** waste-by-product, product-performance (collapsed), supplier-no-cert nag, stock-count-staleness, SMS-not-sending alert.
- **Remove/defer from owner surface:** basket pairings, loyalty (until retention action), depletion/purchasing auto-recommendations (until R1), releases ledger.
- **Keep untouched (audit/legal/security):** inventory_movements, order_status_events, audit_logs/events, login_attempts, rate limits.
