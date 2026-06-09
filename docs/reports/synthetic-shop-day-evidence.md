# Synthetic Shop-Day Evidence Pack

Generated: 2026-06-08T23:05:36.850Z
Run id: `synthetic-shop-day-20260608230536`
Environment: local Supabase at `http://127.0.0.1:54321`

## What This Proves

This was not just mock rows inserted into tables. The drill used the same core boundaries as the application: checkout RPC, staff status-transition RPC, inventory waste RPC, ops checklist RPCs, RLS/authenticated staff sessions, and audit/event tables.

It does not prove market demand or real human handling speed. It proves PTM can already turn shop activity into structured operational evidence.

## Headline Numbers

- Orders created through checkout authority path: **7**
- Synthetic order value processed: **GBP 125.01**
- Order item rows snapshotted: **8**
- Orders moved all the way to collected: **5**
- Counter/status event rows written: **22**
- Stock moved from collected kg orders: **6.000kg**
- Depletion summary rows: **5**
- Waste events recorded: **1**
- Waste value surfaced from cost data: **GBP 2.00**
- Opening checklist evidence events: **5**
- Audit rows written during the drill: **36**
- Audit rows directly tied to synthetic orders: **27**
- Drill wall-clock runtime: **0.5s**

## Control Proofs

- PASS: manager test identity signs in — signed in
- PASS: staff test identity signs in — signed in
- PASS: baseline stock batch is readable — id=00000000-0000-4000-8000-000000000601
- PASS: six customer orders created through checkout RPC — 6 orders
- PASS: checkout idempotency returns same order for same key/payload — PTM-2026-00141
- PASS: forged client price is ignored by checkout RPC — stored GBP 12.50, not supplied fake price
- PASS: invalid checkout is rejected before mutation — empty basket rejected with no order row
- PASS: staff moves orders through counter lifecycle — 5 collected orders
- PASS: invalid counter transition is refused — incoming -> collected blocked
- PASS: collected kg orders create stock movements — 5 movement row(s), 6.000kg
- PASS: each collected order has one depletion summary — 5 row(s)
- PASS: manager records waste through inventory RPC — bc7db24e-76c5-48db-a5a3-8af41d719eef
- PASS: opening checklist captures required evidence — 9f99609c-82a4-48b2-88dc-b1bc5bc2e806
- PASS: incomplete checklist cannot be completed — closing completion refused until evidence exists
- PASS: stock batch remains non-negative after sales+waste — id=00000000-0000-4000-8000-000000000601

## Stock Evidence

- Seed batch before: **18.500kg**
- Seed batch after: **12.100kg**
- Movement model: collected kg products write `SALE_COLLECT` inventory movements; each/box products are explicitly counted manually in this V14.1 slice.

## Founder-Ready Interpretation

> We ran a synthetic shop day through PTM using realistic orders, staff counter actions, stock movement, waste capture, checklist evidence, and audit trails. The important result is not that the database accepted mock data; it is that the system converted shop behaviour into measurable evidence: orders, status events, stock movements, waste value, compliance evidence, and audit history.
>
> This is the bridge from architecture to business value. Once real customers arrive, the same evidence model can answer whether PTM reduces mistakes, keeps inventory closer to truth, saves management time, and reduces waste versus the manual baseline.

## Caveats

- This is a local synthetic drill, not production traffic.
- Human handling time is not simulated; order processing speed still needs a real counter pilot.
- Revenue/waste numbers are based on seeded product and cost data.
- Production claims should wait for migration parity and live shop data.
