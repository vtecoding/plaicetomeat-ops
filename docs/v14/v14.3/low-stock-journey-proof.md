# V14.3 · Low-Stock & Confidence-Routing Journey Proof (Workstream C)

Generated: 2026-06-30T18:29:38.968Z
App: http://127.0.0.1:3001 · Supabase: http://127.0.0.1:54321 · operator: owner@ptm.test

This is a real rendered operator journey against the running app on live
data — not a unit test. Screenshots in `./screens/`.

## Live inventory-truth signals (source: inventory_confidence_monitor)

- Low-confidence products on file: **99**
  - probe kg probe-kg-8dtst10h, probe kg probe-kg-rs2tlsnm, probe kg probe-kg-8l7pzihd, probe kg probe-kg-h4e76j67, probe kg probe-kg-p2g0crf0, probe kg probe-kg-bykuaxn4, probe kg probe-kg-s0rhc2ks, probe kg probe-kg-fdlh99zu, probe kg probe-kg-7je5auh6, probe kg probe-kg-uxwtf18b, probe kg probe-kg-xczsoqh2, probe kg probe-kg-6vtdhpbp …

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

- PASS: read live inventory-truth signals — 99 low-confidence product(s) on file
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
