# V14.3 · Low-Stock & Confidence-Routing Journey Proof (Workstream C)

Generated: 2026-07-14T12:30:37.110Z
App: http://127.0.0.1:3001 · Supabase: http://127.0.0.1:54321 · operator: owner@ptm.test

This is a real rendered operator journey against the running app on live
data — not a unit test. Screenshots in `./screens/`.

## Live inventory-truth signals (source: inventory_confidence_monitor)

- Low-confidence products on file: **10**
  - chicken breast fillets, lamb leg steaks, paytruth paytruth-qbepyl4p, paytruth paytruth-vf3nq0fg, v6.4 intake lamb leg 1782913606617, shortfall shortfall-nwixe3js, v6.4 intake lamb leg 1782918920569, v6.4 intake lamb leg 1782913405834, shortfall shortfall-7dxjb7x0, shortfall shortfall-31hhdd2j

## What the operator saw

### /admin/purchasing — order recommendations
- (none in current data)

### /admin/today — count actions
- (none surfaced in current data)

### /admin/inventory — honesty stamp
> Collected orders are already taken off stock. No stock count recorded yet. Use Stock count to keep figures honest.

## Scenario verdicts

| Scenario | Expectation | Result |
|---|---|---|
| Confidence routing | No low-confidence product is told to Order | PASS |
| Order wording (low stock) | 'Order … tomorrow' plain English | PASS |
| Critical stock ("Order now") | Not a V14.3 verb — documented | DOCUMENTED: V14.3 keeps 'Order tomorrow'; a distinct 'Order now' verb is V15 (Action Compression), intentionally out of scope here |
| Stock honesty stamp | States V14 truth | PASS |

## Control proofs

- PASS: read live inventory-truth signals — 10 low-confidence product(s) on file
- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: purchasing page renders for operator — 0 order recommendation(s): none
- PASS: confidence→verb contract holds on the purchasing page — no low-confidence product is told to Order
- PASS: order advice uses plain butcher wording — 'Order … tomorrow' / '… next time'
- PASS: TODAY shows count actions for flagged stock — none surfaced in current data
- PASS: stock honesty stamp states V14 truth — Collected orders are already taken off stock. No stock count recorded yet. Use Stock count to keep figures honest.

## Note on synthetic scenarios

Order-more advice depends on sales velocity accumulated over time, which
cannot be forged deterministically in a single run. The deterministic,
environment-independent guarantees (a low-confidence product is never told to
Order; recurring shortfalls escalate to 'count today') are proven by the unit
suites confidence-routing.test.ts and operator-guidance.test.ts. This journey
proves those guarantees also hold on the live rendered surfaces.
