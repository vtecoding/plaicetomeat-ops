# V15.2 · One-Tap Action Layer — Operator-Journey Proof

Generated: 2026-06-10T13:39:14.571Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real start-of-day journey against the running app on live data. Screenshot in
`./screens/one-tap-destination.png`.

## TODAY's primary actions and where one tap takes the operator

- **Probe kg probe-kg-biixfo34 is costing money** → `/admin/today/action-waste-probe-kg-probe-kg-biixfo34-reduce-order` (review)
- **Expired Cert Meats certificate is expired** → `/admin/compliance` (one tap to the work)
- **Verification Pending Foods certificate needs renewal** → `/admin/compliance` (one tap to the work)

## Journey checks

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: Do-now actions link straight to the work (one tap, with focus context) — 2/3 carry from=today: Probe kg probe-kg-biixfo34 is costing money → /admin/today/action-waste-probe-kg-probe-kg-biixfo34-reduce-order | Expired Cert Meats certificate is expired → /admin/compliance | Verification Pending Foods certificate needs renewal → /admin/compliance
- PASS: no action opens the wrong destination — all land on known work routes
- PASS: destination shows the 'From Today' action context, naming the item — headline: Fix
- PASS: destination offers an explicit Back-to-Today return — /admin/compliance
- PASS: action context survives a refresh — banner still present after reload
- PASS: completion path returns to TODAY — http://127.0.0.1:3001/admin/today
