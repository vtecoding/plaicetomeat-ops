# V14.0 — 06 · Concurrency Model

Inventory depletion is the highest-contention write in the system once sales move stock: the same batch can be hit by many simultaneous collections, and the same *order* can be acted on by two staff, a double-click, a retry, or a refresh. This document defines the exact protection strategy.

The codebase already has a proven concurrency vocabulary; V14 composes it rather than inventing:
- **Pessimistic `SELECT … FOR UPDATE`** — used by `transition_order_status`, `admin_adjust_inventory_remaining`, and the `pickup_windows` capacity lock in `create_checkout_order`.
- **Compare-and-set freshness guard** — `STALE_STOCK_COUNT` in `ops_apply_stock_count_line`.
- **Idempotency by unique key + payload equality** — `idempotency_key`/`idempotency_fingerprint` in checkout; `intake_idempotency_key` in intake.

---

## The threat scenarios

| Scenario | What goes wrong without protection |
|----------|-----------------------------------|
| Two staff fulfil the **same order** simultaneously | Order depleted twice → stock under-counted, double reversal risk. |
| Two staff fulfil **different orders hitting the same batch** | Lost update on `remaining_weight_kg` → over- or under-depletion; possible negative stock. |
| **Double-click** "Mark collected" | Same as double fulfilment. |
| **Retry after network failure** (request committed, response lost) | Client resubmits → double depletion. |
| **Browser refresh** mid-action | Re-POST of the transition. |
| **Concurrent stock count** during a sale | Count applies a stale snapshot → lost update. |
| Multi-batch depletion where two orders **interleave** across the same batches | Deadlock, or partial inconsistent depletion. |

---

## Protection strategy

### 1. Idempotency at the *order/intent* level (collapses duplicate requests)
Every depletion is identified by an **idempotency key** = `(order_id, 'SALE_COLLECT')`. A **depletion-ledger guard** — one row per order per depletion intent, with a unique constraint — ensures:
- First successful collection writes the guard row + the per-batch movements, atomically.
- Any later attempt (double-click, retry, second staffer, refresh) finds the guard row and **short-circuits to the existing result** — exactly the `applied_at` short-circuit pattern in `ops_apply_stock_count_line`.
- A genuine race (two transactions both pass the existence check) is resolved by the **unique constraint**: the loser catches `unique_violation` and returns the winner's result. (Same belt-and-braces as checkout.)

This makes depletion **idempotent**: N identical requests ⇒ exactly one depletion (Invariant 9).

### 2. Pessimistic row locking (prevents lost updates on shared batches)
Within the depletion transaction:
1. `SELECT … FOR UPDATE` the **order** (already done by `transition_order_status`).
2. `SELECT … FOR UPDATE` the **candidate batch rows** in FEFO order.
3. Re-read `remaining_weight_kg` *after acquiring the lock* (never trust a value read before locking — this is what defeats TOCTOU).
4. Append signed movement(s) + update the cache + flip `status` at zero.
5. Commit releases all locks.

Because the cache is updated **only while holding the batch lock**, concurrent depletions on the same batch **serialize** — no lost updates, no negative stock.

### 3. Deterministic lock ordering (prevents deadlock)
Multi-batch depletion locks batches in a **total, deterministic order** — the same FEFO ordering used for selection (`expiry_date, received_date, id`). Two orders consuming overlapping batches acquire locks in the *same sequence*, so they queue instead of deadlocking. (Classic ordered-locking deadlock avoidance.)

> If a future feature needs to lock batches across *different* products in one transaction, the global order must still be a single total order (e.g. always by `id`) to preserve deadlock-freedom.

### 4. Compare-and-set for counts vs. sales (already present, keep it)
`ops_apply_stock_count_line` already refuses to apply a count if `batch.remaining_weight_kg <> line.system_weight_kg` (the snapshot went stale because a sale moved stock in between). V14 **keeps this guard** and it becomes *more* important once sales are frequent: a count taken at 09:00 and applied at 11:00, after sales depleted the batch, is correctly rejected with `STALE_STOCK_COUNT` → "re-count before applying." This is the count-during-sale defence.

---

## Transaction boundaries

- **Depletion is one transaction**, executed **inside `transition_order_status`'s** transaction for the `ready→collected` edge (Invariant 13). The status flip and the stock movement commit together or not at all.
- **All batches for one order deplete atomically** (Invariant 12): either the full line set is satisfied (possibly spanning batches) or the transaction records a shortfall and commits a *consistent* state — never a half-applied set of movements.
- **Reversals** are likewise single transactions with their own idempotency guard (see [05](05-reversal-model.md)).

---

## Retry behaviour (client + server contract)

- The collection action carries the **order id**; the server derives the idempotency key from `(order_id, 'SALE_COLLECT')`. The client does **not** need to generate a key — the order identity *is* the key. This is safer than checkout (where the payload is user-supplied) because the order already exists and is immutable.
- A retried request after a committed-but-unacknowledged transaction returns the **same result** (the guard row exists). No double depletion.
- Transient failures (lock timeout, serialization) are **safe to retry** because of idempotency; the client may retry with backoff. Non-transient failures (insufficient stock handled as shortfall, see [09](09-failure-modes.md)) return a definitive result and must not be blindly retried.

---

## Failure recovery

| Failure point | State after | Recovery |
|---------------|-------------|----------|
| Crash **before** commit | No movement, no status change, no guard row. | Order still `ready`; staff simply retry. Clean. |
| Crash **after** commit, **before** client ack | Movement + status + guard all present. | Retry short-circuits on guard row. No double effect. |
| Lock wait timeout | Transaction rolled back. | Safe retry (idempotent). |
| Insufficient stock at collection | See [09](09-failure-modes.md) — recorded as shortfall + flag, **never** negative. | Manager reconciles via count/adjustment. |
| Cache vs. ledger drift detected later | Reconciliation monitor (Invariant 14) raises a `security_event`. | Recompute cache from ledger; V13.4 backups available if needed. |

---

## Why pessimistic, not optimistic, for the depletion core

An optimistic (version-column CAS) scheme is viable and the stock-count guard *is* optimistic. But for the **hot, multi-row, must-not-deadlock** depletion path, pessimistic `FOR UPDATE` with ordered acquisition is:
- already the house pattern (lower cognitive and review risk),
- naturally correct for the multi-batch span (lock the set, then mutate),
- free of retry-storm behaviour under contention (waiters queue rather than spin-and-abort).

The CAS guard is retained specifically for **stock counts**, where the "evidence taken at time T" semantics make rejection (not blocking) the correct behaviour.
