# 01 — Page / Route Usage Audit

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Every route is judged against the **real shop**: a busy halal butcher, one owner (plus
his dad behind the counter), under pressure. "Frequency" = how often a real owner would
*actually* open it, not how often it's technically reachable.

Verdicts: **KEEP / MERGE / SIMPLIFY / REMOVE / DEFER**.

> Maturity note: the codebase is at ≈ V11.3 (HEAD `fb9985c`). The brief's referenced
> "V12/V13.1" inputs are **absent** — see `00-summary.md`. This audit reflects code that
> exists, 40 route files in total.

---

## Public / customer-facing

### `/` — Home / landing
- **Intended user:** Public customer · **Real owner:** never (he's not the audience)
- **Frequency:** customer = per-visit; owner = never
- **Inputs:** none · **Outputs:** branch name/address, 3 featured products, halal/payment messaging, CTA to shop
- **Calls:** `getPublicBranch`, `getPublicProducts`
- **Decision supported:** customer's "is this a real local halal butcher? → shop"
- **Failure impact:** weak first impression → lost order. (2026-06 strategy audit flagged hardcoded demo products/header — verify this is now live data.)
- **Verdict: KEEP** · Highest-traffic trust surface. Confirm it reads real catalog + settings, not hardcoded demo.

### `/shop` — Catalog
- **User:** customer · **Owner:** rare (spot-check)
- **Frequency:** customer high · **Inputs:** category filter · **Outputs:** products by category, countdown banner, stock status
- **Calls:** `getPublicBranch`, `getActiveCategories`, `getPublicProducts`
- **Decision:** customer "what can I order today?"
- **Failure impact:** wrong stock status (see R1/R2) → customer orders an out-of-stock item.
- **Verdict: KEEP.**

### `/product/[slug]` — Product detail
- **User:** customer · **Frequency:** customer medium
- **Outputs:** price, unit, min/max qty, stock badge, weight-confirm note · **Calls:** `getPublicProductBySlug`, `getActiveCategories`
- **Decision:** customer "add this / how much?"
- **Verdict: KEEP.**

### `/basket` — Cart
- **User:** customer · **Outputs:** delegated to `BasketClient`
- **Verdict: KEEP.**

### `/checkout` — Place order
- **User:** customer · **Frequency:** customer per-order
- **Inputs:** name, phone, email, pickup window, items · **Calls:** `completeCheckout` → `create_checkout_order` (idempotent, capacity/cutoff/min-order enforced server-side)
- **Decision:** the actual sale. **Failure impact: Critical** — broken checkout = no business.
- **Verdict: KEEP.** Strongest, safest flow (server-recomputed prices, idempotency key).

### `/order/lookup` — Identity-verified order lookup
- **User:** customer · **Calls:** `establishOrderAccess` → `establish_public_order_access` (rate-limited, phone+ref)
- **Decision:** "let me see my order safely." **Verdict: KEEP** (V11.1 security boundary).

### `/order/status/[publicAccessId]` — Live order tracking
- **User:** customer · **Outputs:** safe DTO (ref, status, window, items, cancel eligibility) · **Calls:** `get_public_order_status` (rate-limited, no PII leakage)
- **Decision:** "is my order ready?" **Verdict: KEEP.**

### `/order/status/[publicAccessId]/cancel` — Customer cancel
- **User:** customer · **Calls:** `cancel_public_order` (FOR UPDATE + version check; **not idempotent on retry — R3**)
- **Verdict: KEEP** · fix retry idempotency (cosmetic-but-confusing).

### `/order/[orderRef]` and `/order/[orderRef]/cancel` — Legacy redirects
- **User:** legacy links · **Outputs:** redirect to `/order/lookup` (V11.1 closed ref-only access)
- **Verdict: KEEP** as thin redirects (don't break old SMS/printed links).

### `/our-halal-promise` — Public supplier transparency
- **User:** customer · **Frequency:** customer low-but-high-value · **Calls:** `getSuppliers({publicOnly:true})`
- **Decision:** the halal trust proof — the shop's #1 differentiator. **Depends on owner entering certs (R6).**
- **Verdict: KEEP** · commercially Critical. Add "last verified" prominence.

### `/privacy` — Legal
- **Verdict: KEEP** (required, static, zero maintenance).

---

## Auth

### `/login`
- **User:** staff/owner · **Frequency:** daily · **Calls:** `login`, `requestPasswordReset`, role-based redirect
- **Failure impact: Critical** (nobody gets in). **Verdict: KEEP.**

### `/auth/update-password`
- **User:** staff resetting password · **Frequency:** rare · **Calls:** `updatePassword`
- **Verdict: KEEP** · (strategy audit flagged Supabase Site-URL config — an env fix, not a code fix).

---

## Counter (staff, the screen the shop runs on)

### `/counter` — Live fulfilment board
- **User:** counter staff (dad) · **Frequency:** **daily, all day** — the single most-used staff screen
- **Inputs:** status taps · **Outputs:** orders by status, customer, window, items, notes, SMS badge, realtime mode · **Calls:** `getCounterOrders`, `getOrderNotes`, `getPickupWindows`, `updateOrderStatus`→`transition_order_status`, `recordOrderNote`
- **Decision:** "what do I prep/hand over next?" **Failure impact: Critical.**
- **Verdict: KEEP** · the most finished, robust part of the app. Note "Due in 15 min" label bug (strategy audit §3.3) + SMS-failure visibility (R7).

### `/counter/orders/[id]` — Order detail
- **User:** counter staff · **Frequency:** as-needed · **Calls:** `getOrderById`
- **Decision:** "show me the full order." **Verdict: KEEP.**

### `/counter/compliance` — Daily food-safety log
- **User:** counter staff · **Frequency:** daily (opening/midday/closing temps) · **Calls:** `recordComplianceReading`, `markComplianceCompleted`
- **Decision:** legal food-safety evidence. **Verdict: KEEP** · but see duplication with opening/closing checklists temperature capture (`03`, deferred V11.3b dedup).

---

## Admin — daily operational

### `/admin/today` — TODAY (Owner Brain)
- **User:** owner · **Frequency:** **daily** — the intended owner home
- **Outputs:** Urgent/Important/Opportunities decisions, day-shape, shop status, weekly summary, "More" grid · **Calls:** `getOwnerBrain` (wraps `getShopIntelligence`), `buildDayShape`
- **Decision:** "what do I do today?" — the whole point of an operating system.
- **Failure impact: High** (if noisy/empty, owner stops using it — R12).
- **Verdict: KEEP** · genuinely strong (caps, language firewall). Its quality depends on R1/R2 data honesty and on data entry.

### `/admin/today/[id]` — Decision detail card
- **User:** owner · **Calls:** `getOwnerBrain`, `findDecision` (redirects if resolved)
- **Verdict: KEEP.**

### `/admin/today/walk` — Guided morning walk
- **User:** owner returning after time away · **Frequency:** rare · **Calls:** `getOwnerBrain`, `buildDayShape`
- **Decision:** hand-held opening. **Verdict: SIMPLIFY/DEFER** · overlaps Today + `/admin/open`. Valuable for onboarding only; consider folding into Today's day-shape rather than a separate route (`03`).

### `/admin/open` — Opening checklist
- **User:** owner/staff · **Frequency:** daily · **Calls:** `recordOpeningChecklist` (ops_* RPCs)
- **Decision:** "is the shop ready to trade?" **Verdict: KEEP** · but reconcile temperature capture with `/counter/compliance` (`03`).

### `/admin/close` — Closing checklist (+ guided stock/waste capture)
- **User:** owner/staff · **Frequency:** daily · **Calls:** ops_* RPCs, stock-count + waste capture
- **Decision:** "lock up correctly; capture today's truth." **Verdict: KEEP** · the best lever for fighting inventory drift (R1) if used.

### `/admin/stock-count` — Physical count / reconciliation
- **User:** owner · **Frequency:** weekly (should be) · **Calls:** `getStockCountState`, `ops_record_stock_count_line`, `ops_apply_stock_count_line`→`admin_adjust_inventory_remaining`
- **Decision:** "make the system match the fridge." **Failure impact: High** — it's the *only* thing that corrects R1 drift.
- **Verdict: KEEP** · designated single stock-correction door (V11.3). Critical given no sales-decrement.

---

## Admin — management & analysis

### `/admin` — Business Insights (analysis hub)
- **User:** owner/manager · **Frequency:** weekly (realistically), not daily
- **Outputs:** snapshot stats + 9 analysis panels (expiry, waste, margin, profitability, depletion, loyalty, basket, certs, product performance) · **Calls:** `getDashboardMetrics`, `getOperationsIntelligence`, `getShopIntelligence`
- **Decision:** "how's the business trending?" **Failure impact: Low** (advisory).
- **Verdict: SIMPLIFY** · nine panels are analyst-grade and thin without sustained data; several are non-actionable (R13) or built on the false depletion denominator (R2). Keep the hub; demote/defer the weak panels (`04`).

### `/admin/orders` — Order history
- **User:** owner · **Frequency:** weekly / exceptions · **Calls:** `getCounterOrders`
- **Decision:** "find/search a past order." **Verdict: KEEP** (reframed as history in V11.3). Minor overlap with `/counter` (live) — acceptable, different jobs.

### `/admin/products` — Products & prices
- **User:** owner · **Frequency:** weekly/occasional · **Calls:** `admin_create_product`, `admin_update_product(_price)`, `admin_set_product_availability`
- **Decision:** "what do I sell, at what price, in/out of stock." **Failure impact: High** (drives catalog + margin). **Verdict: KEEP.**

### `/admin/inventory` — Stock batches & waste
- **User:** owner · **Frequency:** on receiving / waste · **Calls:** `admin_create_inventory_batch`, `admin_record_inventory_waste`, `admin_adjust_inventory_remaining` (adjust now owner-only)
- **Decision:** "record what came in / what I binned." **Verdict: SIMPLIFY** · per-batch "Correct stock" duplicates `/admin/stock-count` (R11/`03`). Keep receiving + waste; route corrections to stock-count.

### `/admin/purchasing` — Buying recommendations
- **User:** owner · **Frequency:** weekly (order day) · **Calls:** `getPurchasingPlan`
- **Decision:** "what to order more/less." **Failure impact: misleading (R2)** — built on depletion that ignores sales-decrement.
- **Verdict: SIMPLIFY/DEFER** · valuable concept, but gate behind a recent stock count or demote until R1 fixed. Currently **dangerous** confidence.

### `/admin/cutting-guide` — Carcass yield / price calculator
- **User:** owner · **Frequency:** on carcass intake · **Calls:** `getProductCostMap`, `getAllProducts`, `admin_commit_product_price_cost`
- **Decision:** "what's this carcass really cost me / what to charge per cut." **Failure impact: High** — unverified yields (R8).
- **Verdict: KEEP** (engine is honest) · but needs butcher sign-off + "estimate" labelling. Overlaps conceptually with carcass intake confirm (`03`).

### `/admin/compliance` — Supplier certificates
- **User:** owner · **Frequency:** monthly/quarterly · **Calls:** `admin_upsert_supplier_cert`, `getSuppliers`
- **Decision:** "are my suppliers' halal/food-safety certs current?" **Failure impact: High** (R6 + brand). **Verdict: KEEP** · add "no cert on file" nag.

### `/admin/pickup-windows` — Collection slots
- **User:** owner · **Frequency:** rare (set once, tweak) · **Calls:** `admin_create/update/set_active_pickup_window`
- **Verdict: KEEP.**

### `/admin/shop-closures` — Holiday/closed days
- **User:** owner · **Frequency:** rare · **Calls:** `admin_create/remove_shop_closure`
- **Verdict: KEEP** · low cost, prevents orders on closed days (esp. Eid).

### `/admin/settings` — Branch settings + SMS templates
- **User:** owner · **Frequency:** rare · **Calls:** `admin_update_branch_settings`
- **Decision:** min order, cutoff, SMS copy. **Verdict: KEEP** · but SMS template is moot while sending is stubbed (R7).

### `/admin/setup` — Pre-launch readiness checklist
- **User:** owner · **Frequency:** once (launch) then never · **Calls:** `getSetupChecklist`, `getDashboardMetrics`
- **Decision:** "am I safe to open?" **Verdict: KEEP** for launch, **DEFER from daily nav** after go-live (overlaps Today setup-mode).

### `/admin/playbooks` + `/admin/playbooks/[slug]` — How-to guides
- **User:** owner/staff · **Frequency:** rare (training/reference) · **Calls:** `allPlaybookContent`, `getPlaybookContent`
- **Decision:** "how do I do X?" **Verdict: KEEP** · cheap, supports adoption.

### `/admin/guide` — Quick guides + dry-run script
- **User:** owner · **Frequency:** rare · **Outputs:** 6 quick cards + pre-launch dry-run
- **Verdict: MERGE** · overlaps `/admin/playbooks` (two help surfaces — `03`). Fold quick cards into playbooks index; keep dry-run under setup.

### `/admin/audit` — Audit event log
- **User:** owner only · **Frequency:** rare (disputes/forensics) · **Calls:** `getRecentAuditEvents`
- **Decision:** "who did what?" **Verdict: KEEP — do not touch** (protects auditability; sealed append-only, R14).

### `/admin/releases` — Deployment/migration ledger
- **User:** owner (technical) · **Frequency:** rare/never for a butcher · **Calls:** `getReleaseGovernance`
- **Decision:** dev/deploy health — **not a shop-operations decision.**
- **Verdict: DEFER/REMOVE from owner nav** · keep the tables (deployment safety) but it's not an operational page; hide from the owner's surface (`04` Decorative).

### `/admin/briefing` — Retired
- **Outputs:** `redirect('/admin/today')` (V11.3) · **Verdict: KEEP as redirect** (preserves bookmarks); the *concept* is correctly merged.

---

## Frequency roll-up

| Frequency | Pages |
|-----------|-------|
| **Daily (owner/staff)** | `/counter`, `/counter/compliance`, `/admin/today`, `/admin/open`, `/admin/close`, `/login` |
| **Weekly** | `/admin`, `/admin/orders`, `/admin/purchasing`, `/admin/stock-count` |
| **On-event** | `/admin/inventory` (receiving/waste), `/admin/cutting-guide` (carcass), `/counter/orders/[id]`, `/admin/today/[id]` |
| **Monthly / rare** | `/admin/products`, `/admin/compliance`, `/admin/pickup-windows`, `/admin/shop-closures`, `/admin/settings`, playbooks/guide |
| **Once / launch** | `/admin/setup`, `/admin/today/walk` |
| **Rare-technical (not ops)** | `/admin/audit`, `/admin/releases` |
| **Customer** | `/`, `/shop`, `/product`, `/basket`, `/checkout`, `/order/*`, `/our-halal-promise`, `/privacy` |

## Verdict roll-up

| Verdict | Count | Pages |
|---------|-------|-------|
| KEEP | 28 | all customer + auth + counter + today/open/close/stock-count + products/compliance/orders/windows/closures/settings/playbooks/audit + briefing-redirect |
| SIMPLIFY | 5 | `/admin` (panels), `/admin/inventory` (correction dup), `/admin/purchasing` (gate on count), `/admin/cutting-guide` (label/signoff), `/admin/today/walk` |
| MERGE | 1 | `/admin/guide` → playbooks |
| DEFER | 2 | `/admin/setup` (post-launch), `/admin/releases` (off owner nav) |
| REMOVE | 0 hard removes | (releases = remove-from-nav, not delete) |

**Headline:** No page is outright harmful enough to delete. The work is **simplification and
honesty**, not removal — concentrate the owner's daily attention on Today + Counter, and
stop a handful of analytics surfaces presenting confident numbers built on incomplete data.
