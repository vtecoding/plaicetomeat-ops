# V11.1 — Release-Sealing Pass

Follow-up hardening on the V11.1 public order access boundary. One new migration
(`202606051300_v11_1_seal_public_access.sql`) plus app changes. Addresses the ten
sealing requirements; exact commands and outputs below.

## Summary of what changed

| # | Requirement | Outcome |
|---|---|---|
| 1 | Establish/cancel rate limiting fail-**closed** | `checkRateLimit(..., {failClosed:true})`; storage outage → generic temporary failure that does not reveal order existence. Status reads stay fail-open. |
| 2 | Cancel must require session, not access-id alone | `cancel_public_order` + `establish_public_order_access` are now **service_role-only**; reachable solely via `order-access-privileged.ts` after the action verifies the session. Anon direct call is denied. |
| 3 | Cookie signing review | HMAC-SHA256, constant-time verify (`timingSafeEqual`), `HttpOnly`, `SameSite=Lax`, `Secure` in prod, `maxAge` 14d, **path `/order`**, secret **≥32 bytes** required (visible failure in prod if missing/short). Signing extracted to a unit-tested pure module. |
| 4 | `public_access_revoked_at` + `public_access_version` enforced | `revoked_at` filtered on status/establish/cancel (and re-checked under lock in cancel); cancel enforces session-bound `expected_version` (compare-and-check). |
| 5 | No access id / session material in logs/audit/errors | Audited: only field-names + generic messages logged; rate-limit identities are hashed; audit metadata uses `order_ref`. Referrer-Policy keeps the access-id URL from leaking cross-origin. |
| 6 | Unknown-ref vs wrong-phone indistinguishable | Both return SQL `NULL` from `establish_public_order_access` (identical path). Proven equal. |
| 7 | Full Playwright suite | See below. |
| 8 | Clean-DB + pre-V11 upgrade migration tests | `scripts/verify-v11-migrations.mjs` — both PASS. |
| 9 | SECURITY DEFINER search_path + grants audit | 0 definer functions without `search_path`; surfaced and removed a leftover anon-readable `get_public_order(ref)`. |
| 10 | Re-run route/unit/typecheck/adversarial/build | All green (below). |

## New finding fixed during the audit (item 9)

The grants audit revealed a legacy `public.get_public_order(text)` — a SECURITY
DEFINER function from `init.sql`, executable by **anon** via PostgREST, returning
`customer_name` and order details **keyed by the enumerable order_ref**. Proof:

```
$ docker exec ... psql -c "set local role anon;
    select order_ref||' | '||customer_name from public.get_public_order('PTM-2026-90001');"
PTM-2026-90001 | Aisha Khan        <-- leak via reference, pre-seal
```

It had no application caller (the app used the now-removed `getOrderByRef`). The
seal migration drops it. Post-seal, anon calls error ("No function matches").

## Commands and outputs

### Item 9 — search_path / grants audit
```
$ docker exec ... psql -c "<definer funcs without search_path>"
(0 rows)                       # every SECURITY DEFINER function pins search_path
```
Grants after seal (anon / authenticated / service_role):
```
cancel_public_order            f / f / t
establish_public_order_access  f / f / t
get_public_order_status        t / t / t   # status stays readable by id
check_rate_limit               t / t / t
get_public_order               (dropped)
```

### Item 8 — migration tests
```
$ node scripts/verify-v11-migrations.mjs
[1] CLEAN database: apply all 18 migrations in order   -> 8/8 PASS
[2] UPGRADE: pre-V11 DB with a seeded order, then V11.1 -> 11/11 PASS
RESULT: clean-apply and pre-V11 upgrade migration checks PASSED
```
Upgrade test proves an existing pre-V11 order is backfilled with a unique,
NOT-NULL `public_access_id` (version 1) and the legacy hole is closed.

### Items 1-6 — adversarial harness (sealed)
```
$ node scripts/verify-public-access.mjs        # 25/25 PASS
... anon establish_public_order_access is DENIED
... anon cancel_public_order with VALID access id is DENIED
... order unchanged after anon cancel attempt
... legacy get_public_order(ref) is removed/uncallable by anon
... unknown-ref and wrong-phone establish results are identical (null)
... cancel with wrong expected_version is rejected / correct version succeeds
... revoked: status returns null / establish returns null / cancel rejected
... race: exactly one winner every time / no clobber
RESULT: all sealed public-access adversarial checks PASSED
```

### Item 3 — cookie signing unit tests
```
$ vitest run src/lib/server/order-access-token.test.ts   # 6/6 PASS
round-trips; rejects wrong secret; rejects tampered payload; rejects flipped
signature byte; rejects malformed tokens; drops malformed grant entries.
```

### Item 10 — unit / typecheck / build
```
$ vitest run                 # 40 files, 283 passed
$ tsc --noEmit               # exit 0
$ next build                 # exit 0 (all /order routes dynamic)
```

### Item 7 — full Playwright suite
```
$ ORDER_ACCESS_SECRET=… node scripts/run-playwright.mjs full
98 passed (1.5m)            # exit 0 — see e2e-output.txt
```
First run surfaced one failure in the rewritten secure-flow spec (it asserted the
TEST order on the *counter*, but the order's pickup date is 2 days out and the
counter shows only today's pickups). Removed that unrelated assertion; the spec
still proves the full secure flow (access-id redirect, ref→lookup, cancel blocked
without session, cancel works with session).

## Remaining limitations (unchanged + new)

1. **CSP `script-src` still `'unsafe-inline'`** (Next inline bootstrap; no nonce
   pipeline). All other directives strict. Nonce hardening tracked.
2. **Rate-limit fail-open for STATUS reads** is intentional (availability of
   read-only status); establish/cancel are fail-closed.
3. **`ORDER_ACCESS_SECRET` (≥32 bytes) must be set in production** — visible
   failure if missing.
4. Broader least-privilege review of the many anon-executable `admin_*` SECURITY
   DEFINER functions (they self-check authorisation internally) is **out of V11.1
   scope** and belongs to V11.2 (audit authenticity / least privilege).
