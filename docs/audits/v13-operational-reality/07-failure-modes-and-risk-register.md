# 07 — Failure Modes & Risk Register

_V13 Operational Reality Audit · 2026-06-08 · audit-only, no code changed._

Severity: **Critical / High / Medium / Low**. Likelihood: **High / Medium / Low**.
Scored against the **real shop**, not the test suite. Evidence is cited as `file:line`.

> Scope note: this register audits the **actual repository at HEAD** (latest commit
> `fb9985c`, system maturity ≈ V11.3). The brief refers to "V12 completion" and a
> "V13.1 discovery report"; **no V12/V13 artefacts exist in the repo** (see
> `00-summary.md` → Unknowns). Findings below are grounded only in code that exists.

---

## R1 — Silent inventory drift (stock levels overstate reality)

- **Severity:** Critical · **Likelihood:** High (structural, every trading day)
- **What:** Order fulfilment never decrements stock. `transition_order_status`
  (`supabase/migrations/202605300002_v2_phase_b_ops.sql:5-77`) moves an order to
  `collected` and writes an audit log, but creates **no `SALE` inventory_movement and
  never touches `inventory_batches.remaining_weight_kg`**. Stock only decreases via
  waste (`admin_record_inventory_waste`) or manual correction
  (`admin_adjust_inventory_remaining`) / stock count. By design — sales-decrement was
  declared a non-goal in V11.3 (`docs/v11/v11-3-consolidation-audit.md:108`).
- **Effect:** `stock_levels` (the view at `202606031000`) and every "what's in stock"
  / "running low" surface **systematically overstate** real stock. The longer between
  stock counts, the larger the lie.
- **Detection:** Only a physical stock count (`/admin/stock-count`) reveals the gap,
  and only for batches actually counted.
- **Current mitigation:** Stock count workflow exists and writes variance lines
  (`stock_count_lines`).
- **Missing mitigation:** No drift indicator ("last counted N days ago"), no estimated
  decrement from sold `order_items`, no staleness flag on stock figures.
- **Recommended action:** Either (a) surface a blunt "stock figures are intake-only,
  last verified X days ago" honesty banner everywhere stock is shown, or (b) implement
  sales-linked decrement (a V14 capability, not a V13 tweak). **Do not** add more
  features that consume `remaining_weight_kg` as if it were real until one of these
  lands. See R2.

## R2 — Depletion / "running low" forecast built on a false denominator

- **Severity:** Critical · **Likelihood:** High
- **What:** `buildInventoryDepletionForecast`
  (`src/lib/server/operations-intelligence.ts:187-199`) divides **sales velocity from
  `order_items` (kg sold)** by **`remaining_weight_kg` from batches** — but that
  remaining weight is *not* reduced by those same sales (R1). The forecast measures
  consumption against a quantity that ignores consumption.
- **Effect:** "Days until runout", purchasing "order more/less"
  (`src/lib/domain/purchasing-intelligence.ts`) and the owner's "what to buy" decision
  are built on contradictory truths. This is **dangerous**: it presents a confident
  number that is structurally wrong.
- **Detection:** None in-app; only reality (ran out / over-ordered) reveals it.
- **Current mitigation:** Confidence levels are capped and recommendations require
  evidence (`capConfidence`, purchasing-intelligence.ts).
- **Missing mitigation:** The forecast does not warn that its stock input is intake-only.
- **Recommended action:** Until R1 is resolved, treat depletion/purchasing as
  **decorative** — demote it from the owner's daily decision surface or gate it behind a
  "needs a recent stock count" guard.

## R3 — Duplicate stock movement / double-entry on intake

- **Severity:** High · **Likelihood:** Low–Medium
- **What:** Intake paths (`admin_create_inventory_batch` `202605310003:103`, carcass
  intake `202606021100`) carry idempotency keys (`intake_idempotency_key`,
  carcass `idempotency_key`), and checkout uses a `UNIQUE idempotency_key`
  (`create_checkout_order`). Good. **But** manual stock correction
  (`admin_adjust_inventory_remaining` `202606011430:229`) and waste
  (`admin_record_inventory_waste`) are **not idempotent** — a double-tap or retry on a
  flaky shop tablet can apply a correction/waste twice.
- **Effect:** Over- or under-stating stock; a waste event counted twice inflates
  reported loss and dents reported margin.
- **Detection:** `inventory_movements` audit trail (each row visible) — but nobody reads
  it during a shift.
- **Current mitigation:** `FOR UPDATE` row lock on the batch (correct serialisation).
- **Missing mitigation:** No idempotency key on adjust/waste; no UI debounce evidence.
  Also: `cancel_public_order` (`202606051300_v11_1_seal_public_access.sql:26`) has **no
  idempotency key** — a customer who retries a cancellation after a network drop gets a
  hard error ("this order can no longer be cancelled online") even though their first
  attempt already succeeded. Confusing, not corrupting (the `FOR UPDATE` lock + version
  check prevent double-cancel), but it makes a working action look broken.
- **Recommended action:** Add idempotency to adjust/waste RPCs and return the existing
  cancellation state on a repeat `cancel_public_order` instead of an error (small,
  V13.2-sized).

## R4 — Race condition: concurrent order fulfilment / pickup-window capacity

- **Severity:** Medium · **Likelihood:** Low
- **What:** `transition_order_status` takes `SELECT ... FOR UPDATE` on the order row and
  enforces a strict state machine (`202605300002:30-49`) — **status races are safe**.
  Checkout capacity (`max_orders` per window) is enforced inside `create_checkout_order`;
  needs confirmation it counts under lock (the function is SECURITY DEFINER and
  idempotent on key, but two *different* customers hitting the last slot simultaneously
  is the classic gap).
- **Effect:** Possible over-booking of a pickup window by 1 under perfect concurrency.
- **Detection:** Staff notice "too many orders for the 4-6pm slot".
- **Current mitigation:** Single low-volume shop makes the collision window tiny.
- **Missing mitigation:** Explicit capacity-count-under-lock verification.
- **Recommended action:** Verify the capacity check in `create_checkout_order`; cheap to
  harden. Low priority given volume.

## R5 — Wrong-branch data exposure

- **Severity:** Critical (if present) · **Likelihood:** Low
- **What:** Branch isolation is enforced by RLS helpers (`is_branch_staff`,
  `is_branch_manager`, `current_profile_branch_id` — `202605290001:206-260`) and SECURITY
  DEFINER RPCs re-check branch. The model is sound and consistent.
- **Effect:** A leak would cross-expose another shop's orders/customers.
- **Detection:** RLS + `public-route-imports.test.ts`, `route-access.test.ts`.
- **Current mitigation:** Strong — single source of branch truth, tested.
- **Missing mitigation:** Single-branch deployment means this is largely untested *in
  anger*; multi-branch is unproven.
- **Recommended action:** **Do not touch.** Protects correctness. Re-verify only if/when
  a second branch is onboarded.

## R6 — Compliance / certificate expiry missed

- **Severity:** High (halal trust + legal) · **Likelihood:** Medium
- **What:** Supplier/halal certs live in `suppliers.cert_expiry` and
  `supplier_documents.expiry_date`; expiry warnings (30-day) feed the owner brain.
  Capture is real (`admin_upsert_supplier_cert` `202605310003:5`). **Risk is adoption**,
  not code: if the owner never enters/refreshes a cert, the system silently shows
  "all good" because absence ≠ expiry.
- **Effect:** Selling under a lapsed halal cert — the single most brand-damaging failure
  for this shop.
- **Detection:** Expiry alert *only fires if a cert with a date was entered*.
- **Current mitigation:** 30-day warning surfaced in Today/owner brain.
- **Missing mitigation:** No "you have suppliers with **no** cert on file" nag; absence
  is invisible.
- **Recommended action:** Add a "supplier has no certificate recorded" finding (distinct
  from "expiring"). Cheap, high commercial value. V13.2 candidate.

## R7 — SMS / "we'll text you when ready" silently does nothing

- **Severity:** High · **Likelihood:** High (it is the current state)
- **What:** `buildReadySmsOutcome` (`src/lib/server/sms.ts:38-75`) **is a stub**. Even
  in "live" mode with a provider configured it returns
  `status: "failed", failureReason: "Live SMS provider is not wired up in this build."`
  Default is OFF (`SMS_SENDING_ENABLED` must equal `"true"`). So today **no customer is
  ever texted**, yet the customer-facing flow promises "we'll text when ready".
- **Effect:** Customers wait for a text that never comes → no-shows, counter confusion,
  eroded trust. The failure is *recorded honestly* in `sms_log` but invisible to the
  owner unless they open the SMS log.
- **Detection:** `failed` count in `sms_log` (surfaced as a daily failed-SMS count in
  operations-intelligence.ts:117-122) — good, but only if the owner looks.
- **Current mitigation:** Honest status recording; counter shows an SMS badge per order.
- **Missing mitigation:** Provider not wired; no loud "SMS is OFF — tell customers
  you'll call" banner; customer copy still promises a text.
- **Recommended action:** Decide explicitly: either wire Twilio (then test) **or** remove
  the "we'll text you" promise from customer copy until it's real. Do not ship a promise
  the system cannot keep. V13.2 decision.

## R8 — Pricing validation gives false confidence (unverified yields)

- **Severity:** High · **Likelihood:** High
- **What:** Carcass pricing derives "real meat cost" and recommended per-cut prices from
  `yieldPct` in `src/lib/butchery/cut-sheets.ts`. The file *itself* warns these are
  "typical UK averages… never gospel" (cut-sheets.ts:11-14). No butcher has signed them
  off (the brief references a "pricing validation/signoff report" — **not present in the
  repo**).
- **Effect:** Systematic mis-pricing across every cut if yields are off. An
  authoritative-looking wrong price is worse than no price.
- **Detection:** Only a real butcher comparing to what they'd charge.
- **Current mitigation:** Honest engine (blended real cost, "don't price at carcass
  rate" guardrails in `yield-guardrails.ts`), editable assumptions.
- **Missing mitigation:** No human sign-off record; no "these yields are unverified"
  flag at the point of price recommendation.
- **Recommended action:** Get a butcher sign-off (owner action, not code). Until then,
  label recommended prices "starting estimate — confirm at the block".

## R9 — Carcass yield mismatch (expected vs actual)

- **Severity:** Medium · **Likelihood:** Medium
- **What:** Carcass intake tracks expected vs actual weights and processing loss
  (`carcass_intakes.processed_weight_kg/saleable_weight_kg/processing_loss_kg`,
  `202606021100`). Blended cost is computed from these. If the owner enters sloppy
  actuals (or skips them), the blended `cost_per_kg` flowing into batches — and thus all
  margin — is wrong.
- **Effect:** Wrong cost basis propagates silently into margin/pricing.
- **Detection:** `yield-review.ts` guardrails flag implausible yields.
- **Current mitigation:** Guardrails + draft/confirm status on intakes.
- **Missing mitigation:** No reconciliation alert when saleable+loss ≠ received.
- **Recommended action:** Keep guardrails; add a sum-reconciliation check. Low priority.

## R10 — Cancellation / refund does not reverse stock

- **Severity:** Low (today) → High (if sales-decrement is ever added) · **Likelihood:** N/A now
- **What:** Cancellation (`cancel_order_by_ref` `202605310002`, `transition_order_status`
  → cancelled) updates order status only. Because sales never decrement stock (R1),
  there is correctly nothing to reverse **today**. This becomes a real bug the moment
  sales-decrement is introduced without paired reversal.
- **Effect:** None now; a trap for any future V14 inventory work.
- **Recommended action:** Document as a hard constraint for any sales-decrement project:
  decrement and reversal must ship together.

## R11 — Staff using the wrong page

- **Severity:** Medium · **Likelihood:** Medium
- **What:** V11.3 consolidated "one door per job"
  (`docs/v11/v11-3-consolidation-audit.md`) — Today for ops, Counter for service,
  Stock-count for corrections. **But** retired routes still resolve: `/admin/briefing`
  redirects to Today, `/admin?mode=counter` falls through to Business Insights, and
  per-batch "Correct stock" still exists as an owner-only form alongside Stock count.
  Three near-synonym surfaces remain reachable.
- **Effect:** Staff land on an analysis screen mid-rush, or correct stock in two
  different places creating reconciliation confusion.
- **Detection:** None.
- **Current mitigation:** Nav simplified; redirects in place.
- **Missing mitigation:** Old URLs still navigable; two stock-correction doors persist.
- **Recommended action:** Finish the consolidation — see `03-duplicate-capability-audit.md`.

## R12 — Owner ignores the dashboard because it's too noisy

- **Severity:** High · **Likelihood:** High
- **What:** The 2026-06 strategy audit documented severe dashboard overload
  (`docs/STRATEGY-AND-AUDIT-2026-06.md:71-93`): near-duplicate panels, jargon badges,
  nine analytics sub-panels. V9 Owner Brain (`/admin/today`) and V11.3 consolidation
  addressed much of this, but `/admin` Business Insights still concentrates nine
  analytics surfaces that are thin/empty without sustained data entry.
- **Effect:** The owner stops opening the screen meant to run the day → the whole
  intelligence layer goes dormant (the "data-adoption" quiet killer,
  STRATEGY-AND-AUDIT §3.8).
- **Detection:** Behavioural only.
- **Current mitigation:** Owner Brain "Today" is genuinely compressed (3 buckets, caps,
  language firewall — `docs/V9-OWNER-BRAIN.md`).
- **Missing mitigation:** Business Insights still built for an analyst.
- **Recommended action:** Keep Today; demote/defer the thin analytics until data exists.

## R13 — Reports exist but are not actionable

- **Severity:** Medium · **Likelihood:** High
- **What:** Customer loyalty, basket pairings, product performance, repeat-customer rate
  (`operations-intelligence.ts`, `action-intelligence/*`) compute fine but lead to no
  decision the owner can take in a busy shop. Repeat-customer tracking matches on
  `customer_name`/`customer_phone` from `orders` (**no customer table**) — fragile and
  easily fragmented by typos.
- **Effect:** Effort spent reading panels that don't change behaviour = admin noise.
- **Recommended action:** Convert each to a single decision or remove. See
  `06-data-to-decision-map.md`.

## R14 — Audit trail integrity (positive — protect it)

- **Severity:** Critical to preserve · **Likelihood:** N/A
- **What:** `audit_logs` and `audit_events` are sealed append-only (V11.2,
  `202606051400`), direct writes revoked, mutation-prevention triggers
  (`prevent_audit_log_mutation`, `prevent_audit_events_mutation`). All money/stock RPCs
  emit audit rows.
- **Recommended action:** **Do not touch.** This protects auditability and money. Any
  refactor must preserve the seal.

---

## Risk heat summary

| ID | Risk | Severity | Likelihood | Verdict |
|----|------|----------|-----------|---------|
| R1 | Silent inventory drift (no sales decrement) | Critical | High | SIMPLIFY (honesty banner) / DEFER (decrement→V14) |
| R2 | Depletion forecast on false denominator | Critical | High | REMOVE from daily surface until R1 fixed |
| R3 | Non-idempotent adjust/waste | High | Low–Med | SIMPLIFY (add idempotency) |
| R4 | Pickup-window capacity race | Medium | Low | KEEP (verify) |
| R5 | Wrong-branch exposure | Critical | Low | KEEP — do not touch |
| R6 | Cert expiry / absence missed | High | Med | SIMPLIFY (add "no cert" nag) |
| R7 | SMS stub — texts never sent | High | High | DECISION: wire or de-promise |
| R8 | Unverified pricing yields | High | High | Owner sign-off (no code) |
| R9 | Carcass yield mismatch | Medium | Med | KEEP (add reconcile) |
| R10 | Cancellation/stock reversal | Low now | N/A | Document constraint |
| R11 | Wrong-page use / dead routes | Medium | Med | MERGE/REMOVE dead doors |
| R12 | Noisy dashboard ignored | High | High | SIMPLIFY/DEFER analytics |
| R13 | Non-actionable reports | Medium | High | REMOVE/convert to decisions |
| R14 | Audit seal | Critical (protect) | N/A | KEEP — do not touch |

**Top 3 to fix before V13 close:** R7 (SMS promise vs reality), R2 (kill the misleading
forecast), R6 (missing-cert nag). **Top thing not to touch:** R5 + R14 (branch isolation
+ audit seal).
