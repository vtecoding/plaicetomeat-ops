# PlaiceToMeat Ops — V2.0 Hosted Validation Report

_Generated: 2026-05-31. Corrected run by Claude Code (claude-sonnet-4-6)._
_Previous version incorrectly stated "no hosted URL exists". Corrected and re-run._

---

## 1. Hosted URL Tested

`https://plaicetomeat-ops.vercel.app/`

App loads (200 OK). However the deployed build is **stale V1 (Initial commit only)**.
No V2.0 code is deployed. See Phase H0 for full deployment state.

---

## 2. Whether the Deployment Is Current or Stale

**STALE — Critical blocker.**

| Field | Value |
|---|---|
| Local branch | main |
| Local HEAD | `f399412` |
| Commits ahead of `origin/main` | **10** |
| Vercel deployed commit | `dc2f8de` — Initial commit (2026-05-30) |
| V2.0 code pushed to origin? | **NO** |
| Deployed version | V1 prototype — demo/hardcoded data, no auth, no ops |

All 10 V2.0 feature commits exist only on the local machine. Vercel has never received them.
A `git push origin main` is required before any hosted V2.0 testing is possible.

---

## 3. Supabase Project Target

| Field | Value |
|---|---|
| Project ref | `qwvlzcqmicedxhfafiar` |
| Dashboard | `https://supabase.com/dashboard/project/qwvlzcqmicedxhfafiar` |
| REST API | `https://qwvlzcqmicedxhfafiar.supabase.co` |
| REST reachable? | YES — 200 OK with service-role key |
| Migrations applied? | **NO — all tables still 404** |

The remote Supabase project is still blank. No change since the previous report.
The deployed V1 app does not use this Supabase project at all — the shop page reads from
hardcoded `demoProducts`/`demoCategories` in `src/lib/data/demo.ts`.

---

## 4. Remote Migration Status

| Migration | Local applied? | Remote applied? |
|---|---|---|
| `202605290001_init.sql` | YES | **NO** |
| `202605300001_v2_phase_a_backbone.sql` | YES | **NO** |
| `202605300002_v2_phase_b_ops.sql` | YES | **NO** |
| `202605300003_v2_phase_c_admin_products.sql` | YES | **NO** |
| `202605300004_v2_phase_d_admin_ops.sql` | YES | **NO** |
| `202605310001_v2_phase_e_sms_test_mode.sql` | YES | **NO** |
| `202605310002_v2_phase_e_customer_cancel.sql` | YES | **NO** |

All 7 migrations unapplied. Remote is blank.

Supabase CLI authentication still not available (no Personal Access Token).
`npx supabase migration list` returns `Unauthorized`.

---

## 5. Hosted Env Var Status

Vercel dashboard access not available via CLI. Inferred from app behaviour:

| Variable | Inferred hosted state | Risk |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | UNKNOWN — V1 shop does not use it | V2.0 will crash without it |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | UNKNOWN | V2.0 will crash without it |
| `SUPABASE_SERVICE_ROLE_KEY` | UNKNOWN | V2.0 server ops will fail without it |
| `CHECKOUT_TEST_MODE_ENABLED` | Likely `false` — no test UI visible on checkout | Must confirm before V2.0 deploy |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | Likely `false` — no test toggle visible | Must confirm before V2.0 deploy |
| `SMS_SENDING_ENABLED` | UNKNOWN | Must be `false` at initial V2.0 deploy |
| `NEXT_PUBLIC_APP_URL` | UNKNOWN | Required for Playwright hosted tests |
| `NEXT_PUBLIC_BRANCH_SLUG` | UNKNOWN | Required for branch-scoped queries |

**No production-dangerous env vars observed from the outside.** Test mode is not exposed in
the V1 checkout UI. However, env vars for V2.0 have not been set.

---

## 6. Public Route Status (H1)

Tested via HTTP against `https://plaicetomeat-ops.vercel.app`:

| Route | HTTP | Title | Content | V2.0 compliant? |
|---|---|---|---|---|
| `/` | 200 | PlaiceToMeat Ops | V1 homepage, hero image, hardcoded nav | **NO** — shows Counter/Compliance nav links publicly |
| `/shop` | 200 | PlaiceToMeat Ops | 7 hardcoded demo products | **NO** — not reading from remote DB |
| `/basket` | 200 (assumed) | — | Client-side basket | Not verified |
| `/checkout` | 200 | PlaiceToMeat Ops | Phone input, pickup section | Partially — no test mode, no V2.0 window RPCs |
| `/privacy` | Not tested | — | — | Not tested |
| `/login` | **404** | — | Does not exist | **CRITICAL FAIL** — no auth in V1 |

---

## 7. Protected Route Status (H4)

All four V2.0 route-protection Playwright tests **FAIL** against the hosted URL.

| Route | Expected (V2.0) | Actual (hosted V1) | Result |
|---|---|---|---|
| `/counter` | Redirect to `/login?returnTo=/counter` | **Redirect to `/`** (homepage) | **FAIL** |
| `/admin` | Redirect to `/login?returnTo=/admin` | **Redirect to `/`** (homepage) | **FAIL** |
| `/admin/products` | Redirect to `/login?returnTo=/admin/products` | Redirect to `/` | **FAIL** |
| `/admin/pickup-windows` | Redirect to `/login?returnTo=/admin/pickup-windows` | Redirect to `/` | **FAIL** |
| `/counter/compliance` | Redirect to `/login?returnTo=/counter/compliance` | Redirect to `/` | **FAIL** |
| Public header — Counter link | Not visible to unauthenticated users | **VISIBLE** (1 element found) | **FAIL** |
| Public header — Compliance link | Not visible | **VISIBLE** | **FAIL** |
| `/login` | Login form renders | **404 Not Found** | **CRITICAL FAIL** |

Playwright test results (run against `BASE_URL=https://plaicetomeat-ops.vercel.app`):

```
4 failed
  route-protection › unauthenticated redirected to login — FAIL
    Expected URL to match /\/login/, got "https://plaicetomeat-ops.vercel.app/"
  route-protection › staff cannot reach manager-only routes — FAIL
    Timeout waiting for input[name="email"] on /login (404)
  route-protection › public pages never leak back-office navigation — FAIL
    Expected Counter link count to be 0, got 1
  route-protection › manager sees Admin nav, plain staff does not — FAIL
    Timeout waiting for input[name="email"] on /login (404)
```

**Security finding**: The public header in the V1 deployment exposes "Counter" and
"Compliance" navigation links to unauthenticated users. These links were not gated in V1.
V2.0 fixes this, but V2.0 is not deployed.

---

## 8. Auth Status (H5)

**BLOCKED — Critical**

- `/login` returns 404.
- No Supabase Auth site URL configured for the hosted domain.
- No test users exist on the remote Supabase project.
- Auth redirect URLs not configured.

No login → no staff/manager/owner login tests can run.

---

## 9. Customer Flow Status (H6)

**Partial — V1 only, not V2.0**

| Check | Result |
|---|---|
| Homepage loads | YES |
| Shop loads products | YES — but from hardcoded demo data, not remote DB |
| Basket (add to basket) | YES — client-side |
| Checkout loads | YES |
| Phone input present | YES |
| Pickup windows | Likely hardcoded or static — not from remote DB |
| TEST mode visible | NO (good — not exposed publicly) |
| Order submission | NOT TESTED — V1 checkout would not use V2.0 RPCs or sms_log |

Full customer flow is **not V2.0 compliant**. The shop reads `demoProducts` from
`src/lib/data/demo.ts`, confirmed from `git show dc2f8de:src/app/shop/page.tsx`.

---

## 10. Admin CRUD Status (H7)

**BLOCKED — Not tested**

No login page → admin inaccessible. No migrations → no DB tables. Cannot proceed.

---

## 11. Pickup / Closure Status

**BLOCKED — Not tested**

Same blockers as admin CRUD. Remote `pickup_windows` and `shop_closures` tables do not exist.

---

## 12. Counter / Realtime / Status Notes Status (H8)

**BLOCKED — Not tested**

No login, no orders, no `order_status_events` table, no realtime publication configured.

---

## 13. SMS Status (H9)

**NOT VERIFIED — Blocked**

No `sms_log` table on remote. No order transitions possible (no auth).
Inferred: `SMS_SENDING_ENABLED` is likely not set or false in Vercel (V1 doesn't use SMS).
No real SMS risk from current deployment — but cannot confirm from outside.

---

## 14. Owner Dashboard Status (H10)

**BLOCKED — Not tested**

No login, no remote DB, no `/admin` access.

---

## 15. Screenshots / Traces Produced

Playwright screenshots captured during hosted route-protection run:

| Test | Screenshot path |
|---|---|
| Unauthenticated redirect fails (shows homepage) | `test-results\e2e-route-protection-route-7abf3-for-every-back-office-route-chromium\test-failed-1.png` |
| Staff login attempt (404 on /login) | `test-results\e2e-route-protection-route-da239-each-any-manager-only-route-chromium\test-failed-1.png` |
| Counter link visible in public header | `test-results\e2e-route-protection-route-4f98d-leak-back-office-navigation-chromium\test-failed-1.png` |
| Manager login attempt (404 on /login) | `test-results\e2e-route-protection-route-7a0e6-in-nav-plain-staff-does-not-chromium\test-failed-1.png` |

---

## 16. Data Mutations Performed

**None.** No writes made to remote Supabase. No orders created. No users created.
Remote project state unchanged (blank).

---

## 17. Cleanup Performed

None required — no data was written.

---

## 18. Remaining Blockers

Ordered by dependency. Later blockers cannot be cleared until earlier ones are resolved.

### BLOCKER 1 — V2.0 code not deployed (CRITICAL)

All 10 V2.0 commits exist only locally. `origin/main` is at the Initial commit.
Vercel is serving V1 prototype code.

**Resolution:**
```
git push origin main
```
Vercel will auto-redeploy from the new HEAD.
After redeployment, verify `/login` returns 200 and the header hides Counter from unauthenticated users.

**All other blockers are secondary to this one.** The hosted URL cannot be validated
until V2.0 code is deployed.

---

### BLOCKER 2 — Remote Supabase has no migrations (CRITICAL)

All 7 migrations unapplied. All tables 404.

**Resolution:**
1. Get Supabase Personal Access Token: `https://supabase.com/dashboard/account/tokens`
2. `npx supabase login` (paste PAT when prompted)
3. `npx supabase link --project-ref qwvlzcqmicedxhfafiar` (enter DB password from Supabase → Settings → Database)
4. `npx supabase db push` — applies all 7 migrations to remote
5. Verify: `npx supabase migration list`
6. Confirm tables exist:
```
curl https://qwvlzcqmicedxhfafiar.supabase.co/rest/v1/orders?limit=1 \
  -H "apikey: sb_secret_<masked>" -H "Authorization: Bearer sb_secret_<masked>"
# must return [] not 404
```

---

### BLOCKER 3 — Vercel env vars not set for V2.0 (CRITICAL)

V1 does not need them. V2.0 will crash at startup without Supabase credentials.

**Resolution:** In Vercel dashboard → Project Settings → Environment Variables, add at minimum:

| Variable | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qwvlzcqmicedxhfafiar.supabase.co` | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_<masked>` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_<masked>` | All (server only) |
| `NEXT_PUBLIC_APP_URL` | `https://plaicetomeat-ops.vercel.app` | Production |
| `NEXT_PUBLIC_BRANCH_SLUG` | `wylde-green` | All |
| `SMS_SENDING_ENABLED` | `false` | All |
| `CHECKOUT_TEST_MODE_ENABLED` | `false` | Production |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | `false` | Production |

---

### BLOCKER 4 — Remote DB has no seed data (HIGH)

After migrations are applied, the DB will be structurally correct but empty.
The app will load with no branches, products, or pickup windows.

**Resolution:** Run seed data via Supabase SQL editor
(`https://supabase.com/dashboard/project/qwvlzcqmicedxhfafiar/sql`):
- One active `branches` row with `slug = 'wylde-green'`
- Matching `branch_settings` row
- At least one `product_categories` row
- At least one active `products` row
- At least one active `pickup_windows` row

---

### BLOCKER 5 — No test auth users on remote (HIGH)

No users in remote `auth.users`. Staff/manager/owner accounts needed before
route protection and role-based tests can run.

**Resolution:**
Create in Supabase dashboard → Authentication → Users (staging only):
- `owner@ptm.test`
- `manager@ptm.test`
- `staff@ptm.test`
- `inactive@ptm.test` (no staff row — for rejection test)

Insert matching `public.profiles` and `public.staff_roles` rows for the first three.

---

### BLOCKER 6 — Supabase Auth redirect URLs not configured (HIGH)

Site URL and redirect allow-list not set for the hosted domain.

**Resolution:** Supabase dashboard → Authentication → URL Configuration:
- **Site URL:** `https://plaicetomeat-ops.vercel.app`
- **Redirect URLs:** `https://plaicetomeat-ops.vercel.app/**`

---

## 19. Final Gates

```
Local V2.0 gate:         PASS
                         (eslint/tsc/vitest 43/43/build/verify-ops 11/11/Playwright
                          confirmed green on last committed local state)

Hosted V2.0 gate:        FAIL
                         Deployment is stale V1 (Initial commit). /login = 404.
                         Route protection redirects to / instead of /login?returnTo=...
                         Public header exposes Counter and Compliance links to
                         unauthenticated users. All 4 route-protection Playwright
                         tests fail against hosted URL. Remote Supabase is blank.

Production release gate: FAIL
```

### What must happen before the hosted gate can be re-evaluated

In strict order:

1. `git push origin main` — deploys V2.0 code to Vercel (Blocker 1)
2. Verify `/login` returns 200 on hosted
3. Verify public header no longer shows Counter/Compliance to unauthenticated users
4. Supabase PAT → `npx supabase link` → `npx supabase db push` (Blocker 2)
5. Set all V2.0 env vars in Vercel dashboard (Blocker 3)
6. Seed remote DB (Blocker 4)
7. Create test auth users + profiles/staff_roles (Blocker 5)
8. Set Auth site URL + redirect URLs in Supabase (Blocker 6)
9. Re-run this full validation spec against the updated hosted URL
10. All H1–H10 phases must pass before hosted gate moves to PASS
