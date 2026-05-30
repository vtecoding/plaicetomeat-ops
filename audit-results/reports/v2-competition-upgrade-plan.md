# V2 Competition-Upgrade Plan — PlaiceToMeat Ops

Date: 2026-05-30. Every recommendation is scored against the core levers: **Yield · Waste · Repeat Rate**.

## The single most important finding

**The database is already a V2 operating system; the application is a V1 storefront with a prototype back office.** The migrations in `supabase/migrations/202605300001_v2_phase_a_backbone.sql` already create: `order_status_events`, `order_notes`, `sms_templates`, `login_attempts`, `suppliers`, `supplier_documents`, `inventory_batches`, `inventory_movements`, the `stock_levels` view, annual order references, an append-only `audit_logs` trigger, and a fully-hardened `create_checkout_order` RPC. **The fastest path to beating local competitors is not building new schema — it is wiring the existing UI to the schema that already exists.** That is mostly application work, not data modeling.

Legend per category: **DB** = schema state · **UI** = app-layer state · **Verdict** = the required judgment.

---

### 1. Production hardening
- Checkout validation — **DB ✅** (RPC enforces everything) · **UI ✅** client (minus phone pattern, P1.3).
- Basket enforcement — **UI ✅** (submit disabled when empty/below min).
- Route protection — **✅** middleware + RLS (PASS).
- Session timeout — **✅** `isStaffSessionExpired` (4h idle) in middleware.
- Failed-login protection — **DB ✅** `login_attempts` table + index · **UI ❌** no login exists to record attempts.
- Audit logging — **DB ✅** append-only · **UI ⚠️** only the checkout RPC writes audit; no admin/counter action writes audit.
- **Verdict — Can this safely take real customer orders today?** *Public ordering: yes, pending live end-to-end + SMS-safety verification. Staff/owner operations: no — no login, no persistence.*

### 2. Real order system
- DB persistence — **✅** orders/order_items/status_events. Human-readable refs — **✅** `PTM-YYYY-NNNNN`.
- Realtime counter sync — **❌** no subscription (P0.3).
- Order detail view — **partial** (`/counter/orders/[id]` route exists; persistence missing).
- Staff notes — **DB ✅** `order_notes` · **UI ❌**.
- Status SMS/templates — **DB ✅** `sms_templates` · **UI ❌** (faked on card).
- **Verdict — Can staff run a collection operation from this?** *No, until status persistence + realtime + a login are wired (P0).*

### 3. Inventory foundation
- Batches, supplier link, expiry, remaining weight, cost/kg, movements — **DB ✅ all present** (`inventory_batches`, `inventory_movements`, `stock_levels`).
- Stock alerts, dead-stock detection — **❌** no UI/queries yet.
- **Verdict — Can the owner know what stock exists / what's about to spoil?** *Data model: yes. Today, in the app: no — zero inventory UI.* Highest-leverage build because it unlocks waste prevention.

### 4. Spoilage killer (Waste lever)
- Expiry engine — **partial** (`inventory_batches.expiry_date` + `stock_levels.earliest_expiry`).
- Flash offers, targeted broadcast, waste log, monthly waste report — **❌** (movements support `WASTE` type, but no flow).
- **Verdict — Does the software actively prevent margin loss?** *Not yet — but the substrate exists. Build: nightly "expiring in N days" → one-tap flash offer → targeted SMS to recent buyers → log uplift. This is the clearest ROI feature in the product.*

### 5. Repeat customer engine (Repeat lever)
- Buy-again, lapsed reactivation, VIP tiers, birthday capture, customer profiles — **❌** no customer entity (orders store name/phone only).
- **Verdict — Does the software make customers come back?** *No.* Add a lightweight customer aggregate keyed by phone (orders already indexed by `branch_id, customer_phone, created_at`), then buy-again + "we miss you" SMS.

### 6. Smart bundles & upsells (Yield lever)
- Product pairing, seasonal/Ramadan/recipe bundles — **❌** (a "Family Curry Pack" product exists, but no bundle logic).
- **Verdict — Does it increase AOV?** *Not structurally.* Add bundle product type + "goes well with" + seasonal collections.

### 7. Halal compliance trust engine (Trust → Repeat)
- Supplier records, cert upload, expiry, batch traceability, HMC/HFA distinction — **DB ✅** (`suppliers.halal_certifying_body`, `cert_expiry`, `supplier_documents` with `expiry_date`/`verified_at`, `inventory_batches.halal_cert_ref`/`slaughter_date`/`country_of_origin`).
- Public halal-promise page + public "last verified" date — **❌** UI.
- **Verdict — Can PlaiceToMeat prove halal trust better than competitors?** *Better than almost anyone, once surfaced — the traceability data model already beats a typical local butcher's "trust us". Build the public page + manager cert dashboard with expiry alerts.*

### 8. Qurbani / Eid / Ramadan system (Seasonal yield)
- Seasonal events, Ramadan mode, Qurbani booking, deposits, collection-day planning, charity manifest, forecasting — **❌** none.
- **Verdict — Can it own the highest-revenue moments?** *Not yet.* Highest seasonal revenue; build after V2.0/V2.1 are stable (do not pull forward).

### 9. Custom cut engine (Butcher moat)
- Per-line cut instructions, saved preferences, whole-animal booking, prep-time estimate — **❌** (`order_items.staff_notes` column exists, unused).
- **Verdict — Does it communicate the real-butcher advantage over supermarkets?** *Not yet.* Per-line cut notes is a small build with outsized differentiation.

### 10. WhatsApp / SMS / channels
- Order updates — **DB ✅** templates · **UI ❌**. Marketing opt-in vs order-update consent, STOP handling, message logs, failed-send recovery, flash broadcast — **❌**.
- **Verdict — Can the shop reach customers where they are?** *Twilio is wired as a dependency but the send path is unproven and consent/STOP handling is absent — must be built before any marketing send (compliance + reputation risk).*

### 11. Founder intelligence
- Daily briefing, weekly review, margin/waste/revenue, supplier cost tracker, action-needed list — **❌** (data exists to compute most of it).
- **Verdict — Can a new owner understand the business each morning?** *No.* A single `/admin` briefing card is the highest-perceived-value owner feature.

### 12. Reputation & referral
- Review request, sentiment routing, Google review routing, negative-feedback escalation, referral codes — **❌**.
- **Verdict — Does it manufacture word-of-mouth and protect reputation?** *No.* Post-collection review request (gated by status=collected) is a cheap repeat/reputation win.

### 13. Weight variance engine
- Fixed vs variable type — **DB ✅** (`products.unit_type`, `requires_weight_confirmation`, `order_items` snapshots).
- Approx price display, counter weighing flow, customer approval, refund/adjust strategy, variance analytics — **❌** UI.
- **Verdict — Does it prevent the #1 butcher dispute (final weight/price)?** *Schema is ready (`requires_weight_confirmation` flag exists); the flow is not built.* High-value once pay-on-collection scales.

---

## Phase 12 — Additional high-value features (only the non-bloat ones)

| Feature | Metric | Why competitors lack it | Complexity | Dependencies | Risk | Phase |
|---|---|---|---|---|---|---|
| Expiry → flash-offer automation | Waste↓ Yield↑ | Needs batch+expiry+customer data joined; most POS lack it | M | Inventory UI, customer aggregate, SMS | Over-discounting | V2.1/2.2 |
| Public halal traceability page (cert + last-verified) | Repeat↑ Trust | Local butchers assert, don't prove | S | suppliers/docs (exist) | Stale data looks worse than none | V2.1 |
| Owner daily briefing | Retention of *owner* | Requires unified data; bespoke | S–M | orders/inventory queries | Wrong numbers erode trust | V2.5 (early stub in V2.0) |
| Buy-again from order history | Repeat↑ | No customer model in typical site | S | customer aggregate | Low | V2.2 |
| Per-line cut instructions + saved prefs | Yield↑ Moat | Supermarkets can't; sites rarely | S | order_items.staff_notes (exists) | Low | V2.3 |
| Counter weigh + variance approval | Dispute↓ | Hard without integrated counter flow | M | weight fields (exist), SMS | Payment reconciliation | V2.3 |
| Prep queue grouped by pickup time | Speed↑ Waste↓ | Generic dashboards don't | S | status persistence | Low | V2.0/2.1 |
| Qurbani deposit/preorder | Seasonal yield↑ | Almost no local butcher has online Qurbani | L | payments/deposits, events | Regulatory/deposit handling | V2.4 |

Rejected as bloat for this business: loyalty points gamification, generic CRM pipelines, multi-currency, complex role designer.

---

## Recommended V2 execution order (refined from audit)

**V2.0 — Make V1 production-safe (do first, gate launch on this):**
1. Login page + Supabase auth + `login_attempts` recording + role-based landing.
2. Persisted counter status (server action → `orders.status` + `order_status_events` + audit).
3. Realtime subscription (orders/status events) with polling fallback.
4. Admin CRUD wired (products incl. price-change audit + stock toggle reflected publicly; pickup windows; settings; shop closures).
5. Safe **test mode** for checkout + verified SMS dry-run/disabled-send + truthful send status.
6. Counter card phone + status-age + full items; staff notes (`order_notes`).
7. Focused Playwright regression suite proving the above.

**V2.1 — Operational backbone (schema mostly exists):** supplier directory + cert dashboard with expiry alerts; public halal-promise page; inventory batches + movements UI; stock + expiring-soon boards; waste log.

**V2.2 — Revenue & retention:** customer aggregate; buy-again; flash offers from expiring stock; lapsed reactivation; post-collection review request; referral credits.

**V2.3 — Butcher moat:** per-line cut instructions + saved prefs; variable-weight display + counter weigh + variance approval; whole-animal booking.

**V2.4 — Seasonal dominance (only after 2.0/2.1 stable):** Ramadan mode; seasonal events; Qurbani booking + deposits + staff dashboard + charity manifest.

**V2.5 — Founder intelligence:** daily briefing; weekly review; supplier cost tracker; waste/margin/reorder suggestions; retention dashboard.

> Do not build V2.4 before V2.0 and V2.1 are stable. The seasonal revenue is only safe to chase once orders persist, staff can log in, and stock/compliance are real.
