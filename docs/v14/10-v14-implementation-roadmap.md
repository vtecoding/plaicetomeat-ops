# V14.0 — 10 · V14 Implementation Roadmap

Three slices, each shippable, each preserving correctness, each avoiding a large risky migration. Ordered so that **truth-foundation comes before behaviour**, and **behaviour comes before optimisation**. No slice begins until this architecture pack is signed and the Option-C depletion decision is owner-confirmed.

> Reminder: V14.0 (this pack) writes **no code and no migrations.** The slices below are the *plan*, not authorisation to start.

---

## Slice ordering principle

```
V14.1  Make the ledger trustworthy        (no behaviour change to inventory totals)
V14.2  Turn on sales depletion + reversals (the actual feature)
V14.3  Overlays: reservation + intelligence (optional, value-driven)
```

You cannot safely deplete on a ledger that can't be reconstructed (Defect 1) or that drifts from its cache. So **V14.1 fixes the foundation first, while inventory still behaves exactly as today** — lowest-risk possible sequencing.

---

## V14.1 — Ledger Truth Foundation  *(no change to stock totals)*

**Goal:** make `inventory_movements` a reconstructable, append-only ledger of record, with the cache verifiable — *without changing any inventory total or any user-visible behaviour.*

**Deliverables**
1. Migration: add to `inventory_movements` — signed `delta_kg`, `balance_before_kg`, `balance_after_kg`, `source_event` enum, `order_id`/`reference_kind`, `idempotency_key` (nullable for backfill).
2. Backfill historical rows: derive sign/balances for `ADJUSTMENT` from paired `audit_logs.metadata.from_kg/to_kg`; set `source_event` from existing `movement_type`. (Fixes Defect 1 / F13.)
3. Add **append-only trigger** to `inventory_movements` (mirror `audit_logs_append_only`). (Invariant 11.)
4. Normalise the three existing mutators (`admin_create_inventory_batch`, `admin_adjust_inventory_remaining`, `admin_record_inventory_waste`, and the count path) to write the new signed/balance fields. *Same behaviour, richer rows.*
5. **Reconciliation monitor**: a verify script `verify-ledger-truth` asserting, per active batch, `remaining_weight_kg == received + Σ delta` and `== balance_after_kg of latest movement`. Wire into the existing verify-ops harness style.
6. Extend `emit_audit_log` allowlist with the V14 events (even though not yet emitted) so V14.2 needs no audit-boundary change.

**Measurable value:** the ledger becomes court-defensible and self-checking *today*, independent of sales depletion. Closes the two pre-existing defects.

**Risk:** low. No total changes; backfill is verifiable; behaviour identical. The reconciliation script proves correctness before and after.

**Exit gate:** `verify-ledger-truth` green on every batch (cache == ledger); existing inventory tests unchanged; append-only trigger proven by adversarial test.

---

## V14.2 — Sales Depletion + Reversals  *(the feature)*

**Goal:** sales decrement inventory on `ORDER_COLLECTED`; refunds reverse exactly once.

**Deliverables**
1. **Unit-conversion model** (the F12 prerequisite — design + migrate *first within this slice*): resolve each `order_item` to a depletable kg quantity. Weighed-at-counter for `requires_weight_confirmation`/kg products; per-product nominal kg for `each`/`box`; flag non-convertible SKUs as non-inventory. *No depletion ships until this is settled.*
2. **FEFO depletion engine** (`SECURITY DEFINER`): deterministic ordering, `FOR UPDATE` candidate batches, signed `SALE_COLLECT` movements (one per batch touched), zero-out → `depleted`, branch-equality assertion. (Invariants 1, 8, 10, 12.)
3. **Idempotency guard**: one depletion-ledger row per `(order_id,'SALE_COLLECT')` + unique constraint + short-circuit. (Invariant 9.)
4. **Hook into `transition_order_status`** `ready→collected`, same transaction/lock. (Invariant 13.)
5. **Shortfall path** for oversell: deplete-available + `inventory_depletion_shortfall` movement/flag, never negative, never blocked. (F11 — owner-confirmed "allow + flag".)
6. **Refund reversal RPC** (manager-gated): compensating movements, exactly-once guard, dead/recalled-batch handling. (Invariants 5, 6; [05](05-reversal-model.md).)
7. Adversarial test suite: double-collect, concurrent same-batch, retry, refresh, double-refund, oversell, branch crossover, count-during-sale, recalled-batch exclusion. (All of [09](09-failure-modes.md).)

**Measurable value:** inventory becomes a live source of truth; stock levels, depletion, cost-of-goods, and recall traceability go real.

**Risk:** medium — this is the behaviour change. Mitigated by V14.1's verified foundation, the reconciliation monitor catching any drift, FEFO-only (no override) to limit surface, and the staff-only/post-prep blast radius of Option C.

**Exit gate:** full adversarial suite green; `verify-ledger-truth` still green after live depletion in a drill; reconciliation variance measured (should trend toward zero — the engine's self-test, [07](07-reconciliation-model.md)).

---

## V14.3 — Overlays: Reservation + Intelligence  *(optional, value-driven)*

**Goal:** only built if real operational need appears. Two independent, additive overlays.

**Candidate deliverables**
1. **Reservation/availability overlay** (Option D): soft holds against *available* (not physical) stock to prevent oversell at order time, with a `held → consumed | released | expired` lifecycle and no-show sweeping. Build **only if oversell becomes a measured problem** ([03](03-stock-movement-model.md)).
2. **Manual batch override** at collection (completes the FEFO+override hybrid, [04](04-batch-depletion-model.md)).
3. **Intelligence on top of the truth ledger** (feeds V15): waste analytics, yield analysis, reorder recommendations, valuation, margin — all *read-only* over the now-trustworthy ledger.

**Measurable value:** oversell prevention + the commercial-intelligence layer the whole V14 effort was a prerequisite for.

**Risk:** reservation is the complex part (lifecycle, expiry, reconciliation of holds vs. physical). Keeping it in its own slice, *after* physical truth is proven, means it can be deferred or dropped without blocking the core engine.

**Exit gate:** per-feature; intelligence features must not write inventory (read-only over the ledger).

---

## Cross-cutting: what every slice must carry

- **No total changes without a movement** (Invariant 2) — even backfill is reconstructable.
- **Verify-script gate** before merge (house style: green gate, build-ahead, deploy separately).
- **Migration discipline:** additive columns first, backfill, then behaviour — never a big-bang rewrite. (Matches the V11/V12 hardening cadence.)
- **Owner-confirm decision points:** (a) Option C depletion event, (b) F11 oversell = "allow + flag", (c) unit-conversion nominal-kg policy for each/box.

---

## Dependency graph

```
V14.0 (this pack, signed)
   └─► V14.1 ledger truth foundation        [must precede all]
          └─► V14.2 sales depletion + reversals
                 │   (requires: unit-conversion model resolved first)
                 └─► V14.3 reservation overlay  (optional)
                 └─► V14.3 intelligence layer   → feeds V15 Commercial Intelligence
```

---

## Answers to the spec's six final questions (consolidated)

1. **What event decrements inventory?** `ORDER_COLLECTED` (Option C); reservation overlay is later/optional. → [03](03-stock-movement-model.md)
2. **How are reversals handled?** Append-only compensating movements, exactly-once per `(order, reason)`; cancellation of an uncollected order is a no-op. → [05](05-reversal-model.md)
3. **How is concurrency handled?** `FOR UPDATE` in deterministic FEFO order + idempotency guard + CAS freshness for counts; depletion atomic inside the status transition. → [06](06-concurrency-model.md)
4. **How is inventory reconstructed?** Movements become the signed ledger of record; `remaining_weight_kg` is a verifiable cache (`cache == Σ delta`). → [02](02-inventory-truth-architecture.md), [07](07-reconciliation-model.md)
5. **What implementation order is safest?** Ledger-truth foundation (V14.1) → depletion+reversals (V14.2) → overlays (V14.3). → this document
6. **What could silently fail?** Unit conversion (top new risk), adjustment-sign ambiguity, double-deplete, stale reads, batch races, oversell, cache drift, branch crossover — all enumerated with mitigations. → [09](09-failure-modes.md)
