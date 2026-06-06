# V11.2 Phase B — Audit Authenticity Boundary: Evidence

> **Release status: V11.2 PHASE B COMPLETE LOCALLY — PRODUCTION SEAL PENDING.**
> This is *repository* security, not yet *production* security. PR #13 and the
> stacked PR #12 only become real security once **Production Gate A** is executed
> ([production-gate-a.md](production-gate-a.md)). Do **not** record V11.2 as "fully
> complete," and do not begin Today/Dashboard consolidation, until Gate A is sealed
> and audit authenticity is verified against production. Correct sequence:
> **(1)** merge #12 → **(2)** execute Production Gate A → **(3)** archive prod
> evidence → **(4)** retarget/rebase #13 onto `main` → **(5)** re-run full
> local/regression → **(6)** merge #13 → **(7)** verify audit authenticity against
> production → **(8)** only then start UX consolidation.

**Branch:** `v11-2-audit-authenticity` · **Base commit:** `25fc0e8` (V11.1 sealed)
**Head commit:** tip of branch `v11-2-audit-authenticity` (see `git log`)

## Target invariant (spec §B)

Audit logs are **system-generated evidence only**. No client, browser, public
caller, staff user or manager user may directly insert, update or delete audit
records. Audit writes are emitted only by trusted server/RPC paths, bind actor +
branch + action + target, set `created_at` server-side, and never contain secrets,
tokens or public access ids.

## Risk found (before this phase)

Two tables were directly forgeable via PostgREST:

1. `audit_logs` — policy **"authenticated can create audit logs"**
   (`WITH CHECK branch_id IS NULL OR is_branch_staff(branch_id)`) let any branch
   staff insert rows with forged `event_type` / `actor_id` / `target_id` /
   `metadata`, and `branch_id = NULL` bypassed the branch check entirely.
2. `audit_events` — policy **"authenticated can create audit events"**
   (`WITH CHECK auth.uid() IS NOT NULL`) let **any** authenticated user forge a row
   with arbitrary `actor_email`, `actor_role` (e.g. `owner`), `ip_address`,
   `user_agent`. This is the surface the admin audit UI displays.

Append-only (no UPDATE/DELETE) was already enforced by triggers; the open hole was
direct **inserts**.

## Migration

`supabase/migrations/202606051400_v11_2_audit_authenticity.sql`
SHA-256 `8ff4c1d9398116f09e996a7e403a6762a67174911350574946b98ae0d6208393`

1. **Drops** both forgeable INSERT policies.
2. **Revokes** `INSERT, UPDATE, DELETE, TRUNCATE` on `audit_logs` and `audit_events`
   from `anon`, `authenticated`, `PUBLIC` (defence in depth alongside RLS). `SELECT`
   retained — existing read policies still govern visibility.
3. **Re-asserts** the append-only triggers on both tables (idempotent).
4. Adds the single trusted helper **`public.emit_audit_log(event_type, target_type,
   target_id, branch_id, metadata, system_reason)`** (`SECURITY DEFINER`,
   `SET search_path = public`), which is fail-closed:
   - actor is **always** derived from `auth.uid()` for authenticated callers — there
     is no actor parameter, so it cannot be forged;
   - system emission (no JWT subject / service-role) **requires** an explicit
     `system_reason` and records `actor_id = NULL`;
   - a non-system caller may never claim system authority;
   - branch scope validated (`is_branch_staff(branch_id)`);
   - `event_type` checked against an allowlist (31 known types);
   - `metadata` must be a JSON object ≤ 8 KiB; secret-like keys
     (`secret|token|password|access_id|public_access|cookie|authoriz|bearer|jwt|
     session|api_key|private_key|credential`) are stripped and recorded under
     `_redacted_keys`;
   - `created_at` defaulted server-side (no parameter).
   - Grant: `EXECUTE` to `authenticated`, `service_role` only (not `anon`).
5. **Re-routes `transition_order_status`** (the only audit-emitting function that
   runs as `SECURITY INVOKER`) through `emit_audit_log`. Its prior inline
   `INSERT INTO audit_logs` depended on the removed authenticated grant and would
   otherwise fail closed. The nested `SECURITY DEFINER` call writes in owner context
   while still deriving the actor from `auth.uid()`; the audit row is equivalent.
6. **Self-enforcing assertions** (DO block): fails the migration if any residual
   write grant or INSERT/ALL policy exists on the audit tables. On apply it logs
   `V11.2 audit authenticity: direct-write hole closed (0 write grants, 0 insert
   policies).`

**Applied locally** via `supabase db reset` (clean apply in sequence) and
registered as version `202606051400` — see [migration-output.txt](migration-output.txt).

**Rollback/forward-fix:** to roll back you would re-create the dropped INSERT
policies and re-grant `INSERT` to `authenticated` — **not recommended**, it reopens
the forgery. The helper and revokes are additive/idempotent. Prefer fix-forward.

## Application changes

- `src/lib/server/audit.ts` — **new** `server-only` module: the single sanctioned
  TypeScript audit-emission path. Wraps `emit_audit_log` via the service client as
  transport; exposes `emitAuditLog` / `emitSecurityEvent` and the `AUDIT_EVENT_TYPES`
  union (mirrors the SQL allowlist). No actor/created_at parameter is surfaced.
- `src/lib/server/audit-events.ts` — unchanged; confirmed read-only (no writes).
- `src/lib/server/audit-imports.test.ts` — **new** import-graph guard.
- `scripts/verify-audit-authenticity.mjs` — **new** adversarial DB harness.
- `package.json` — add `npm run playwright` (full e2e) script (spec validation cmd).

No client-side audit creation path exists (none did; verified by the import-graph
test). No server action accepts caller-controlled audit metadata without validation.

## Tests run

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Unit | `npm run test` | **288 passed / 41 files** (incl. new import-graph test) |
| Production build | `npm run build` | success |
| Audit bundle | `npm run audit:bundle` | secret scan **CLEAN** |
| Migration check (local) | `node scripts/check-migrations.mjs` | `SKIPPED_LOCAL_ONLY` (release-mode parity is a Phase A / prod step) |
| Migration apply | `npx supabase db reset` | clean apply; `202606051400` registered — [migration-output.txt](migration-output.txt) |
| V11.1 regression | `node scripts/verify-public-access.mjs` | **25/25 PASS** (no regression from hardening) |
| **Audit authenticity** | `node scripts/verify-audit-authenticity.mjs` | **41/41 PASS** — [adversarial-output.txt](adversarial-output.txt) |
| e2e (Playwright, full) | `npm run playwright` | **98 passed / 0 failed** — [e2e-output.txt](e2e-output.txt) |

> The secure-checkout e2e requires `ORDER_ACCESS_SECRET` (≥ 32 bytes) in the
> production build/run environment (a V11.1 requirement). It is **not** in
> `.env.local`; the run above set it for the session. This is the same secret the
> Phase A runbook requires in production.

### Required adversarial cases proven (spec §B "Tests Required")

1. `anon` cannot insert into `audit_logs` (and `audit_events`). ✓
2. authenticated **staff** (and manager) cannot insert directly into either table. ✓
3. a **manager** cannot forge an owner/system event (emit rejects `system_reason`;
   direct forged-actor insert denied). ✓
4. **staff** cannot forge another actor — emit forces `actor_id = auth.uid()`
   (verified on the stored row); direct forged-actor insert denied. ✓
5. a **branch-A manager** cannot create audit evidence for branch B (emit rejects;
   direct insert denied). ✓
6. direct UPDATE/DELETE of audit rows fails (append-only) — even for `service_role`,
   on both tables. ✓
7. caller-supplied `created_at` / actor / branch cannot override trusted values
   (emit has no such params; the direct path that could set `created_at` is denied). ✓
8. metadata containing access ids / secrets / tokens is **redacted** (keys stripped,
   non-secret keys retained, `_redacted_keys` recorded). ✓
9. legitimate flows still emit: order status transition, public cancellation,
   inventory/stock-count correction, waste logging, product price/cost commit,
   supplier certificate update — all emit audit rows. ✓
10. all public `SECURITY DEFINER` functions pin `search_path` (catalog check: 0
    offenders). ✓
11. grants audit: **no** INSERT/UPDATE/DELETE grant on the audit tables for
    `anon`/`authenticated`, and **no** INSERT/ALL RLS policy remains. ✓

## Limitations / follow-ups

1. **Existing business RPCs keep their inline owner-context audit inserts.** They are
   already trusted `SECURITY DEFINER` paths that validate the actor before writing, so
   they are not forgeable; routing every one through `emit_audit_log` was deliberately
   left out of scope to avoid a large, risky refactor. `emit_audit_log` is the
   sanctioned path for **new** server audit needs. (`transition_order_status` was the
   one invoker-context emitter and *was* re-routed.)
2. **Audit read access unchanged.** `audit_logs` SELECT remains branch-staff
   (`is_branch_staff`) and `audit_events` SELECT remains branch-staff-or-owner, per
   the existing product requirement that branch staff can see their branch's audit
   trail. The forgery fix is write-side; reads were out of scope.
3. **Local-only evidence.** The catalog meta-checks (#10/#11) run via `docker exec`
   against the local stack (`AUDIT_DB_CONTAINER`). The production equivalent is below.

## Production verification (sequence step 7 — after #13 merges + migration applied)

Run **read-only** catalog checks against production (the full adversarial harness
writes append-only rows + test orders and must NOT be pointed at prod). Against the
prod DB connection:

```sql
-- A. No client write capability on the audit tables (expect 0 rows):
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('audit_logs','audit_events')
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');

-- B. No INSERT/ALL RLS policy remains on the audit tables (expect 0 rows):
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public' AND tablename IN ('audit_logs','audit_events')
  AND cmd IN ('INSERT','ALL');

-- C. All public SECURITY DEFINER functions pin search_path (expect 0 rows):
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef AND NOT EXISTS
  (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'::text[])) c WHERE c LIKE 'search_path=%');
```

Then confirm a known-legitimate flow (e.g. mark one real order ready, or a price
update) still produces an `audit_events` row in the admin audit view. Archive the
three "0 rows" results + the positive emit alongside the Gate A evidence.

> **This phase is not production-complete until these prod checks pass.**
