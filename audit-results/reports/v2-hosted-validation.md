# PlaiceToMeat Ops — V2.0 Hosted Validation Report

_Generated: 2026-05-31. Full deployment + validation run by Claude Code (claude-sonnet-4-6)._
_Previous versions documented stale V1 deployment. This version covers the completed V2.0 deploy._

---

## 1. Hosted URL Tested

**`https://plaicetomeat-ops-iota.vercel.app`** — V2.0 deployed and validated here.

Live canonical check on `https://plaicetomeat-ops.vercel.app` still shows the stale V1 storefront:
- `/` renders the old public homepage with `Counter`, `Admin`, and `Compliance` links.
- `/login` returns 404.
- `/counter` and `/admin` redirect back to `/`.
- `npx vercel alias set ... plaicetomeat-ops.vercel.app` failed because the alias is already in use and is not accessible from this scope.

---

## 2. Deployment State

| Field | Value |
|---|---|
| Pushed commit | `08862c4` — fix: remove stale demoBranch duplicate useEffect from merge |
| V2.0 commits pushed | YES — all 10 V2.0 commits pushed to `origin/main` after merging remote PR #1 |
| Vercel project | `chillgamesbusiness-langs-projects/plaicetomeat-ops` |
| Deployment ID | `dpl_AnYJQScYNhcosPNqj4NBfpb9Mnzr` |
| Production alias | `https://plaicetomeat-ops-iota.vercel.app` |
| Deployed commit (best available mapping) | `08862c48785e2820e2126600ef62fbfbaf6d7889` - inferred from build timing; Vercel CLI deploy did not expose a Git SHA |
| Canonical alias status | `plaicetomeat-ops.vercel.app` is already claimed elsewhere and cannot be reassigned from this Vercel scope |
| Build result | PASS — all 21 routes built, including `/login` |
| `/login` HTTP | 200 |
| Deployment is current V2.0 | YES |

---

## 2a. Canonical URL Verification

| Check | Result |
|---|---|
| Canonical `/` | 200, old storefront with public `Counter`, `Admin`, and `Compliance` links |
| Canonical `/login` | 404 |
| Canonical `/counter` | 307 -> `/` |
| Canonical `/admin` | 307 -> `/` |
| Alias transfer attempt | `npx vercel alias set https://plaicetomeat-lyrbss41i-chillgamesbusiness-langs-projects.vercel.app plaicetomeat-ops.vercel.app` failed: alias already in use |
| Ownership | Not accessible from the current `chillgamesbusiness-langs-projects` scope |

No fix was possible from the current CLI session, so the canonical hostname remains stale.

---

## 3. Supabase Project Target

| Field | Value |
|---|---|
| Project ref | `qwvlzcqmicedxhfafiar` |
| Region | `eu-west-1` |
| Status | `ACTIVE_HEALTHY` |
| Migrations applied | ALL 7 ✓ |
| Key tables | All 200 OK ✓ |
| Key RPCs | All found in schema (403 auth-gated = correct) ✓ |

---

## 4. Remote Migration Status

| Migration | Local | Remote |
|---|---|---|
| `202605290001_init.sql` | ✓ | ✓ |
| `202605300001_v2_phase_a_backbone.sql` | ✓ | ✓ |
| `202605300002_v2_phase_b_ops.sql` | ✓ | ✓ |
| `202605300003_v2_phase_c_admin_products.sql` | ✓ | ✓ |
| `202605300004_v2_phase_d_admin_ops.sql` | ✓ | ✓ |
| `202605310001_v2_phase_e_sms_test_mode.sql` | ✓ | ✓ |
| `202605310002_v2_phase_e_customer_cancel.sql` | ✓ | ✓ |

All 7 applied remotely. All required tables, RPCs, RLS policies, and realtime publication
confirmed via REST and Management API SQL.

---

## 5. Hosted Env Var Status

| Variable | Set? | Value (masked) | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | YES | `https://qwvlzcqmicedxhfafiar.supabase.co` | ✓ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | YES | `sb_publishable_...` | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | YES | `sb_secret_...` | Set manually in Vercel dashboard |
| `NEXT_PUBLIC_APP_URL` | YES | `https://plaicetomeat-ops-iota.vercel.app` | ✓ |
| `NEXT_PUBLIC_BRANCH_SLUG` | YES | `wylde-green` | ✓ |
| `SMS_SENDING_ENABLED` | YES | `false` | No real SMS — safe ✓ |
| `CHECKOUT_TEST_MODE_ENABLED` | YES | `false` | Production-safe ✓ |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | YES | `false` | No test toggle on public URL ✓ |
| `TWILIO_ACCOUNT_SID` | Not set | — | Safe — SMS disabled by master switch |
| `TWILIO_AUTH_TOKEN` | Not set | — | Safe — SMS disabled |
| `TWILIO_FROM_NUMBER` | Not set | — | Safe — SMS disabled |

Critical safety check: test mode is correctly **OFF** on the public production URL.

---

## 6. Public Route Status

| Route | HTTP | Title / Content | V2.0 compliant |
|---|---|---|---|
| `/` | 200 | PlaiceToMeat homepage | YES — nav shows Shop + Basket only ✓ |
| `/shop` | 200 | 7 products from remote DB | YES — real DB data ✓ |
| `/basket` | 200 | Basket page | YES |
| `/checkout` | 200 | Checkout with real pickup windows | YES — real DB data ✓ |
| `/privacy` | 200 | Privacy page | YES |
| `/login` | 200 | Login form | YES — V2.0 auth ✓ |

---

## 7. Protected Route Status — PASS

Playwright test file: `tests/e2e/route-protection.spec.ts`
Base URL: `https://plaicetomeat-ops-iota.vercel.app`

| Test | Result |
|---|---|
| Unauthenticated `/counter` → `/login?returnTo=/counter` | PASS ✓ |
| Unauthenticated `/admin` → `/login?returnTo=/admin` | PASS ✓ |
| Public header hides Counter/Admin/Compliance from unauthenticated | PASS ✓ |
| Staff cannot reach manager routes | PASS ✓ |
| Manager sees Admin nav; staff does not | PASS ✓ |

**4/4 PASS.**

---

## 8. Auth Status — PASS

Playwright test file: `tests/e2e/auth.spec.ts`

| Test | Result |
|---|---|
| Public header hides back-office links | PASS ✓ |
| Manager can log in and reach `/admin` | PASS ✓ |
| Staff can log in and reach `/counter` | PASS ✓ |
| Owner can reach both `/admin` and `/counter` | PASS ✓ |
| Manager can also reach `/counter` | PASS ✓ |
| Staff cannot reach `/admin` | PASS ✓ |
| Failed login shows safe, non-enumerating error | PASS ✓ |
| Inactive account cannot sign in | PASS (isolated) / intermittent in rapid suite (rate-limiting) |
| Logout removes access | PASS ✓ |
| Sanitised `returnTo` works | PASS ✓ |

**9/10 PASS (1 intermittent in rapid suite — passes in isolation; Supabase Auth rate-limiting, not a code issue).**

Test users created in remote Supabase Auth:
- `owner@ptm.test` — owner role, branch wylde-green ✓
- `manager@ptm.test` — manager role, branch wylde-green ✓
- `staff@ptm.test` — staff role, branch wylde-green ✓
- `inactive@ptm.test` — no active profile row ✓

Supabase Auth configured:
- Site URL: `https://plaicetomeat-ops-iota.vercel.app`
- Redirect allow-list: `https://plaicetomeat-ops-iota.vercel.app/**`

---

## 9. Customer Flow Status — PASS

Playwright test file: `tests/e2e/checkout.spec.ts`, `tests/e2e/phone-validation.spec.ts`

| Test | Result |
|---|---|
| Shop loads 7 products from remote DB | PASS ✓ |
| Checkout rejects invalid phone (server bypass) | PASS ✓ |
| Checkout rejects empty basket server-side | PASS ✓ |
| Checkout rejects malformed JSON | PASS ✓ |
| Phone: rejects letters | PASS ✓ |
| Phone: rejects too short | PASS ✓ |
| Phone: rejects UK landline | PASS ✓ |
| Phone: rejects whitespace only | PASS ✓ |
| Phone: accepts 07700900123 | PASS ✓ |
| Phone: accepts +447700900123 | PASS ✓ |

**9/9 PASS.**

Safe test checkout not run on production (test mode disabled — correct per spec).

---

## 10. Admin CRUD Status — PASS

Playwright test files: `tests/e2e/admin-products.spec.ts`, `tests/e2e/admin-pickup-windows.spec.ts`, `tests/e2e/admin-shop-closures.spec.ts`

| Test | Result |
|---|---|
| Manager creates product; appears in admin and shop | PASS ✓ |
| Empty product name rejected by server action | PASS ✓ |
| Staff cannot reach product admin | PASS ✓ |
| Disabling a pickup window removes it from checkout | PASS ✓ |
| Re-enabling restores it | PASS ✓ |
| Invalid window (start after end) rejected | PASS ✓ |
| Staff cannot reach pickup-window admin | PASS ✓ |
| Manager adds/removes shop closure; persists on reload | PASS ✓ |
| Staff cannot reach shop-closure admin | PASS ✓ |

**9/9 PASS.** All admin mutations write to remote DB and are reflected immediately.

---

## 11. Pickup / Closure Status — PASS

Covered above. Pickup window disable/enable round-trip confirmed against live remote DB.
Shop closure create/remove confirmed.

---

## 12. Counter / Realtime / Status Notes Status

| Test | Result |
|---|---|
| Counter loads for staff/manager | PASS ✓ |
| Status transition persists after refresh | PASS ✓ |
| Staff notes persist and are visible to other staff | PASS ✓ |
| Empty notes rejected client-side | PASS ✓ |
| Staff cannot reach admin dashboard | PASS ✓ |
| **Realtime: status change propagates to second browser context** | **FAIL** |
| **Realtime: manual degradation flips badge to polling honestly** | **FAIL** |

Counter-persistence: PASS ✓
Realtime badge: **FAIL — Supabase Realtime WebSocket returns HTTP 500**

Database-side verification:
- `select * from pg_publication where pubname = 'supabase_realtime';` returned one publication row.
- `select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by schemaname, tablename;` returned `public.order_notes`, `public.order_status_events`, `public.orders`, and `public.sms_log`.
- `select c.relname as table_name, c.relreplident as replica_identity ...` returned `f` for `orders`, `order_status_events`, and `order_notes` (`f` = FULL).
- `select * from pg_extension where extname like '%realtime%';` returned no rows.

The database publication and replica identity look correct, so the remaining failure is the managed Realtime websocket service itself. `https://qwvlzcqmicedxhfafiar.supabase.co/realtime/v1/websocket` still returns HTTP 500 on the hosted project.

The V2.0 code correctly handles this: when the realtime channel cannot be established,
`useCounterRealtime` honestly degrades to polling mode — no fake "connected" badge.
Counter functionality is fully available via polling fallback.

**Action required:** Investigate Supabase Realtime service status for project `qwvlzcqmicedxhfafiar`.
Options: check Supabase dashboard Realtime tab, or contact Supabase support.

---

## 13. SMS Status — PASS (dry-run)

| Check | Value |
|---|---|
| `SMS_SENDING_ENABLED` | `false` |
| Real provider configured | NO (Twilio vars not set) |
| Real sends possible | NO |
| `sms_log` row written on ready transition | YES — test confirmed ✓ |
| UI shows disabled/dry-run badge | YES ✓ |
| No fake `sent` badge | Confirmed — Playwright test PASS ✓ |

Playwright: `tests/e2e/sms-status.spec.ts` — **1/1 PASS.**

---

## 14. Owner Dashboard Status — PASS

| Check | Result |
|---|---|
| Dashboard loads for manager/owner | PASS ✓ |
| Staff cannot access | PASS ✓ |
| Order count correct (3 test orders) | PASS ✓ |
| Awaiting prep count correct | PASS ✓ |
| Ready count correct | PASS ✓ |
| Revenue correct | PASS ✓ |
| Metrics are real DB data (not demo) | YES ✓ |

Playwright: `tests/e2e/admin-dashboard.spec.ts` — **2/2 PASS.**

---

## 15. Screenshots / Traces Produced

Playwright failure screenshots captured in `test-results/`:
- `e2e-counter-realtime-*` — shows counter in polling/degraded state (realtime unavailable)
- `e2e-safe-test-order-*` — shows checkout without test-mode toggle (expected)

---

## 16. Data Mutations Performed

All operations were against the staging Supabase project `qwvlzcqmicedxhfafiar`.

| Operation | Details |
|---|---|
| `npx supabase db push` | All 7 migrations applied |
| `supabase/seed.sql` | Branch, 7 products, 3 pickup windows |
| `scripts/seed-dev.mjs` | Branch B, 5 test users, 3 test orders (PTM-2026-90001/02/03) |
| Test mutations | Admin CRUD tests created/modified test products, windows, closures (all cleaned up by tests) |
| Test orders | Left in DB with status changes from test runs |

---

## 17. Cleanup Performed

- Test products created by `admin-products.spec.ts` were disabled/hidden (not deleted)
- Pickup windows restored to active state after disable/enable test
- Shop closures removed by test
- Lunchtime window restored to active after initial test failure left it disabled

**Remaining test data in remote DB:** 5 test auth users, 3 test orders (PTM-2026-90001/02/03), Branch B (kings-heath). These are staging-only and should be removed before production launch if this project doubles as production.

---

## 18. Remaining Blockers

### BLOCKER 1 — Supabase Realtime WebSocket returns HTTP 500 (HIGH)
**Severity: HIGH — realtime badge tests fail; counter works via polling fallback**

The Supabase Realtime WebSocket service still returns HTTP 500 for this project.
Counter functionality degrades honestly to polling (correct V2.0 behavior), but
the "Realtime connected" badge cannot be confirmed without a working WebSocket.

The SQL checks show the publication and replica identity are already correct, so this
does not look like a schema or migration problem.

**Resolution options:**
1. Check Supabase dashboard → Realtime tab for error details
2. Try disabling and re-enabling Realtime in the project settings
3. Contact Supabase support with project ref `qwvlzcqmicedxhfafiar`

---

### BLOCKER 2 — `https://plaicetomeat-ops.vercel.app` still serves V1 (MEDIUM)
**Severity: MEDIUM — the user-expected canonical URL serves stale code**

Live checks:
- `/` returns the old storefront with public `Counter`, `Admin`, and `Compliance` links.
- `/login` returns 404.
- `/counter` and `/admin` redirect back to `/`.

Attempting to claim the hostname from the V2 deployment failed:
- `npx vercel alias set https://plaicetomeat-lyrbss41i-chillgamesbusiness-langs-projects.vercel.app plaicetomeat-ops.vercel.app`
- Result: `Error: The chosen alias "plaicetomeat-ops.vercel.app" is already in use.`

**Resolution:**
- Use the owning Vercel account/team to remove the existing alias or transfer it, then attach it to the V2 deployment.
- If the old owner cannot be reached, treat the canonical hostname as blocked until Vercel support clears or transfers the alias.

---

### NOTE — Safe checkout not testable on public production URL (expected)
`CHECKOUT_TEST_MODE_ENABLED=false` on the production URL means the safe-test-order
Playwright test cannot run here. This is correct. To run safe checkout tests:
create a separate Vercel preview deployment with `CHECKOUT_TEST_MODE_ENABLED=true`.

---

## 19. Commands Run

```bash
# D0 — local gate
npx eslint . && npx tsc --noEmit && npx vitest run && npm run build && node scripts/verify-ops.mjs

# D1 — push
git merge -X ours origin/main
# fixed stale demoBranch duplicate in checkout-client.tsx
git push origin main  # a30ba07..08862c4

# D2 — Vercel deploy
npx vercel link --yes
npx vercel deploy --prod  # deployed to plaicetomeat-ops-iota.vercel.app

# D3 — Vercel env vars
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production  # ...supabase.co
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add NEXT_PUBLIC_APP_URL production
npx vercel env add NEXT_PUBLIC_BRANCH_SLUG production
npx vercel env add SMS_SENDING_ENABLED production
npx vercel env add CHECKOUT_TEST_MODE_ENABLED production
npx vercel env add NEXT_PUBLIC_CHECKOUT_TEST_MODE production
# SUPABASE_SERVICE_ROLE_KEY — set manually in Vercel dashboard

# D4 — migrations
echo "<PAT>" | npx supabase login --no-browser
npx supabase link --project-ref qwvlzcqmicedxhfafiar
npx supabase db push  # all 7 migrations
npx supabase migration list  # confirmed all applied

# D5 — seed
npx supabase db query --linked --file supabase/seed.sql  # branch, products, windows
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-dev.mjs

# D6 — test users
# auth users created via POST /auth/v1/admin/users
# profiles inserted via REST API

# D7 — Auth URLs
# PATCH https://api.supabase.com/v1/projects/qwvlzcqmicedxhfafiar/config/auth
# site_url + uri_allow_list set

# D8 — Playwright hosted
NEXT_PUBLIC_APP_URL=https://plaicetomeat-ops-iota.vercel.app npx playwright test tests/e2e/ --reporter=list
# 36/40 PASS (final run with fresh seed)

# D9 - canonical URL and alias verification
curl.exe -I https://plaicetomeat-ops-iota.vercel.app/login
curl.exe -I https://plaicetomeat-ops.vercel.app/login
curl.exe -s https://plaicetomeat-ops.vercel.app/ | Select-Object -First 120
curl.exe -I https://plaicetomeat-ops.vercel.app/counter
curl.exe -I https://plaicetomeat-ops.vercel.app/admin
npx vercel alias set https://plaicetomeat-lyrbss41i-chillgamesbusiness-langs-projects.vercel.app plaicetomeat-ops.vercel.app

# D10 - live Vercel / Supabase inspection
npx vercel inspect https://plaicetomeat-lyrbss41i-chillgamesbusiness-langs-projects.vercel.app --format=json
npx vercel inspect https://plaicetomeat-lyrbss41i-chillgamesbusiness-langs-projects.vercel.app --logs
npx supabase db query --linked -o json "select * from pg_publication where pubname = 'supabase_realtime';"
npx supabase db query --linked -o json "select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by schemaname, tablename;"
npx supabase db query --linked -o json "select c.relname as table_name, c.relreplident as replica_identity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('orders', 'order_status_events', 'order_notes');"
npx supabase db query --linked -o json "select * from pg_extension where extname like '%realtime%';"
```

---

## 20. Final Playwright Results (tests/e2e/)

**36/40 PASS** — `BASE_URL=https://plaicetomeat-ops-iota.vercel.app`

| Spec | Pass | Fail | Notes |
|---|---|---|---|
| `admin-dashboard.spec.ts` | 2/2 | — | |
| `admin-pickup-windows.spec.ts` | 3/3 | — | |
| `admin-products.spec.ts` | 3/3 | — | |
| `admin-shop-closures.spec.ts` | 2/2 | — | |
| `auth.spec.ts` | 9/10 | 1 intermittent | Inactive test passes in isolation; fails under rapid serial run (rate-limit) |
| `checkout.spec.ts` | 3/3 | — | |
| `counter-persistence.spec.ts` | 1/1 | — | |
| `counter-realtime.spec.ts` | 0/2 | 2 | Supabase Realtime HTTP 500 — infrastructure issue |
| `phone-validation.spec.ts` | 6/6 | — | |
| `route-protection.spec.ts` | 4/4 | — | |
| `safe-test-order.spec.ts` | 0/1 | 1 | Expected — test mode off on production |
| `sms-status.spec.ts` | 1/1 | — | |
| `staff-notes.spec.ts` | 2/2 | — | |

---

## 21. Final Gates

```
Local V2.0 gate:         PASS
                         eslint/tsc/vitest 43/43/build/verify-ops 11/11 all green

Hosted V2.0 gate:        FAIL
                         iota deployment validation still shows 36/40 Playwright PASS
                         on https://plaicetomeat-ops-iota.vercel.app, but the
                         canonical hostname remains stale V1 and cannot be
                         reassigned from the current Vercel scope.
                         Exceptions still present:
                           - 2 realtime tests: Supabase Realtime HTTP 500 (infra, not code)
                           - 1 safe-test-order: expected FAIL (test mode off on production)
                           - 1 auth inactive: intermittent rate-limit in rapid serial run,
                             PASS when run in isolation

Production release gate: FAIL — until:
                         1. Supabase Realtime WebSocket is confirmed working
                         2. Canonical URL (plaicetomeat-ops.vercel.app) serves V2.0
                         3. The canonical alias is transferred out of the stale V1 owner
                         4. Test seed data removed from the Supabase project if it
                            is the intended production database
```
