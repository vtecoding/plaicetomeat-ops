# V14.0 — 09 · Failure Modes — Adversarial Analysis

Every way the engine could produce a wrong number, ranked and mitigated. The dangerous failures are the **silent** ones — those that corrupt downstream numbers without an error. Each entry: **impact · likelihood · detection · mitigation.**

Severity key: 🟥 silent corruption (worst), 🟧 visible error / blocked op, 🟨 recoverable nuisance.

---

## F1 — Duplicate collection event (double-deplete) 🟥
- **Impact:** stock decremented twice; under-counts inventory; may trigger false reorder.
- **Likelihood:** high (double-click, retry, two staff, refresh).
- **Detection:** would be invisible without guards (that's what makes it dangerous).
- **Mitigation:** idempotency guard row keyed `(order_id,'SALE_COLLECT')` + unique constraint + RPC short-circuit ([06](06-concurrency-model.md)). Invariant 9. **Primary defence.**

## F2 — Double refund / double reversal 🟥
- **Impact:** stock credited back twice; over-counts; sells phantom stock.
- **Likelihood:** medium (refund is manual, retry-prone).
- **Detection:** invisible without guards.
- **Mitigation:** partial unique index `(order_id, source_event)` for reversals + RPC short-circuit ([05](05-reversal-model.md)). Invariants 5, 6.

## F3 — Partial cancellation / partial refund 🟧
- **Impact:** wrong quantity reversed (whole order instead of one line, or vice-versa).
- **Likelihood:** medium.
- **Detection:** reversal `delta_kg ≠` refunded quantity, catchable in audit.
- **Mitigation:** reversal keyed to a **refund line**, not the whole order; partial reverses only the refunded kg, FEFO-proportional or operator-specified across original batches ([05](05-reversal-model.md)).

## F4 — Stale inventory read (lost update) 🟥
- **Impact:** a value read before locking is used to compute a new balance → lost update → wrong stock, possibly negative.
- **Likelihood:** high under concurrency.
- **Detection:** cache ≠ Σ ledger (Invariant 14 monitor).
- **Mitigation:** **always re-read `remaining_weight_kg` after `FOR UPDATE`**, never trust a pre-lock value ([06](06-concurrency-model.md)). For counts, the `STALE_STOCK_COUNT` CAS guard rejects stale snapshots.

## F5 — Failed transaction leaving half-applied depletion 🟥→🟧
- **Impact:** some batches depleted, order not `collected` (or vice-versa); inconsistent.
- **Likelihood:** low (DB transactions are atomic) — only a risk if depletion were split across transactions.
- **Detection:** order `collected` without matching `SALE_COLLECT` movements (audit query).
- **Mitigation:** depletion runs **inside** the `ready→collected` transaction; all batches atomic (Invariants 12, 13). Never split across transactions/RPCs.

## F6 — Race condition on a shared batch 🟥
- **Impact:** two orders deplete the same batch concurrently → over-depletion / negative stock.
- **Likelihood:** high for popular products.
- **Detection:** negative-balance attempt; cache/ledger drift.
- **Mitigation:** `FOR UPDATE` serializes writers on the batch; deterministic lock order prevents deadlock ([06](06-concurrency-model.md)). Invariants 1, 6.

## F7 — Batch depletion drift / non-determinism 🟧
- **Impact:** same inputs pick different batches → irreproducible cost-of-goods and traceability.
- **Likelihood:** medium (expiry ties).
- **Detection:** replay test; inconsistent batch selection in audit.
- **Mitigation:** **total** FEFO ordering `expiry_date, received_date, id` (Invariant 8, [04](04-batch-depletion-model.md)).

## F8 — Stock count performed during a sale 🟥→🟧
- **Impact:** count applies a stale snapshot, erasing a concurrent sale's depletion → lost update.
- **Likelihood:** medium (mid-day counts).
- **Detection:** the guard catches it.
- **Mitigation:** `STALE_STOCK_COUNT` CAS guard rejects the apply and forces a re-count ([07](07-reconciliation-model.md)). Fails closed, not silent. Invariant 7.

## F9 — Branch crossover 🟥
- **Impact:** an order in branch A depletes a batch in branch B → both branches' numbers wrong; isolation broken.
- **Likelihood:** low (gates exist) but catastrophic.
- **Detection:** movement where `batch.branch_id ≠ order.branch_id` (assertable).
- **Mitigation:** `is_branch_*` gate + explicit branch-equality assertion (order, batch, actor all one branch); RLS on reads. Invariant 10. **Add a runtime assertion in the depletion RPC**, don't rely on the join alone.

## F10 — Negative stock 🟥
- **Impact:** physically impossible balance poisons valuation and availability.
- **Likelihood:** medium without guards.
- **Detection:** `CHECK (remaining_weight_kg >= 0)` (already exists) blocks the write.
- **Mitigation:** DB CHECK (Invariant 1) + the shortfall path (F11) so collection of physically-present goods is never blocked by a stale-low belief.

## F11 — Oversell at collection (belief < physical) 🟥 (subtle)
- **Impact:** the order needs more kg than the ledger believes remains (estimation error, unrecorded intake). Naïvely you either (a) violate Invariant 1 by going negative, or (b) block a collection of meat that physically exists.
- **Likelihood:** medium — estimates and trim loss guarantee belief ≠ physical sometimes.
- **Detection:** depletion requirement exceeds available across all active batches.
- **Mitigation:** **deplete what's available, then record an explicit `inventory_depletion_shortfall` movement/flag for the remainder** (delta capped so balance floors at 0, with a recorded shortfall quantity + audit), and **allow the collection** (goods physically left). Never go negative; never silently drop the shortfall. The shortfall flag drives a manager reconciliation. This is the deliberate resolution of the Invariant-1-vs-physical-reality tension. *(Owner decision point: confirm "allow + flag" over "block".)*

## F12 — Unit-conversion error (each/box → kg) 🟥
- **Impact:** depleting a wrong kg amount for non-weight SKUs → systematic over/under-depletion of those products; cost and reorder numbers skew.
- **Likelihood:** high if unmodelled — `order_items.unit_type` can be `each`/`box`, inventory is kg-only.
- **Detection:** reconciliation variance for those products **grows** after V14 ships (the count catches it — see [07](07-reconciliation-model.md)).
- **Mitigation:** explicit conversion model in V14.1 (weighed-at-counter for weight products via `requires_weight_confirmation`; per-product nominal kg for each/box; non-convertible SKUs flagged non-inventory) ([03](03-stock-movement-model.md)). **This is the highest-risk *new* modelling in V14.**

## F13 — Adjustment-sign ambiguity (legacy defect) 🟥
- **Impact:** historical `ADJUSTMENT` rows store `abs(delta)`; reconstruction can't tell up from down → Invariant 4 unprovable.
- **Likelihood:** certain (it's the current state).
- **Detection:** reconstruction mismatch on historical data.
- **Mitigation:** signed `delta_kg` + `balance_before/after` going forward; backfill historical sign from paired `audit_logs.metadata.from_kg/to_kg` ([02](02-inventory-truth-architecture.md)).

## F14 — Cache vs. ledger drift 🟥
- **Impact:** `remaining_weight_kg` diverges from `Σ delta` → every read lies.
- **Likelihood:** low with single-transaction updates; nonzero from bugs/out-of-band edits.
- **Detection:** **nightly reconciliation monitor** (Invariant 14) comparing cache to `balance_after_kg` of latest movement per batch.
- **Mitigation:** atomic ledger+cache update under one lock; monitor raises `security_event`; recompute cache from ledger; V13.4 backups as last resort.

## F15 — Depleting a recalled/disposed batch 🟧
- **Impact:** selling stock that must not be sold (food-safety/halal breach).
- **Likelihood:** low.
- **Detection:** movement on a non-`active` batch.
- **Mitigation:** FEFO candidates are `status='active'` only; `recalled`/`disposed` excluded ([04](04-batch-depletion-model.md)). Recall outranks FEFO.

## F16 — Reversal resurrecting dead/recalled stock 🟧
- **Impact:** a refund credits stock back to a recalled batch → recalled meat re-enters availability.
- **Likelihood:** low.
- **Detection:** reversal targeting a non-active batch.
- **Mitigation:** reversal to a dead/recalled batch goes to a flagged "returns" reconciliation movement for manager review, not auto-resurrection ([05](05-reversal-model.md)).

## F17 — Public/abuse path reaching depletion 🟧
- **Impact:** bot/retry storm thrashes inventory.
- **Likelihood:** low under Option C (depletion is staff-only, post-prep).
- **Detection:** n/a (prevented by design).
- **Mitigation:** depletion reachable only via `transition_order_status` (`authenticated` + branch-staff). This is a **key reason Option C beats Option A** ([03](03-stock-movement-model.md)).

---

## Risk heat summary

| Mode | Sev | Likelihood | Residual after mitigation |
|------|-----|-----------|---------------------------|
| F1 double-deplete | 🟥 | high | very low |
| F2 double-reversal | 🟥 | med | very low |
| F4 stale read | 🟥 | high | very low |
| F6 batch race | 🟥 | high | very low |
| F11 oversell | 🟥 | med | low (flagged, never negative) |
| **F12 unit conversion** | 🟥 | **high if unmodelled** | **depends on V14.1 design — top risk** |
| F13 legacy sign | 🟥 | certain | low (after backfill) |
| F14 cache drift | 🟥 | low | very low (monitored) |

**The single most important finding:** F12 (unit conversion) is the highest *new* risk and is not yet modelled. It must be designed before V14.1 implementation begins. F1/F4/F6 are fully addressed by reusing existing house patterns. F13 is a pre-existing defect that V14 fixes.
