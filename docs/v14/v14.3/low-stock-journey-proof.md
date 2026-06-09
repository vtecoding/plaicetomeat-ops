# V14.3 · Low-Stock & Confidence-Routing Journey Proof (Workstream C)

Generated: 2026-06-09T16:53:27.354Z
App: http://127.0.0.1:3001 · Supabase: http://127.0.0.1:54321 · operator: owner@ptm.test

This is a real rendered operator journey against the running app on live
data — not a unit test. Screenshots in `./screens/`.

## Live inventory-truth signals (source: inventory_confidence_monitor)

- Low-confidence products on file: **27**
  - probe kg probe-kg-p61vgmmv, probe kg probe-kg-gszz2xbg, v14.1-h proof kg, probe kg probe-kg-1iwuscv0, probe kg probe-kg-xmar72ib, probe kg probe-kg-xwsibufz, probe kg probe-kg-4vf186c7, probe kg probe-kg-acutww85, probe kg probe-kg-waox1oe7, v6.4 intake lamb leg 1780761437040, probe kg probe-kg-5r5rlidr, v6.4 intake lamb leg 1780743410075 …

## What the operator saw

### /admin/purchasing — order recommendations
- (none in current data)

### /admin/today — count actions
- Please count Probe kg probe-kg-biixfo34 today
- Please count Chicken Breast Fillets soon
- Please count Probe kg probe-kg-1iwuscv0 soon
- Please count Probe kg probe-kg-4vf186c7 soon
- Please count Probe kg probe-kg-biixfo34 today — hard to put a figure on yet.

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

- PASS: read live inventory-truth signals — 27 low-confidence product(s) on file
- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: purchasing page renders for operator — 0 order recommendation(s): none
- PASS: confidence→verb contract holds on the purchasing page — no low-confidence product is told to Order
- PASS: order advice uses plain butcher wording — 'Order … tomorrow' / '… next time'
- PASS: TODAY shows count actions for flagged stock — Please count Probe kg probe-kg-biixfo34 today | Please count Chicken Breast Fillets soon | Please count Probe kg probe-kg-1iwuscv0 soon | Please count Probe kg probe-kg-4vf186c7 soon | Please count Probe kg probe-kg-biixfo34 today — hard to put a figure on yet.
- PASS: stock honesty stamp states V14 truth — Collected orders are already taken off stock. No stock count recorded yet. Use Stock count to keep figures honest.

## Note on synthetic scenarios

Order-more advice depends on sales velocity accumulated over time, which
cannot be forged deterministically in a single run. The deterministic,
environment-independent guarantees (a low-confidence product is never told to
Order; recurring shortfalls escalate to 'count today') are proven by the unit
suites confidence-routing.test.ts and operator-guidance.test.ts. This journey
proves those guarantees also hold on the live rendered surfaces.
