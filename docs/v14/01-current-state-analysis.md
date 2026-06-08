# V14.0 — 01 · Current-State Analysis

Grounded in the actual schema and RPCs as of `main @ b23344b`. Every claim below cites the migration it comes from. This is the reality V14 must extend without regressing.

---

## 1. The tables that exist today

### `inventory_batches` — *the de-facto stock truth*
Defined in [`202605300001_v2_phase_a_backbone.sql`](../../supabase/migrations/202605300001_v2_phase_a_backbone.sql); extended by V6.5/V6.6.

Key columns:
- `received_weight_kg numeric(8,3)  CHECK (>= 0)` — what arrived.
- `remaining_weight_kg numeric(8,3) CHECK (>= 0)` — **current stock; this is the number everything reads.**
- `expected_weight_kg`, `actual_weight_kg`, `actual_confirmed_at/by`, `actual_review_note` — V6.6 "inventory reality" (estimate vs. confirmed actual at intake).
- `cost_per_kg`, `invoice_cost` — costing.
- `expiry_date`, `received_date`, `slaughter_date` — **expiry is present and trustworthy → FEFO is feasible.**
- `halal_cert_ref`, `country_of_origin`, `batch_number`, `supplier_id`, `storage_location` — **per-batch traceability/compliance.**
- `intake_idempotency_key` (V6.5) with partial unique index `(branch_id, intake_idempotency_key)`.
- `status text CHECK (status IN ('active','depleted','disposed','recalled'))`.

`status` already models depletion (`depleted`) and recall (`recalled`).

### `inventory_movements` — *a parallel log, NOT the source of truth*
Same migration. Columns:
```
batch_id, branch_id,
movement_type text CHECK IN ('RECEIVED','SALE','WASTE','TRANSFER','ADJUSTMENT'),
quantity_kg numeric(8,3) CHECK (> 0),    -- always positive
reference_id uuid,                        -- generic FK slot, currently unused for orders
reason text,
created_by uuid,
created_at timestamptz
```
**Three facts that matter enormously for V14:**
1. **`SALE` is already a valid movement_type — but no code ever emits it.** Sales do not move stock today. (Confirms the V13.2 "intake/count based" label.)
2. **`quantity_kg` is constrained `> 0`; direction lives in `movement_type`.** An `ADJUSTMENT` therefore cannot encode whether stock rose or fell — see Defect 1 below.
3. **There is no idempotency key and no `before`/`after` columns on movements.** Retry-safety and reconstruction both depend on adding these.

### `stock_levels` (view)
```sql
SELECT product_id, branch_id, sum(remaining_weight_kg) AS total_kg, ...
FROM inventory_batches WHERE status='active' GROUP BY product_id, branch_id;
```
Confirms `remaining_weight_kg` is the read-path truth; movements are not consulted.

### `stock_count_lines` + `ops_checklist_sessions`
Defined in [`202606041700_v10_phase2_guided_capture.sql`](../../supabase/migrations/202606041700_v10_phase2_guided_capture.sql).
- A count line snapshots `system_weight_kg` (truth at count time) and `counted_weight_kg`, with `applied_at` and `correction_movement_id`.
- Unique `(session_id, batch_id)` → one evidence line per batch per count.
- One active session per `(branch_id, kind, business_date)` via partial unique index.

### `orders`, `order_items`, `order_status_events`
Defined in [`202605290001_init.sql`](../../supabase/migrations/202605290001_init.sql).
- `orders.status CHECK IN ('incoming','prepping','ready','collected','cancelled')`.
- `order_items`: `product_id`, `product_name_snapshot`, `quantity numeric(10,3)`, `unit_type`, `unit_price_snapshot`, `line_total`. **No `batch_id`. No link to inventory at all.**
- `products.unit_type CHECK IN ('kg','each','box')`. **Inventory is kg-only; orders can be priced per each/box.** ← unit-conversion gap.

### `audit_logs` / `audit_events`
- Append-only (triggers), **no client writes** after V11.2 ([`202606051400_v11_2_audit_authenticity.sql`](../../supabase/migrations/202606051400_v11_2_audit_authenticity.sql)).
- The sanctioned emitter `emit_audit_log(...)` validates actor, branch scope, and an **event-type allowlist**, strips secret-like metadata keys, caps metadata size, defaults `created_at` server-side.
- The allowlist already contains `batch_received`, `stock_added`, `stock_corrected`, `stock_count_recorded`, `stock_count_line_applied`, `waste_recorded`, `order_created`, `order_status_changed` — **but nothing for sale-depletion or reversal.** V14 must extend the allowlist.

---

## 2. The RPCs that move stock today

All are `SECURITY DEFINER`, branch-scoped via `is_branch_manager`, and emit both an `inventory_movements` row and an `audit_logs` row.

| RPC | Migration | Movement | Lock | Idempotency |
|-----|-----------|----------|------|-------------|
| `admin_create_inventory_batch` | V2.1 → V6.5 → V6.6 | `RECEIVED` | insert (none needed) | `intake_idempotency_key` unique index + payload-equality check |
| `admin_adjust_inventory_remaining` | V6.6 | `ADJUSTMENT` (abs delta) | `FOR UPDATE` on batch | none (not retry-safe) |
| `admin_record_inventory_waste` | V2.1 | `WASTE` | `FOR UPDATE` on batch | none |
| `ops_apply_stock_count_line` | V10 → V12.5 | routes through `admin_adjust_inventory_remaining` | `FOR UPDATE` on line **and** batch | `applied_at` short-circuit + `STALE_STOCK_COUNT` CAS guard |

`ops_apply_stock_count_line` is the **template V14 should imitate**: it locks, it short-circuits if already applied (idempotent), and it *refuses* to apply if `batch.remaining_weight_kg <> line.system_weight_kg` (a compare-and-set freshness guard — rejects lost updates). It also creates a *reconciliation movement* rather than overwriting history.

---

## 3. The checkout path (where a future reservation would attach)

[`202606071000_v12_3_checkout_integrity.sql`](../../supabase/migrations/202606071000_v12_3_checkout_integrity.sql):
- `create_checkout_order` is **`service_role` only** (V12.1 authority seal) — the public site cannot call it directly with elevated rights.
- Idempotent: `idempotency_key` unique + `idempotency_fingerprint` (same key + different payload is rejected).
- Capacity overbooking is prevented by `SELECT … FOR UPDATE` on the `pickup_windows` row — **the proven anti-TOCTOU pattern in this codebase.**
- It writes `orders`, `order_items`, an `order_status_events` `'incoming'` row, and an `order_created` audit. **It does not touch inventory.**

This matters: if V14 ever adds reservation-at-create, it attaches here, inside an already-idempotent, already-locked, service-role-only transaction.

---

## 4. State transition authority

`transition_order_status` ([V11.2 re-route](../../supabase/migrations/202606051400_v11_2_audit_authenticity.sql)):
- Locks the order `FOR UPDATE`.
- Enforces the legal transition graph: `incoming→{prepping,cancelled}`, `prepping→{ready,cancelled}`, `ready→{collected,cancelled}`.
- Branch-scoped by RLS + `is_branch_staff`.
- Emits `order_status_changed` via `emit_audit_log`.

**This is exactly where `ORDER_COLLECTED` depletion and cancellation reversal will hook in** (see [03](03-stock-movement-model.md), [05](05-reversal-model.md)). The lock and transition-legality checks already exist; V14 adds inventory effects *inside the same transaction*.

---

## 5. Two pre-existing defects V14 inherits and must fix

### Defect 1 — Adjustment sign is unrecoverable (breaks Invariant 4)
`admin_adjust_inventory_remaining` records `quantity_kg = abs(v_delta)` with `movement_type='ADJUSTMENT'`. Given only the movements ledger, a +1.5kg correction and a −1.5kg correction are **identical rows**. You therefore *cannot* reconstruct `remaining_weight_kg` from history. The audit row carries `from_kg`/`to_kg` in metadata, but the *movement* (the thing meant to be the ledger) does not. V14 must add a signed delta and/or `before_kg`+`after_kg` to movements.

### Defect 2 — `remaining_weight_kg` is the truth; movements are a side-effect
Every mutator updates the batch row first and appends a movement second. The two are not guaranteed consistent (no reconstruction check exists). The moment sales start depleting stock at volume, any divergence becomes silent and cumulative. V14 must make the ledger authoritative and the batch value a *verifiable cache*.

---

## 6. What is genuinely good and must be preserved

- **`SECURITY DEFINER` + branch-gate + RLS-read-only** is the consistent write discipline. V14 stays inside it.
- **Pessimistic `FOR UPDATE`** is the house concurrency style and it works.
- **Append-only, fail-closed, allowlisted audit** is strong; V14 extends the allowlist, doesn't weaken the boundary.
- **Idempotency by unique key + payload equality** (intake) and **CAS freshness guard** (stock count) are exactly the primitives the depletion engine needs.
- **Per-batch halal/origin/expiry** means traceability is already capturable at depletion time — a competitive and regulatory asset.

V14's job is to compose these existing, proven primitives into a sales-depletion engine — not to invent new mechanisms.
