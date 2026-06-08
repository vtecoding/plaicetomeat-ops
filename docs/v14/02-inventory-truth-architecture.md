# V14.0 — 02 · Inventory Truth Architecture

This is the spine of the pack. It defines *what "truth" means* for inventory and the hard invariants every other document and every future implementation slice must respect.

---

## 1. The central architectural decision: ledger-of-record

Today: `inventory_batches.remaining_weight_kg` **is** the truth; `inventory_movements` is a log written alongside it.

V14: **invert this.** `inventory_movements` becomes the **append-only ledger of record**. `remaining_weight_kg` is demoted to a **materialized cache** — a denormalised convenience that *must always be reconstructable from the ledger*.

```
            WRITE PATH (every stock change)
   ┌──────────────────────────────────────────────┐
   │ 1. lock batch row  (FOR UPDATE)               │
   │ 2. append signed movement (the truth)         │
   │ 3. set remaining_weight_kg = prev + delta     │  ← cache, in same txn
   │ 4. emit audit evidence                        │
   └──────────────────────────────────────────────┘
                         │
            READ PATH
   fast:  SELECT remaining_weight_kg            (cache)
   proof: SELECT sum(signed_delta) FROM movements  (must equal cache)
```

Why a cache *and* a ledger, rather than computing `remaining` on every read (pure event-sourcing)?
- **Read performance / availability:** the storefront and TODO dashboard read stock constantly; summing a growing ledger per product per request does not scale and couples availability to ledger size.
- **The cache is cheap to verify:** a single reconciliation query (`cache == Σ deltas`) proves the two agree. Drift becomes a *detectable invariant violation*, not a silent corruption.
- **It matches the house style:** intake and adjustment already update `remaining` in the same transaction as the movement. V14 keeps that shape but makes the movement *complete enough to reconstruct from*.

This is "transactional materialized aggregate", not eventual consistency. The cache is updated in the **same transaction** as the ledger append, under the **same row lock**. They cannot diverge from a single writer; the reconciliation check exists to catch bugs and out-of-band edits.

---

## 2. The movement row must become self-sufficient

For the ledger to be the truth, each movement must answer *by itself*: what changed, by how much, in which direction, from what to what, why, by whom, when, and caused by which event.

**Required additions to the movement model (DDL is V14.1, not here):**

| Field | Why | Fixes |
|-------|-----|-------|
| **signed `delta_kg`** (or keep `quantity_kg>0` *and* add a `direction`) | A movement must encode direction. `ADJUSTMENT` of `abs(delta)` is ambiguous today. | Defect 1 / Invariant 4 |
| **`balance_before_kg`, `balance_after_kg`** | Court-defensible evidence (the spec's audit requirement) and trivial reconstruction. | Invariant 2, 4 |
| **`source_event` enum** (`INTAKE`, `SALE_COLLECT`, `CANCEL_REVERSAL`, `REFUND_REVERSAL`, `WASTE`, `COUNT_RECONCILE`, `MANUAL_ADJUST`, `RECALL`, `TRANSFER`) | Distinguishes *why* a row exists; current `movement_type` conflates type and cause. | Invariant 2 |
| **`order_id` / `reference_id` + `reference_kind`** | Binds sale/reversal movements to the order that caused them. | Invariant 5, 6; reversal matching |
| **`idempotency_key`** (unique, scoped) | Retry/double-click safety at the ledger row level. | Invariant 9 |

> Compatibility note: `quantity_kg CHECK (>0)` and the existing `movement_type` enum can be **retained** for backward compatibility; V14 adds the signed/`source_event`/balance columns alongside. Backfill `balance_*` and sign for historical rows is a V14.1 data task (historical `ADJUSTMENT` sign can be recovered from the paired `audit_logs.metadata.from_kg/to_kg`).

---

## 3. Hard invariants

These are non-negotiable. Each lists its enforcement layer. "DB" = enforced by constraint/trigger and therefore true even if application code is wrong; "RPC" = enforced inside the `SECURITY DEFINER` function; "Check" = continuously verified by a reconciliation/monitor query.

| # | Invariant | Enforcement |
|---|-----------|-------------|
| **1** | **Stock can never become negative.** `remaining_weight_kg >= 0` and no movement may drive it below 0. | DB `CHECK (remaining_weight_kg >= 0)` (already exists) + RPC pre-check; oversell handled by *shortfall* path, never a negative balance ([09](09-failure-modes.md)). |
| **2** | **Every stock change has an auditable reason.** | RPC: no movement without `source_event` + `reason`; mirrored to `audit_logs` via `emit_audit_log`. |
| **3** | **Every stock movement has an actor.** Human actor = `auth.uid()`; system actor = explicit system reason (never forgeable). | RPC: actor derived from `auth.uid()`, never a parameter (mirrors `emit_audit_log` design). |
| **4** | **Current stock is reconstructable from movement history.** `remaining = received − Σ(out) + Σ(in)` provable from the ledger alone. | DB: signed delta + `balance_after_kg`; Check: nightly `cache == Σ delta` per batch. |
| **5** | **Cancellation reversal occurs exactly once.** | DB: unique `(order_id, source_event='CANCEL_REVERSAL')`; RPC: lock + existence check. |
| **6** | **Refund reversal occurs exactly once.** | DB: unique `(order_id, source_event='REFUND_REVERSAL')`. |
| **7** | **A stock count never silently mutates history.** It creates a reconciliation movement. | RPC: counts route through the correction path (already true in `ops_apply_stock_count_line`). |
| **8** | **Batch depletion is deterministic.** Same order + same stock state ⇒ same batches chosen in the same order. | RPC: FEFO ordering is total (tie-break by `received_date`, then `id`); see [04](04-batch-depletion-model.md). |
| **9** | **Duplicate requests cannot double-deplete.** | DB: unique movement `idempotency_key` per `(order_id, intent)`; RPC: short-circuit on existing depletion ledger row. |
| **10** | **Branch isolation is preserved.** A movement's batch, order, and actor all belong to one branch. | RPC: `is_branch_*` gate + branch-equality assertions; RLS on reads. |

### Additional invariants V14 introduces

| # | Invariant | Enforcement |
|---|-----------|-------------|
| **11** | **The ledger is append-only.** Movements are never updated or deleted; corrections are new compensating rows. | DB: append-only trigger (mirror the `audit_logs_append_only` pattern). |
| **12** | **A collected order depletes exactly the goods it represents** (no partial-silent depletion). Either the full line set depletes atomically, or a shortfall is explicitly recorded. | RPC: single transaction; shortfall is an explicit movement + flag, never a missing row. |
| **13** | **Depletion and the status transition that triggered it are atomic.** No order is `collected` without its depletion attempt committed in the same txn (success *or* recorded shortfall). | RPC: depletion executes inside `transition_order_status`' transaction. |
| **14** | **Cache freshness is provable per batch** at any instant (`balance_after_kg` of the latest movement == `remaining_weight_kg`). | Check: continuous monitor; alert on mismatch. |

---

## 4. Truth boundaries — who may write

Unchanged from the house discipline, extended to the new events:

- **All inventory writes go through `SECURITY DEFINER` RPCs.** No table grants to `anon`/`authenticated` for inventory writes.
- **Sale depletion** is reachable only from `transition_order_status` (`ready→collected`) — itself `authenticated` + branch-staff gated. Public/anon can never deplete.
- **Reversals** are reachable only from the cancellation path (`*→cancelled`) and a manager-gated refund path.
- **Counts/adjustments/waste** remain manager-gated (`is_branch_manager`).
- **The ledger append-only trigger** means even a buggy future RPC cannot rewrite history — it can only append.

---

## 5. Reconstruction procedure (Invariant 4, concretely)

For any batch `b`:
```
reconstructed_remaining(b) =
      received_weight_kg(b)
    + Σ delta_kg  WHERE batch_id=b AND source_event IN (intake-corrections, count-up, reversal-in)
    − Σ |delta_kg| WHERE batch_id=b AND source_event IN (sale, waste, count-down, manual-down, recall)
```
With signed `delta_kg` this collapses to:
```
reconstructed_remaining(b) = received_weight_kg(b) + Σ delta_kg(b)      [excluding the RECEIVED row itself]
                           = balance_after_kg of the latest movement of b
```
Invariant 14 asserts this equals `remaining_weight_kg(b)`. The nightly reconciliation job runs this for every active batch and raises a `security_event` audit on any mismatch. Because backups + recovery are certified (V13.4), a detected divergence is *recoverable*, not catastrophic — but the design goal is that it never occurs from a single-writer transaction.

---

## 6. Why not full event-sourcing / why not a separate ledger DB

- **Full event-sourcing** (no cache; compute on read) was rejected for read-path cost and availability coupling (§1).
- **A dedicated ledger service / outbox** adds a distributed-systems failure surface (dual-write, eventual consistency) that this single-Postgres, RLS-governed system does not need. Postgres transactions give us atomic ledger+cache for free. Introducing eventual consistency here would *create* the very drift V14 exists to prevent.
- The chosen model — **transactional ledger + verifiable cache, all in one Postgres transaction under one row lock** — is the lowest-risk way to get reconstructable truth in this architecture.
