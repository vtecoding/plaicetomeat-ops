# V15 · Action Compression — Operator-Journey Proof

Generated: 2026-07-09T23:41:41.482Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real rendered operator journey against the running app on live data — not a
unit test. Screenshot in `./screens/today-compressed.png`.

## What the operator saw on /admin/today

- **Before compression** (all candidate actions): **15**
- **After compression** (Do now, the primary surface): **3** (cap 3)
- **Held in Later** (preserved, hidden by default): **12**

### Top three (Do now)
1. Check Chicken Breast Fillets now
1. Check V6.4 Intake Lamb Leg 1782913405834 now
1. Check V6.4 Intake Lamb Leg 1782913606617 now

## Control proofs

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: TODAY shows at most three Do-now actions — Do now = 3: Check Chicken Breast Fillets now | Check V6.4 Intake Lamb Leg 1782913405834 now | Check V6.4 Intake Lamb Leg 1782913606617 now
- PASS: non-winning actions are preserved in Later — Later = 12
- PASS: no score/confidence/ranking language is shown — clean
