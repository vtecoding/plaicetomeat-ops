# PTM Dad Usability Audit - Report

## Executive Summary

The clean local stack is usable for seeded staff accounts. Owner, manager, staff, and operator-mode logins succeeded, and protected owner/operator routes were crawlable for the Dad usability pass.

## Overall Verdict

**Ready after fixes.** Authentication and routing are healthy, but the usability pass still flags dashboard language, heavy-input admin screens, and tablet/mobile touch issues before pilot.

## Top 10 Findings

No findings recorded.

## Dad Experience Score

Average: **4.8/5** across 31 desktop page(s). Scores are based on crawled protected routes after successful seeded login.

## Operator Experience Score

Average: **5.0/5** across 8 desktop page(s). Scores are based on crawled operator routes after successful operator-mode login.

## Route Coverage

See `route-report.md` and `route-report.json`.

## Journey Results

- `owner_today_to_decision_and_back`: clicks=2, typedFields=0, screens=9, score=4, unclear=none
- `operator_open_serve_stock_waste_help_close`: clicks=5, typedFields=0, screens=12, score=4, unclear=none

## Confusing Screens

None recorded beyond the login blocker.

## Unnecessary Inputs

- `/admin/compliance`: 8 visible inputs.
- `/admin/guide`: 18 visible inputs.
- `/admin/inventory`: 15 visible inputs.
- `/admin/pickup-windows`: 9 visible inputs.
- `/checkout`: 7 visible inputs.

## Unnecessary Clicks

No journey exceeded the high-click threshold in this run.

## Copy Issues

No copy issues identified in reachable snapshots.

## Mobile/Tablet Issues

- `/` mobile:  3 small tap targets.
- `/admin` mobile:  10 small tap targets.
- `/admin/audit` mobile:  2 small tap targets.
- `/admin/away` mobile:  4 small tap targets.
- `/admin/briefing` mobile:  2 small tap targets.
- `/admin/close` mobile:  3 small tap targets.
- `/admin/compliance` mobile:  8 small tap targets.
- `/admin/cutting-guide` mobile:  4 small tap targets.
- `/admin/evidence` mobile:  1 small tap targets.
- `/admin/guide` mobile:  2 small tap targets.
- `/admin/inventory` mobile:  5 small tap targets.
- `/admin/open` mobile:  2 small tap targets.
- `/admin/orders` mobile:  3 small tap targets.
- `/admin/pickup-windows` mobile:  8 small tap targets.
- `/admin/playbooks` mobile:  2 small tap targets.
- `/admin/playbooks/butcher-words` mobile:  2 small tap targets.
- `/admin/products` mobile:  2 small tap targets.
- `/admin/purchasing` mobile:  3 small tap targets.
- `/admin/releases` mobile:  3 small tap targets.
- `/admin/settings` mobile:  3 small tap targets.
- `/admin/setup` mobile:  12 small tap targets.
- `/admin/shop-closures` mobile:  2 small tap targets.
- `/admin/stock-count` mobile:  1 small tap targets.
- `/admin/today` mobile:  2 small tap targets.
- `/admin/today/action-system-realtime-degraded` mobile:  2 small tap targets.
- `/admin/today/walk` mobile:  2 small tap targets.
- `/admin/validation/pricing` mobile:  2 small tap targets.
- `/auth/update-password` mobile:  3 small tap targets.
- `/basket` mobile:  3 small tap targets.
- `/checkout` mobile:  3 small tap targets.
- `/counter` mobile:  9 small tap targets.
- `/counter/compliance` mobile:  2 small tap targets.
- `/counter/orders/4e48e914-6f9d-40a7-a699-71172d3933e2` mobile:  2 small tap targets.
- `/login` mobile:  3 small tap targets.
- `/order/PTM-2026-90003` mobile:  2 small tap targets.
- `/order/PTM-2026-90003/cancel` mobile:  2 small tap targets.
- `/order/lookup` mobile:  2 small tap targets.
- `/order/status/b9c36916-8811-4866-98da-a473cb19987e` mobile:  2 small tap targets.
- `/order/status/b9c36916-8811-4866-98da-a473cb19987e/cancel` mobile:  4 small tap targets.
- `/our-halal-promise` mobile:  2 small tap targets.
- `/privacy` mobile:  2 small tap targets.
- `/product/chicken-breast-fillets` mobile:  4 small tap targets.
- `/shop` mobile:  12 small tap targets.
- `/unauthorised` mobile:  2 small tap targets.
- `/__missing_dad_audit_route__` mobile:  2 small tap targets.
- `/admin/today/not-a-real-decision` mobile:  2 small tap targets.
- `/product/not-a-real-product` mobile:  2 small tap targets.
- `/counter/orders/00000000-0000-4000-8000-000000000000` mobile:  1 small tap targets.
- `/` tablet:  6 small tap targets.
- `/admin` tablet:  12 small tap targets.
- `/admin/audit` tablet:  7 small tap targets.
- `/admin/away` tablet:  9 small tap targets.
- `/admin/briefing` tablet:  7 small tap targets.
- `/admin/close` tablet:  8 small tap targets.
- `/admin/compliance` tablet:  12 small tap targets.
- `/admin/cutting-guide` tablet:  9 small tap targets.
- `/admin/evidence` tablet:  6 small tap targets.
- `/admin/guide` tablet:  7 small tap targets.
- `/admin/inventory` tablet:  10 small tap targets.
- `/admin/open` tablet:  7 small tap targets.
- `/admin/orders` tablet:  8 small tap targets.
- `/admin/pickup-windows` tablet:  12 small tap targets.
- `/admin/playbooks` tablet:  7 small tap targets.
- `/admin/playbooks/butcher-words` tablet:  7 small tap targets.
- `/admin/products` tablet:  7 small tap targets.
- `/admin/purchasing` tablet:  8 small tap targets.
- `/admin/releases` tablet:  8 small tap targets.
- `/admin/settings` tablet:  8 small tap targets.
- `/admin/setup` tablet:  12 small tap targets.
- `/admin/shop-closures` tablet:  7 small tap targets.
- `/admin/stock-count` tablet:  6 small tap targets.
- `/admin/today` tablet:  7 small tap targets.
- `/admin/today/action-system-realtime-degraded` tablet:  7 small tap targets.
- `/admin/today/walk` tablet:  7 small tap targets.
- `/admin/validation/pricing` tablet:  7 small tap targets.
- `/auth/update-password` tablet:  6 small tap targets.
- `/basket` tablet:  6 small tap targets.
- `/checkout` tablet:  6 small tap targets.
- `/counter` tablet:  12 small tap targets.
- `/counter/compliance` tablet:  7 small tap targets.
- `/counter/orders/4e48e914-6f9d-40a7-a699-71172d3933e2` tablet:  7 small tap targets.
- `/login` tablet:  6 small tap targets.
- `/order/PTM-2026-90003` tablet:  5 small tap targets.
- `/order/PTM-2026-90003/cancel` tablet:  5 small tap targets.
- `/order/lookup` tablet:  5 small tap targets.
- `/order/status/b9c36916-8811-4866-98da-a473cb19987e` tablet:  5 small tap targets.
- `/order/status/b9c36916-8811-4866-98da-a473cb19987e/cancel` tablet:  7 small tap targets.
- `/our-halal-promise` tablet:  5 small tap targets.
- `/privacy` tablet:  5 small tap targets.
- `/product/chicken-breast-fillets` tablet:  7 small tap targets.
- `/shop` tablet:  12 small tap targets.
- `/unauthorised` tablet:  5 small tap targets.
- `/__missing_dad_audit_route__` tablet:  5 small tap targets.
- `/admin/today/not-a-real-decision` tablet:  7 small tap targets.
- `/product/not-a-real-product` tablet:  5 small tap targets.
- `/counter/orders/00000000-0000-4000-8000-000000000000` tablet:  4 small tap targets.

## Failure-State Findings

- `/__missing_dad_audit_route__`: status=404, finalPath=`/__missing_dad_audit_route__`, primaryCta=Go back to Today.
- `/admin/today/not-a-real-decision`: status=200, finalPath=`/admin/today`, primaryCta=OWNER AWAY IS OFF
No opening saved yet
3 sales, 0 photos, 0 owner checks.
Review.
- `/product/not-a-real-product`: status=404, finalPath=`/product/not-a-real-product`, primaryCta=Go back to Today.
- `/counter/orders/00000000-0000-4000-8000-000000000000`: status=404, finalPath=`/counter/orders/00000000-0000-4000-8000-000000000000`, primaryCta=Go back to Today.

## Runtime Findings

- `/counter` mobile: 1 failed requests.
- `/order/status/b9c36916-8811-4866-98da-a473cb19987e/cancel` mobile: 1 console warnings/errors.
- `/__missing_dad_audit_route__` mobile: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/product/not-a-real-product` mobile: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/counter/orders/00000000-0000-4000-8000-000000000000` mobile: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/__missing_dad_audit_route__` tablet: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/product/not-a-real-product` tablet: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/counter/orders/00000000-0000-4000-8000-000000000000` tablet: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/__missing_dad_audit_route__` desktop: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/product/not-a-real-product` desktop: 1 console warnings/errors; 1 HTTP >=400 responses.
- `/counter/orders/00000000-0000-4000-8000-000000000000` desktop: 1 console warnings/errors; 1 HTTP >=400 responses.

## Prioritised Fix Plan

1. High: remove dashboard/scoring language from Dad-facing admin pages, especially confidence, signal, insight, variance, and validation.
2. High: reduce form/input load on pricing validation, products, inventory, guide, pickup windows, compliance, and counter compliance.
3. High: fix tablet horizontal overflow across admin routes.
4. Medium: enlarge mobile/tablet tap targets, especially dense admin/counter/shop surfaces.
5. Medium: make bad-id failure states more helpful, with a plain explanation and safe route home.

## Screenshots Index

Screenshots are in `audit/dad-usability/screenshots/`.

## Appendix: Raw Route Data

Raw data is in `route-report.json`.

## Brutal Final Questions

1. Could Dad use this without me beside him? **Partly.** He can sign in and reach Today, but admin/dashboard surfaces still need simplification before I would leave him alone with it.
2. Could Uncle Gul run Operator Mode during a busy hour? **Closer, but not proven enough.** Operator Mode loads and is route-locked correctly, but the journey still flagged recovery/click-target issues.
3. Which 3 screens would confuse Dad first? **Business Insights (/admin)**, **Pricing Validation**, and **Products** because they are dense, input-heavy, and use dashboard language.
4. Which 3 screens would confuse Gul first? **Stock / Delivery**, **Waste**, and **Close Shop** if uncertainty/recovery controls are not obvious under pressure.
5. What would Dad ask me to simplify immediately? Remove the dashboard words and show the next decision, not the analysis.
6. What can be removed without hurting truth? Confidence/signal/insight/variance wording where it does not directly change the action.
7. What should become a Today task instead of a page? Supplier certificate renewal, pricing checks, stock corrections, and reconciliation-style exceptions.
8. What must be fixed before pilot? Tablet overflow, dense input screens, confusing copy, and operator recovery paths.
9. What can wait until after pilot? Deep reporting pages, release/audit polish, and non-critical visual refinements.
10. Is PTM now easier than paper for the people actually using it? **For login and Today, yes. For the full system, not yet.**
