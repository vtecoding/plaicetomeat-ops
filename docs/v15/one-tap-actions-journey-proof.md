# V15.2 · One-Tap Action Layer — Operator-Journey Proof

Generated: 2026-06-30T18:29:46.428Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real start-of-day journey against the running app on live data. Screenshot in
`./screens/one-tap-destination.png`.

## TODAY's primary actions and where one tap takes the operator

- **Verification Pending Foods certificate needs renewal** → `/admin/compliance` (one tap to the work)
- **Sell Probe kg probe-kg-24mexpz4 first** → `/admin/inventory` (one tap to the work)
- **Sell Probe kg probe-kg-g9smbxt5 first** → `/admin/inventory` (one tap to the work)

## Journey checks

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: Do-now actions link straight to the work (one tap, with focus context) — 3/3 carry from=today: Verification Pending Foods certificate needs renewal → /admin/compliance | Sell Probe kg probe-kg-24mexpz4 first → /admin/inventory | Sell Probe kg probe-kg-g9smbxt5 first → /admin/inventory
- PASS: no action opens the wrong destination — all land on known work routes
- PASS: destination shows the 'From Today' action context, naming the item — headline: Fix
- PASS: destination offers an explicit Back-to-Today return — /admin/compliance
- PASS: action context survives a refresh — banner still present after reload
- PASS: completion path returns to TODAY — http://127.0.0.1:3001/admin/today
