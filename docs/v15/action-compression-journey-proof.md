# V15 · Action Compression — Operator-Journey Proof

Generated: 2026-07-14T19:17:31.351Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real rendered operator journey against the running app on live data — not a
unit test. Screenshot in `./screens/today-compressed.png`.

## What the operator saw on /admin/today

- **Before compression** (all candidate actions): **11**
- **After compression** (Do now, the primary surface): **3** (cap 3)
- **Held in Later** (preserved, hidden by default): **8**

### Top three (Do now)
1. V18 catch weight 0fa9d2d3 is costing money
1. Expired Cert Meats certificate is expired
1. Verification Pending Foods certificate needs renewal

## Control proofs

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: TODAY shows at most three Do-now actions — Do now = 3: V18 catch weight 0fa9d2d3 is costing money | Expired Cert Meats certificate is expired | Verification Pending Foods certificate needs renewal
- PASS: non-winning actions are preserved in Later — Later = 8
- PASS: no score/confidence/ranking language is shown — clean
