# 02 — Workflow Audit

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Each workflow scored **/10 for real-world usability** (busy shop, non-technical user).
Scores weigh: clicks, clarity, failure-resilience, and whether it produces a *correct*
result a tired person can trust. Evidence cited `file:line`.

Recommended actions use **KEEP / MERGE / SIMPLIFY / REMOVE / DEFER**.

---

## 1. Opening shop
- **Trigger:** owner/staff arrives, morning.
- **Steps:** open `/admin/today` (day-shape) → `/admin/open` checklist → record opening temps in `/counter/compliance`.
- **Pages:** `/admin/today`, `/admin/open`, `/counter/compliance`.
- **Tables/RPCs:** `ops_start_or_resume_session`, `ops_record_step`, `ops_complete_session`; `compliance_logs`, `compliance_readings`.
- **Role:** staff/manager.
- **Failure modes:** opening temps captured in **two** places (opening checklist vs compliance log) — V11.3b dedup deferred (`docs/v11/v11-3-consolidation-audit.md:104`). Risk of recording in one and the official `compliance_readings` staying empty.
- **Duplicate-entry risk:** Medium (temperature double capture).
- **Race risk:** Low — `ops_start_or_resume_session` has a unique-active-session guard + fallback.
- **Missing validation:** nothing forces the legal temperature reading to actually land in `compliance_readings`.
- **Observability gaps:** no single "shop is open and compliant" confirmation.
- **Usability: 6/10.**
- **Action: SIMPLIFY** — single temperature capture feeding `compliance_readings` (finish V11.3b). Consider folding `/admin/today/walk` into the day-shape so opening is one path.

## 2. Closing shop
- **Trigger:** end of trade.
- **Steps:** `/admin/close` checklist → guided stock count + waste capture → closing temps.
- **Pages:** `/admin/close`, (`/counter/compliance`).
- **RPCs:** ops_* session/step/complete, `ops_record_stock_count_line`, `ops_apply_stock_count_line`→`admin_adjust_inventory_remaining`, `admin_record_inventory_waste`.
- **Role:** staff/manager.
- **Failure modes:** the closing flow is the **main defence against inventory drift (R1)** but capture is optional — a busy night = skipped = stock stays wrong.
- **Duplicate-entry risk:** Low.
- **Race risk:** Low (FOR UPDATE on lines/sessions/batches).
- **Missing validation:** no nudge if closing is skipped repeatedly; drift accumulates silently.
- **Usability: 6/10** (good when done; depends on perfect behaviour).
- **Action: KEEP + SIMPLIFY** — make the stock/waste capture the fast default, and surface "you haven't counted in N days" on Today.

## 3. Customer order (checkout)
- **Trigger:** customer places order.
- **Steps:** browse → basket → `/checkout` submit.
- **Pages:** `/shop`, `/product`, `/basket`, `/checkout`.
- **RPCs:** `create_checkout_order` (idempotent; capacity, cutoff, min-order, closure, availability all enforced server-side; prices recomputed).
- **Role:** public.
- **Failure modes:** stock status shown may be stale/overstated (R1/R2) → customer orders unavailable item; phone-format UX surfaces late (ux-friction P1).
- **Duplicate-entry risk:** None — `UNIQUE idempotency_key` dedups retries.
- **Race risk:** Low; verify last-slot capacity counts under lock (R4).
- **Missing validation:** none material server-side (strong).
- **Usability: 9/10** — the best workflow in the system.
- **Action: KEEP.**

## 4. Counter fulfilment
- **Trigger:** order arrives.
- **Steps:** `/counter` → Start Prep → Mark Ready → Collected (or Cancel).
- **RPCs:** `transition_order_status` (FOR UPDATE, strict state machine, audit); on Ready → `buildReadySmsOutcome` + `record_sms_attempt`.
- **Role:** branch staff.
- **Failure modes:** **SMS never actually sends (R7)** — staff/customer believe a text went out; "Due in 15 min" label inaccurate (strategy audit §3.3).
- **Duplicate-entry risk:** None (state machine rejects invalid/repeat transitions).
- **Race risk:** Low — row lock + valid-transition guard serialize two tablets correctly.
- **Missing validation:** good; SMS failure should be louder on the card.
- **Usability: 8/10** (would be 9 with honest SMS + accurate due label).
- **Action: KEEP** + fix SMS truth-telling and the due label.

## 5. Stock receiving (non-carcass)
- **Trigger:** delivery arrives.
- **Steps:** `/admin/inventory` → add batch (product, weight, cost, expiry, supplier, halal ref).
- **RPCs:** `admin_create_inventory_batch` (optional idempotency key) + `inventory_movements` RECEIVED + audit.
- **Role:** manager.
- **Failure modes:** entirely manual; if skipped, margin/waste/depletion all break. Cost entry errors propagate to all margin (R9-adjacent).
- **Duplicate-entry risk:** Medium — idempotency key is *optional*; a double submit can double-receive.
- **Race risk:** Low.
- **Missing validation:** no required idempotency; no "this looks like a duplicate delivery" check.
- **Usability: 6/10** (data-entry burden is the adoption risk, STRATEGY §3.8).
- **Action: SIMPLIFY** — make receiving fast; make idempotency mandatory.

## 6. Carcass intake
- **Trigger:** whole/side/quarter delivered.
- **Steps:** `/admin/cutting-guide` calculator → review cuts → confirm intake (`CarcassIntakeReview`).
- **RPCs:** `admin_confirm_carcass_intake` (atomic: intake + cuts + batches + optional price/cost commit + audit; idempotent on key).
- **Role:** manager.
- **Failure modes:** unverified yields (R8) → wrong blended cost → wrong margin/price for every resulting cut; sloppy actual weights (R9).
- **Duplicate-entry risk:** Low (idempotency key) but a repeat returns an error, not a graceful dedup.
- **Race risk:** Low.
- **Missing validation:** no saleable+loss ≈ received reconciliation alert.
- **Usability: 7/10** — impressively atomic; trust gated on yields.
- **Action: KEEP** + butcher sign-off + "estimate" labels + reconciliation check.

## 7. Yield recording
- **Trigger:** part of carcass intake confirm.
- **Steps:** enter actual processed/saleable/loss weights; guardrails (`yield-guardrails.ts`, `yield-review.ts`) flag implausible yields.
- **Tables:** `carcass_intakes`, `carcass_intake_cuts`.
- **Failure modes:** garbage-in if skipped/estimated; blended cost silently wrong.
- **Usability: 6/10.**
- **Action: KEEP** (guardrails are good) + add sum reconciliation (R9).

## 8. Inventory adjustment (correction)
- **Trigger:** owner spots stock is wrong outside a count.
- **Steps:** `/admin/inventory` per-batch "Correct stock" (**owner-only** since V11.3) → reason required.
- **RPCs:** `admin_adjust_inventory_remaining` (FOR UPDATE, reason+actor, audit, CORRECTION movement).
- **Failure modes:** **two correction doors** — this and `/admin/stock-count` (R11). Not idempotent (R3).
- **Duplicate-entry risk:** Medium (double-tap).
- **Race risk:** Low (row lock).
- **Usability: 5/10** (two ways to do one job confuses).
- **Action: MERGE** into stock-count as the single correction authority; keep owner adjust as a labelled exception only.

## 9. Stock count
- **Trigger:** weekly (should be); also in closing.
- **Steps:** `/admin/stock-count` start session → count per batch → apply variance.
- **RPCs:** `ops_record_stock_count_line` (upsert), `ops_apply_stock_count_line`→`admin_adjust_inventory_remaining` (FOR UPDATE).
- **Failure modes:** the **only** correction for R1 drift; if not run, every stock-derived number drifts. No "last counted N days ago" prompt.
- **Duplicate-entry risk:** Low (upsert per batch, applied-once guard).
- **Race risk:** Low.
- **Usability: 7/10.**
- **Action: KEEP** + add staleness nudge on Today (this is the keystone control).

## 10. Waste / spoilage
- **Trigger:** item binned/expired/trim loss.
- **Steps:** `/admin/inventory` (or closing) → record waste (batch, kg, reason).
- **RPCs:** `admin_record_inventory_waste` (FOR UPDATE, ≤ remaining, reason enum, audit, WASTE movement).
- **Failure modes:** not idempotent (R3) → double-count inflates loss & dents reported margin; adoption (owners under-record waste).
- **Duplicate-entry risk:** Medium.
- **Race risk:** Low.
- **Usability: 6/10.**
- **Action: SIMPLIFY** (fast capture) + add idempotency.

## 11. Compliance check (daily food safety)
- **Trigger:** opening/midday/closing.
- **Steps:** `/counter/compliance` → temps + cleaning/sanitisation/waste-checked.
- **RPCs:** `recordComplianceReading`, `markComplianceCompleted`; `compliance_logs`, `compliance_readings`.
- **Failure modes:** duplicate temperature capture vs opening/closing checklists (V11.3b deferred); absence ≠ failure (silent gaps).
- **Duplicate-entry risk:** Medium.
- **Usability: 6/10.**
- **Action: SIMPLIFY** — single temperature source; finish V11.3b dedup.

## 12. Supplier certification
- **Trigger:** new supplier / cert renewal.
- **Steps:** `/admin/compliance` → upsert supplier + cert (body, expiry, verify date, doc).
- **RPCs:** `admin_upsert_supplier_cert`; `suppliers`, `supplier_documents`. Public mirror: `/our-halal-promise`.
- **Failure modes:** **R6** — no nag for suppliers with *no* cert; expiry alert only fires if a dated cert exists.
- **Usability: 7/10.**
- **Action: KEEP** + add "supplier has no certificate recorded" finding.

## 13. Release / admin verification
- **Trigger:** deployment.
- **Steps:** `/admin/releases` → verification items, certify.
- **RPCs:** `update_release_verification_item`, `certify_release` (immutable once certified); migration drift check.
- **Role:** owner (technical).
- **Failure modes:** not a shop workflow; irrelevant to daily ops. Bus-factor-of-one deploy process (STRATEGY §3.7) is the real risk, outside this UI.
- **Usability (as an owner ops task): 2/10** — wrong audience.
- **Action: DEFER** off owner nav; keep tables for deployment safety.

## 14. Customer repeat tracking
- **Trigger:** analysis.
- **Steps:** `/admin` loyalty/customer panels.
- **Data:** derived from `orders.customer_name`/`customer_phone` (**no customer table**), `buildCustomerIntelligence` (operations-intelligence.ts:178).
- **Failure modes:** **R13** — fragile name/phone matching fragments on typos; no decision attached.
- **Usability: 3/10.**
- **Action: DEFER** until there's a real customer entity and a concrete retention action (SMS offer) — which needs working SMS first (R7).

## 15. Pricing validation
- **Trigger:** carcass intake / price setting.
- **Steps:** cutting-guide computes blended cost + suggested price; guardrails warn against carcass-rate pricing.
- **Data:** `cut-sheets.ts` yields (**unverified — R8**); `admin_commit_product_price_cost`.
- **Failure modes:** confident but unsigned-off numbers → systematic mis-pricing.
- **Usability: 6/10** (engine honest, inputs unproven).
- **Action: KEEP** engine; **gate** on butcher sign-off; label outputs "starting estimate."

## 16. SMS / customer communication
- **Trigger:** order marked Ready.
- **Steps:** `buildReadySmsOutcome` → `record_sms_attempt`.
- **Reality:** **stub** — live mode returns hardcoded failure (`src/lib/server/sms.ts:69-74`); default OFF. **No customer is ever texted (R7).**
- **Failure modes:** customer promised a text that never arrives → no-shows; failure recorded honestly in `sms_log` but invisible unless owner looks.
- **Usability: 2/10** (the promise is unmet).
- **Action: DECIDE** — wire Twilio + test, or remove the "we'll text you" promise from customer copy until real. Add a loud "SMS is OFF" banner meanwhile.

---

## Scoreboard

| # | Workflow | Score /10 | Action |
|---|----------|-----------|--------|
| 3 | Customer order (checkout) | 9 | KEEP |
| 4 | Counter fulfilment | 8 | KEEP (+SMS truth, due label) |
| 6 | Carcass intake | 7 | KEEP (+sign-off, reconcile) |
| 9 | Stock count | 7 | KEEP (+staleness nudge) |
| 12 | Supplier certification | 7 | KEEP (+no-cert nag) |
| 1 | Opening shop | 6 | SIMPLIFY (temp dedup) |
| 2 | Closing shop | 6 | KEEP+SIMPLIFY |
| 5 | Stock receiving | 6 | SIMPLIFY (mandatory idempotency) |
| 7 | Yield recording | 6 | KEEP (+reconcile) |
| 10 | Waste/spoilage | 6 | SIMPLIFY (+idempotency) |
| 11 | Compliance check | 6 | SIMPLIFY (temp dedup) |
| 15 | Pricing validation | 6 | KEEP (gate on sign-off) |
| 8 | Inventory adjustment | 5 | MERGE into stock-count |
| 14 | Customer repeat tracking | 3 | DEFER |
| 16 | SMS / comms | 2 | DECIDE (wire or de-promise) |
| 13 | Release verification | 2 (as ops) | DEFER off owner nav |

**Pattern:** the *transaction* workflows (order → counter → cancel) are excellent and safe.
The *data-capture* workflows (receiving, waste, count, compliance) are correct but depend on
perfect human diligence and duplicate effort in places. The *intelligence* workflows
(purchasing, loyalty, pricing) over-promise on data the shop won't reliably feed. The two
genuinely broken-vs-promise items are **SMS (16)** and the **depletion/purchasing chain (built
on R1/R2)**.
