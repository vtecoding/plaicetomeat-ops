# PTM Phase-1 — Production Change Runbook

Scope: apply the 5 pending migrations to the production database, redeploy the
application with a verifiable build identity, and prove the result read-only.
Findings retired: **PTM-REL-002, PTM-SEC-003, PTM-OBS-012, PTM-REL-009** (and the
substance of **PTM-DR-001** via the recovery drill).

> **Golden rule:** never apply a production migration until a current encrypted
> backup exists, has been integrity-verified, and has been restored into an
> isolated scratch environment (rule 5). See `ptm-phase1-recovery.md`.

Ordering contract (application deploy is SEPARATE from schema migration):
1. Backup + verify + scratch-restore (recovery runbook).
2. Apply migrations to the production DB.
3. Prove production posture read-only.
4. Redeploy the application (build carries the commit SHA).
5. Prove `/api/health` reports reality.
6. Configure backup secrets + first green backup (owner) — see recovery runbook.

---

## Pre-flight (fingerprint — do not skip)

```bash
git rev-parse HEAD                        # release commit
git status --porcelain                    # expect only intended changes
npx supabase migration list --linked      # expect 5 pending: 202606301000,
                                          # 202607011300, 202607101200,
                                          # 202607110900, 202607111000
curl -s https://plaicetomeat-ops.vercel.app/api/health   # capture BEFORE
node scripts/generate-migration-manifest.mjs --check     # manifest in sync
```

Abort if `migration list` shows anything other than the 5 expected pending
versions, or if the manifest check fails.

## Step 1 — Current encrypted backup + scratch restore (REQUIRED)

Run the recovery runbook end-to-end (`ptm-phase1-recovery.md`). Do not proceed
until the scratch restore drill prints `Scratch restore drill: PASS`.

## Step 2 — Apply migrations to production

```bash
npx supabase db push --linked --dry-run   # preview — expect exactly the 5
npx supabase db push --linked             # apply
```

Expected: each of the 5 migrations logged `Applying ...`. A single
`NOTICE ... trigger "ops_backup_runs_append_only" ... does not exist, skipping`
is expected (DROP-IF-EXISTS before CREATE).

## Step 3 — Prove production posture (READ-ONLY)

```bash
# Migration parity — every local has a matching remote
npx supabase migration list --linked

# Grants / policies / new objects (read-only schema dump)
npx supabase db dump --linked -f /tmp/prod_post.sql
grep -E "next_order_ref.*(anon|authenticated|PUBLIC|service_role)" /tmp/prod_post.sql | grep -iE "grant|revoke"
#   expect: REVOKE ALL ... FROM PUBLIC  +  GRANT ... TO service_role   (no anon/authenticated)
grep -c "managers can manage products" /tmp/prod_post.sql                 # expect 0
grep -c "managers can create branch waste events" /tmp/prod_post.sql      # expect 0
grep -c "staff can create branch order status events" /tmp/prod_post.sql  # expect 0
grep -c "ops_backup_runs\|get_backup_freshness\|record_backup_run" /tmp/prod_post.sql  # > 0
```

Do NOT prove the locks with a destructive production write. The forge-denial /
authorized-path behaviour is proven on the production-restored scratch clone
(`verify:truth-table-lock`, `verify:next-order-ref-lock` — both green on the
migrated clone). The live schema is byte-identical to that clone.

## Step 4 — Redeploy the application with a build identity

```bash
SHA=$(git rev-parse HEAD)
npx vercel deploy --prod --yes --build-env PTM_BUILD_SHA=$SHA
```

The build injects `PTM_BUILD_SHA` into the bundle (see `next.config.ts`), so the
deployed app can be reconciled to a commit. If the project is git-connected,
pushing the release branch to the deploy branch also works and supplies
`VERCEL_GIT_COMMIT_SHA` automatically.

## Step 5 — Prove `/api/health` reports reality

```bash
curl -s https://plaicetomeat-ops.vercel.app/api/health | jq
```

Expected AFTER redeploy:
- `build.known: true`, `build.commit` == first 7 of the release SHA;
- `migration.parity: true`, `requiredCount: 40`, `observedHead: 202607111000`;
- `backup_freshness: DEGRADED` until the first successful backup is recorded
  (this is correct and truthful — see recovery runbook to close it).

## Step 6 — Backup automation (owner-controlled)

Configure the GitHub secrets and run the backup workflow — see
`ptm-phase1-recovery.md`, "Owner secret configuration". Until then, the health
endpoint and the release gate will (correctly) report the backup as not fresh.

## Stop conditions (abort + run rollback)

- `db push` errors on any migration → STOP, run the rollback runbook.
- Post-apply `migration list` shows a missing remote → STOP.
- Deployed app returns non-200 on `/api/health` → roll back the Vercel deploy
  (`vercel rollback`) — the DB migrations are expand-safe and can remain.
