# V11.2 Phase A — Production Gate A Seal (Runbook + Evidence)

> **Status: NOT YET EXECUTED.** This is the operator runbook for the production
> cutover that proves the V11.1 public-order security invariant holds in
> production, not just locally. The cutover mutates the production database and
> deploys; it is an **outward-facing, operator-gated** action and is intentionally
> *not* performed by the build agent. Fill the evidence tables below as each step
> is run, then flip the status banner to EXECUTED / PASS.

**Branch:** `v11-2-audit-authenticity` · **Base commit:** `25fc0e8` (V11.1 sealed)
**Reviewed V11.1 commit to deploy:** `25fc0e8` (head of PR #12 once merged)
**Prerequisite:** PR #12 (V11.1, branch `v11-public-order-access`) is **merged to
`main`**. Do not begin until then.

---

## Required production actions

### 1. Set `ORDER_ACCESS_SECRET` (≥ 32 random bytes)

```bash
# Generate a 32-byte (256-bit) secret, base64url-encoded:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set it in the production environment (Vercel → Project → Settings → Environment
Variables, scope **Production**). Confirm there is **no** fallback/insecure value
in production:

```bash
# Expect a single Production-scoped value, length ≥ 43 chars (base64url of 32 bytes):
vercel env ls | grep ORDER_ACCESS_SECRET
```

- [ ] `ORDER_ACCESS_SECRET` set, Production scope, ≥ 32 bytes of entropy.

### 2. Apply migrations `202606051200` then `202606051300` consecutively

These are the two V11.1 migrations. (The V11.2 audit-authenticity migration
`202606051400` is **Phase B** — apply it only after Gate A passes and Phase B is
merged.) Apply against the linked production project:

```bash
supabase link --project-ref <PROD_REF>
supabase migration list --linked          # confirm 1200/1300 are pending (remote blank)
supabase db push                          # applies pending migrations in order
supabase migration list --linked          # confirm 1200 and 1300 now show remote applied
```

- [ ] `202606051200_v11_1_public_order_access` applied to production.
- [ ] `202606051300_v11_1_seal_public_access` applied to production.

### 3. Deploy the exact reviewed V11.1 commit

```bash
git checkout 25fc0e8            # the reviewed, sealed V11.1 head
vercel deploy --prod            # or merge to main and let CI deploy that SHA
```

- [ ] Production is running commit `25fc0e8` (verify build SHA in the deploy log).

### 4. Migration parity in release mode

```bash
# Against production env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY = prod):
MIGRATION_DRIFT_CHECK_MODE=release node scripts/check-migrations.mjs
```

Expected: `Migration Drift Check: PASS`.

- [ ] Parity PASS — paste output into `migration-output.txt` under "Production".

### 5. Verify security headers on the deployed origin

```bash
curl -sI https://<prod-origin>/order/lookup | grep -iE \
  'content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|strict-transport-security'
```

Expected: CSP with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (prod).

- [ ] Headers present on the live origin — paste into the evidence table.

### 6. Verify production anon **cannot** execute the privileged/legacy RPCs

Run the adversarial harness against production as the anon role (it exercises the
exact deny paths). Use the **production anon + service keys**:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<PROD_REF>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod anon> \
SUPABASE_SERVICE_ROLE_KEY=<prod service> \
node scripts/verify-public-access.mjs
```

The harness asserts each of the following directly; record per-line results:

| Anon must NOT be able to call | Expected | Result |
|---|---|---|
| `cancel_public_order` (with a valid access id) | DENIED, order unchanged | |
| `establish_public_order_access` | DENIED | |
| legacy `get_public_order(ref)` | removed / uncallable | |
| legacy `cancel_order_by_ref` | removed / uncallable | |

- [ ] All four deny checks PASS in production.

### 7. Verify production public order flows

| Flow | Expected | Result |
|---|---|---|
| New checkout returns secure status access | redirect to `/order/status/<publicAccessId>` | |
| Status page works through public access id | safe DTO, no phone/email/notes | |
| Reference recovery requires correct phone | ref + right phone → access id | |
| Wrong phone reveals nothing | null (indistinguishable) | |
| Unknown reference reveals nothing | null (indistinguishable) | |
| Old `/order/[ref]` reveals nothing | redirects to lookup, no data | |
| Cancellation requires signed session authority | works only with session cookie | |
| Direct anonymous cancellation fails | DENIED | |

> Steps in this table are partly covered by `verify-public-access.mjs` (run in
> step 6) and partly by a manual browser pass against the live origin (checkout →
> status → lookup → old-ref redirect). Record both.

- [ ] All public-flow checks PASS in production.

### 8. Archive evidence

Paste the exact command outputs and the filled tables above into this file and
into `migration-output.txt`. Capture the deploy SHA, prod project ref (redacted),
and timestamps.

---

## Evidence (fill on execution)

- **Executed by:**
- **Date/time (UTC):**
- **Prod project ref (redacted):** `…`
- **Deployed commit:** `25fc0e8`
- **`ORDER_ACCESS_SECRET` set:** yes/no, length:
- **Migrations applied:** `202606051200`, `202606051300`
- **Parity (release mode):** PASS/FAIL
- **Security headers:** PASS/FAIL (paste `curl -sI` output)
- **Anon deny checks (step 6):** N/N PASS
- **Public flows (step 7):** N/N PASS

## Rollback notes

- The V11.1 migrations are additive (new columns default-filled, new functions,
  one legacy function dropped). To roll **back** the cutover you would re-grant the
  retired anon paths — **not recommended**, it reopens the disclosure/forgery gap.
  Prefer **fix-forward**.
- If a production proof fails: **stop**, do not proceed to Phase B application,
  diagnose, fix forward, re-run the failed step. Phase B (audit authenticity,
  migration `202606051400`) must not be applied to production until Gate A passes.
- Deploy rollback: redeploy the previous known-good Vercel build; the DB schema is
  forward-compatible with the prior app build (additive columns/functions).
