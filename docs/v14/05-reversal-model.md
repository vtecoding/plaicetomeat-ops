# V14.0 — 05 · Reversal Model — *Undoing a depletion, exactly once*

Because depletion fires on `ORDER_COLLECTED` (a terminal state — see [03](03-stock-movement-model.md)), **most orders never need a reversal**: an order cancelled before collection never depleted, so there is nothing to undo. Reversals are the rare exception, which is precisely why Option C is the low-risk choice.

Reversals are nonetheless mandatory for the cases that *do* occur:
- a **refund** after collection (customer returns goods, or staff refund a completed sale),
- a **mis-collection correction** (order marked collected by mistake),
- a future **post-collection cancellation** if the business ever allows it.

---

## First principle: reverse by compensation, never by edit

The ledger is **append-only** (Invariant 11). A reversal is **not** an update or delete of the original depletion movement. It is a **new compensating movement** that adds the quantity back, bound to the same order and the same batch(es).

```
   SALE_COLLECT     order O, batch B, delta −2.500kg   (original depletion)
   CANCEL_REVERSAL  order O, batch B, delta +2.500kg   (compensating)  ← new row
```

Reasons:
- **Auditability:** the history shows both that the sale happened *and* that it was reversed — court-defensible. Editing the original would erase the fact a sale ever occurred.
- **Reconstruction (Invariant 4):** `Σ delta` over the pair nets to zero, so `remaining` self-heals without special-casing.
- **It matches the house pattern:** counts and waste already work by appending movements, never mutating prior ones.

---

## Exactly-once (Invariants 5 & 6)

The dangerous failure is **double reversal** — crediting stock back twice (e.g. two staff both click "refund", or a retry after a network blip). Stock would inflate silently. Prevention is layered:

1. **DB uniqueness (authoritative):** a partial unique index on `inventory_movements` over `(order_id, source_event)` for the reversal events:
   - `UNIQUE (order_id) WHERE source_event = 'CANCEL_REVERSAL'`
   - `UNIQUE (order_id) WHERE source_event = 'REFUND_REVERSAL'`
   A second reversal attempt hits a `unique_violation` and is caught.
   *(If an order can span multiple batches, the uniqueness key is the reversal **operation**, recorded as one ledger "reversal group" row per order+event, with per-batch child movements — so the guard is one-per-order regardless of batch count. Exact shape is a V14.2 implementation detail; the invariant is one reversal per order per reason.)*

2. **RPC existence check under lock:** before reversing, lock the order and the depletion-ledger row; if a reversal for this `(order_id, reason)` already exists, **short-circuit and return it** (idempotent), exactly as `ops_apply_stock_count_line` short-circuits on `applied_at`.

3. **Reversal requires a prior depletion.** You cannot reverse what never depleted. The RPC asserts a matching `SALE_COLLECT` exists for the order; if the order never reached `collected`, there is nothing to reverse (return a no-op, not an error that masks intent).

This is the same triad the codebase already trusts for idempotency: **unique index (DB) + short-circuit on prior-state (RPC) + catch `unique_violation` (race fallback)** — see `create_checkout_order` and `admin_create_inventory_batch`.

---

## Which batch does stock return to?

A reversal must credit stock back to the **same batch(es) the original sale depleted** — recoverable because each `SALE_COLLECT` movement is bound to its `batch_id` and `order_id`. The reversal walks the original depletion movements for the order and emits an equal-and-opposite `+delta_kg` per batch.

Edge cases:
- **The original batch is now `depleted`/`disposed`:** crediting stock back must restore `status='active'` if `remaining` rises above 0 (mirror of how zero-out flips to `depleted`).
- **The original batch was `recalled` or physically gone:** returning recalled stock to active is wrong. In that case the reversal credits to a **new "returns" reconciliation movement** (not the dead batch) and flags it for manager review — physical reality (the returned meat) is handled as a fresh decision, not an automatic resurrection of recalled stock.
- **Partial reversal (partial refund):** reverse only the refunded quantity, FEFO-proportional or operator-specified across the original batches; same exactly-once guard keyed by a refund line, not the whole order.

---

## Cancellation vs. refund — two distinct paths

| | Cancellation (pre-collection) | Refund (post-collection) |
|---|---|---|
| Did stock move? | **No** (collected never reached). | **Yes** (`SALE_COLLECT` exists). |
| Inventory action | **None.** No reversal needed. | **Compensating `REFUND_REVERSAL`** movement(s). |
| Trigger | `transition_order_status(*→cancelled)` | manager-gated refund RPC |
| Authority | branch staff | branch manager (money/stock event) |
| Audit event | `order_status_changed` (existing) | `inventory_reversed_for_order` (new) |

> Note the asymmetry: **"cancellation reversal" (Invariant 5) is only nonzero if the business ever depletes before collection** (e.g. a future Option-B/D maturity step). Under the recommended Option C, cancellation of an uncollected order is a no-op for inventory — and the invariant still holds trivially (zero reversals, which is exactly once-or-fewer). The machinery must still exist so that *if* a depleted-then-cancelled path is ever added, it reverses exactly once.

---

## Audit & evidence

Every reversal emits, via `emit_audit_log`, a new allowlisted event (`inventory_reversed_for_order`) carrying: `order_id`, `reason` (`cancel`|`refund`|`mis_collection`), per-batch `delta_kg`, `balance_before/after`, the `id` of the original `SALE_COLLECT` movement(s) it compensates, and the actor. This makes the reversal *traceable to the exact sale it undoes* — see [08](08-audit-model.md).

---

## Summary

- Reverse by **appending compensating movements**, never editing history.
- **Exactly-once** via partial unique index + RPC short-circuit + `unique_violation` catch.
- Credit back to the **original batch(es)**; handle recalled/dead batches as flagged returns, not resurrection.
- **Cancellation ≠ refund:** under Option C, cancelling an uncollected order touches no stock; only post-collection refunds reverse.
