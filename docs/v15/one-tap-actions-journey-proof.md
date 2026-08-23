# Owner decision → action hand-off — Journey Proof

Generated: 2026-08-22T20:22:04.602Z
App: http://127.0.0.1:3001 · operator: owner@ptm.test

A real start-of-day journey against the running app on live data. Screenshot in
`./screens/decision-first.png`.

## TODAY's primary actions and their decision pages

- **Check Chicken Breast Fillets now** → `/admin/today/action-stock-chicken-breast-fillets--5`
- **Expired Cert Meats certificate is expired** → `/admin/today/action-compliance-expired-cert-meats-expired`
- **Verification Pending Foods certificate needs renewal** → `/admin/today/action-compliance-verification-pending-foods-missing`

## Journey checks

- PASS: operator signs in — http://127.0.0.1:3001/admin/today
- PASS: every Do-now action opens a decision page first — Check Chicken Breast Fillets now → /admin/today/action-stock-chicken-breast-fillets--5 | Expired Cert Meats certificate is expired → /admin/today/action-compliance-expired-cert-meats-expired | Verification Pending Foods certificate needs renewal → /admin/today/action-compliance-verification-pending-foods-missing
- PASS: decision page explains problem, impact and recommendation — /admin/today/action-stock-chicken-breast-fillets--5
- PASS: supporting evidence is collapsed by default — collapsed
- PASS: recommended action points to a known work screen — /admin/stock-count · context=true
- PASS: work screen preserves the Today context — headline: Fix
- PASS: action context survives a refresh — context still present
- PASS: Browser Back returns to the decision — http://127.0.0.1:3001/admin/today/action-stock-chicken-breast-fillets--5
- PASS: Not now returns to Today — http://127.0.0.1:3001/admin/today
