# V15.1 · TODAY Operating System — Operator-Journey Proof

Generated: 2026-06-30T18:29:42.965Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test · viewport: 1366×1000

A real start-of-day journey against the running app. Screenshot in
`./screens/today-operating-system.png`.

## What the operator saw on /admin/today

- **Primary actions (Do now):** 3 (cap 3)
- **All priorities above the fold (no scrolling):** yes

### The three things to do now
1. Verification Pending Foods certificate needs renewal
2. Sell Probe kg probe-kg-24mexpz4 first
3. Sell Probe kg probe-kg-g9smbxt5 first

## Operating-system checks

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: Do Now is above the fold — all priorities visible without scrolling — zone top=512px bottom=984px (viewport 1000px)
- PASS: at most three primary actions render — Do now = 3: Verification Pending Foods certificate needs renewal | Sell Probe kg probe-kg-24mexpz4 first | Sell Probe kg probe-kg-g9smbxt5 first
- PASS: the 'How the shop is doing' status panel is retired — shop-status not present
- PASS: weekly summary never outranks actions (below Do Now, collapsed) — present=true below=true collapsed=true
- PASS: Later is collapsed by default and below Do Now — present=true collapsed=true below=true
- PASS: no score/confidence/ranking language is shown — clean
