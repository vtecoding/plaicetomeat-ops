# V15 · Action Compression — Operator-Journey Proof

Generated: 2026-06-30T18:29:41.009Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real rendered operator journey against the running app on live data — not a
unit test. Screenshot in `./screens/today-compressed.png`.

## What the operator saw on /admin/today

- **Before compression** (all candidate actions): **19**
- **After compression** (Do now, the primary surface): **3** (cap 3)
- **Held in Later** (preserved, hidden by default): **16**

### Top three (Do now)
1. Verification Pending Foods certificate needs renewal
1. Sell Probe kg probe-kg-24mexpz4 first
1. Sell Probe kg probe-kg-g9smbxt5 first

## Control proofs

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: TODAY shows at most three Do-now actions — Do now = 3: Verification Pending Foods certificate needs renewal | Sell Probe kg probe-kg-24mexpz4 first | Sell Probe kg probe-kg-g9smbxt5 first
- PASS: non-winning actions are preserved in Later — Later = 16
- PASS: no score/confidence/ranking language is shown — clean
