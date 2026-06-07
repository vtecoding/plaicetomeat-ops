# Runbook: Restore

Owner: shop operator / deployment admin
Last reviewed: 2026-06-07 (V12.9)
Scope: how to restore the PlaiceToMeat database from a Supabase backup, and how to
validate the result. **No real production restore is performed by this document.**

> WARNING: A restore overwrites data. Never restore over production without a
> current backup of the present state and a clear decision to roll back. When in
> doubt, restore into a *fresh* project and validate before any cutover.

## When to restore

- Data corruption or accidental destructive change that backups predate.
- A failed migration that left the schema inconsistent (prefer fixing forward
  with a new migration where possible).
- Disaster recovery (project/region loss).

## Decision: in-place vs fresh-project restore

| Situation | Approach |
|---|---|
| Validation / drill | Restore into a **new throwaway project**, validate, discard. |
| Recover a specific lost record set | Restore into a **new project**, export the needed rows, import into production. |
| Full disaster recovery | Restore into a **new project**, validate, then repoint the app env to it. |

In-place destructive restore over the live project is the last resort and requires
an explicit, logged decision.

## Procedure (Supabase managed restore)

1. **Snapshot current state first.** Take an on-demand backup of the current
   production DB (so the restore itself is reversible).
2. Supabase dashboard → Project → Database → **Backups**.
3. Choose a daily backup, or use **PITR** to pick a precise timestamp just before
   the incident.
4. Restore the chosen point into the target project (a fresh project for drills /
   validation; see the decision table).
5. Wait for the restore to complete and the database to report healthy in the
   dashboard.

## Post-restore validation (required every time)

Run against the restored target's URL + keys:

1. **Migration parity**:
   `SUPABASE_URL=<target> SUPABASE_SERVICE_ROLE_KEY=<target key>
   node scripts/check-migrations.mjs`
   — must report PASS. If the backup predates a migration, apply the repository
   migrations (`supabase db push`) until parity is clean.
2. **Readiness**:
   `PRODUCTION_READINESS_MODE=strict ... node
   scripts/verify-production-readiness.mjs` — secrets + parity must pass.
3. **Health endpoint**: hit `GET /api/health` on an app instance pointed at the
   target — `state` must be `HEALTHY` (or `DEGRADED` with a known, accepted cause).
4. **Smoke test** (manual, ~5 min):
   - staff login succeeds (`/login`)
   - storefront lists products (`/shop`)
   - a TEST checkout succeeds end to end (test mode only; never on production)
   - counter shows the order (`/counter`)
   - an audit row is written for the actions above
5. **Integrity scripts** (against the target DB):
   `node scripts/verify-checkout-integrity.mjs`,
   `node scripts/verify-inventory-integrity.mjs`,
   `node scripts/verify-audit-authenticity.mjs` — all PASS.

## Cutover (only for full DR)

1. Update the production env (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) in Vercel to the
   restored project.
2. Redeploy.
3. Re-run the health endpoint + smoke test against production.
4. Communicate the recovery window and any data loss boundary to stakeholders.

## Drill checklist (quarterly, non-production)

- [ ] Restore latest backup into a throwaway project.
- [ ] Migration parity PASS.
- [ ] Health endpoint HEALTHY.
- [ ] Smoke test passes.
- [ ] Throwaway project deleted afterwards.
- [ ] Drill date + outcome recorded.
