# V14.0 — 08 · Audit Model — *Court-defensible inventory evidence*

Inventory movements become financial and food-safety evidence the moment sales deplete stock: they underpin cost-of-goods, valuation, halal-cert traceability, and recall response. The audit model must make every gram of movement **attributable, immutable, and reconstructable**.

The system already has a strong audit substrate; V14 *extends* it, never weakens it.

---

## What already exists (and must not regress)

From [V11.2 audit authenticity](../../supabase/migrations/202606051400_v11_2_audit_authenticity.sql):
- `audit_logs` / `audit_events` are **append-only** (triggers `audit_logs_append_only` / `audit_events_append_only` raise on UPDATE/DELETE).
- **No client may write audit rows** — `INSERT/UPDATE/DELETE/TRUNCATE` revoked from `anon`, `authenticated`, `PUBLIC`. Writes flow only through `SECURITY DEFINER` paths.
- `emit_audit_log(...)` is the sanctioned emitter: derives actor from `auth.uid()` (never a parameter), validates branch scope, enforces an **event-type allowlist**, strips secret-like metadata keys, caps metadata at 8 KB, defaults `created_at` server-side, and supports a fail-closed *system* emission path.

This is exactly the discipline court-defensible evidence requires. V14 plugs into it.

---

## The complete movement evidence model

The spec requires every movement to record: **timestamp, actor, branch, reason, quantity, before value, after value, source event.** Mapping to V14's two-layer model:

### Layer 1 — the ledger row (`inventory_movements`, the operational truth)
Per movement:
| Field | Source | Note |
|-------|--------|------|
| `created_at` | server default | timestamp (Invariant: server-set, not client). |
| `created_by` (actor) | `auth.uid()` | Invariant 3; system actor = NULL + reason. |
| `branch_id` | the batch's branch | Invariant 10. |
| `reason` | required | Invariant 2; ≥4 chars for corrections (already enforced). |
| `delta_kg` (signed) + `quantity_kg` | computed | quantity + direction. |
| `balance_before_kg`, `balance_after_kg` | computed under lock | before/after values. |
| `source_event` | enum | `INTAKE`/`SALE_COLLECT`/`CANCEL_REVERSAL`/`REFUND_REVERSAL`/`WASTE`/`COUNT_RECONCILE`/`MANUAL_ADJUST`/`RECALL`/`TRANSFER`. |
| `order_id` / `reference_id` + `reference_kind` | the causing entity | binds movement to its cause. |
| `batch_id` | the batch | per-batch traceability, carries halal/origin/expiry by join. |
| `idempotency_key` | `(order_id, intent)` | exactly-once (Invariants 5, 6, 9). |

### Layer 2 — the audit log (`audit_logs` via `emit_audit_log`, the tamper-evident mirror)
Each movement also emits an append-only audit row carrying the same facts in `metadata`, so evidence survives even if the operational table is later restructured, and benefits from the append-only + no-client-write guarantees.

**New allowlist entries V14 must add to `emit_audit_log`:**
```
'inventory_depleted_for_order',     -- SALE_COLLECT
'inventory_reversed_for_order',     -- CANCEL_REVERSAL / REFUND_REVERSAL
'inventory_depletion_shortfall',    -- oversell exception (see [09])
'batch_recalled'                    -- recall safety event
```
(The existing `stock_corrected`, `stock_added`, `waste_recorded`, `stock_count_line_applied`, `batch_received` cover the non-sale paths.)

---

## Traceability chains the model must support

The evidence model is judged by the questions it can answer. V14's binding (`movement ↔ batch ↔ order ↔ actor`) must answer:

1. **"Which sale consumed batch B?"** → movements where `batch_id=B AND source_event='SALE_COLLECT'` → `order_id`s.
2. **"Recall: who received product from batch B?"** → from those `order_id`s → customer contact on `orders`. *This is the food-safety payoff:* per-batch depletion makes a halal/contamination recall **actionable down to the customer**, not just "we sold some."
3. **"What is this order's cost-of-goods?"** → `Σ (|delta_kg| × batch.cost_per_kg)` over the order's `SALE_COLLECT` movements (less reversals).
4. **"Reconstruct batch B's full life."** → all movements for `B` in `created_at` order; `balance_after_kg` of the last == `remaining_weight_kg`.
5. **"Was this reversal legitimate?"** → reversal movement references the original `SALE_COLLECT` id + actor + reason.

---

## Immutability & non-repudiation

- **Append-only everywhere:** `audit_logs`/`audit_events` already; V14 adds the **same append-only trigger to `inventory_movements`** (Invariant 11) so the *ledger of record* is itself immutable. Today movements have no such trigger — they are append-only only by convention. Making it a DB guarantee is part of promoting movements to source-of-truth.
- **Actor non-repudiation:** actor is always `auth.uid()` (or an explicit, reasoned system actor). No RPC accepts a caller-supplied actor for an inventory write.
- **No secrets in evidence:** `emit_audit_log` already strips secret-like keys; movement `reason`/metadata must carry business reasons only (no tokens, no public access ids) — same hygiene.

---

## Retention & recovery

- Inventory movements and their audit mirror are **never pruned** within the operational window required for food-safety/tax (retention policy is an operational decision, not architecture — flagged for the owner).
- V13.4 **`BACKUP_CERTIFIED` + `RECOVERY_CERTIFIED`** means the evidence is recoverable after disaster. V14 inherits this: a detected ledger/cache divergence (Invariant 14) is recoverable, and the append-only ledger means point-in-time reconstruction is meaningful.

---

## What makes this "court-defensible"

| Property | How V14 guarantees it |
|----------|----------------------|
| **Complete** | every stock change is a movement (Invariant 2); nothing changes `remaining` out of band. |
| **Attributable** | actor + branch + timestamp on every row, server-set. |
| **Immutable** | append-only DB triggers on both ledger and audit. |
| **Reconstructable** | signed delta + before/after ⇒ `Σ` reproduces any historical balance (Invariant 4). |
| **Tamper-evident** | no client write path; mirror in append-only audit. |
| **Recoverable** | V13.4 certified backups/restore. |
