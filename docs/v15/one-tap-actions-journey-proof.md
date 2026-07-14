# V15.2 · One-Tap Action Layer — Operator-Journey Proof

Generated: 2026-07-14T12:30:54.494Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real start-of-day journey against the running app on live data. Screenshot in
`./screens/one-tap-destination.png`.

## TODAY's primary actions and where one tap takes the operator

- **Chicken Breast Fillets is costing money** → `/admin/today/action-waste-chicken-breast-fillets-reduce-order` (review)
- **Check Chicken Breast Fillets now** → `/admin/stock-count` (one tap to the work)
- **Check V6.4 Intake Lamb Leg 1782913606617 now** → `/admin/stock-count` (one tap to the work)

## Journey checks

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: Do-now actions link straight to the work (one tap, with focus context) — 2/3 carry from=today: Chicken Breast Fillets is costing money → /admin/today/action-waste-chicken-breast-fillets-reduce-order | Check Chicken Breast Fillets now → /admin/stock-count | Check V6.4 Intake Lamb Leg 1782913606617 now → /admin/stock-count
- PASS: no action opens the wrong destination — all land on known work routes
- PASS: destination shows the 'From Today' action context, naming the item — headline: Fix
- PASS: destination offers an explicit Back-to-Today return — /admin/stock-count
- PASS: action context survives a refresh — banner still present after reload
- PASS: completion path returns to TODAY — http://127.0.0.1:3001/admin/today
