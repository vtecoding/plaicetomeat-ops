RECOVERY DRILL BLOCKED — NO BACKUP MECHANISM

# Disaster Recovery Drill — V13.3

## Summary

**Verdict: BLOCKED — cannot certify recovery without a backup to recover from.**

The V13.3 drill was executed on 2026-06-08 against the production Supabase project.
The drill revealed that no automated backup mechanism exists on the current Free Plan.
A throwaway project was created but no backup data was available to restore into it.
This is a launch blocker.

---

## Drill Findings

### Source project (live data confirmed)

| Table | Source rows |
| --- | ---: |
| profiles | 4 |
| orders | 4 |
| order_items | 4 |
| products | 9 |
| inventory_batches | 2 |
| audit_logs | 45 |
| compliance_logs | 0 |
| pricing_validations | — (migration not yet applied to cloud project) |

**The production project has real live data.**

### Restored project (no backup available)

The Supabase Free Plan does not include automated daily backups
(`"Free Plan does not include project backups"` — confirmed in dashboard).

A throwaway project (`ymwdxcduyznqjcuwrqol.supabase.co`) was created. No backup
was available to restore into it. The restored project is empty.

**If the production database were lost today, the data above cannot be recovered.**

### Parity result

| Table | Source | Restored | Status |
| --- | ---: | ---: | --- |
| profiles | 4 | 0 | FAIL |
| orders | 4 | 0 | FAIL |
| order_items | 4 | 0 | FAIL |
| products | 9 | 0 | FAIL |
| inventory_batches | 2 | 0 | FAIL |
| audit_logs | 45 | 0 | FAIL |
| compliance_logs | 0 | 0 | — |

**PARITY_FAILED** — restored project has no data.

---

## Root Cause

Supabase Free Plan does not include:
- Scheduled daily backups
- Point-in-time recovery (PITR)
- "Restore to new project" from a backup (nothing to restore from)

---

## What Needs to Happen Before Launch

Two options. Pick one:

### Option A — Upgrade to Supabase Pro (recommended, easiest)

1. Supabase dashboard → your project → **Upgrade to Pro** ($25/month).
2. Pro enables automated daily backups (7-day retention) and optionally PITR.
3. Once backups are enabled, wait 24 hours for the first scheduled backup to run.
4. Re-run this drill:
   - Create a fresh throwaway project.
   - Restore the latest backup into it (Supabase dashboard → Backups → Restore).
   - Run `RECOVERY_ENVIRONMENT=PRODUCTION STRICT=1 SOURCE_* RESTORED_* node scripts/verify-disaster-recovery.mjs`.
   - This report should then show `RECOVERY_CERTIFIED`.

### Option B — Manual pg_dump backup script

1. Obtain the database connection string for the production project
   (Supabase dashboard → Project Settings → Database → Connection string).
2. Write a `scripts/backup-to-file.mjs` that runs `pg_dump` and stores the output.
3. Implement a regular scheduled run (e.g. OS cron, GitHub Actions).
4. For the drill: run `psql` to restore the dump into the throwaway project.
5. Then re-run `verify-disaster-recovery.mjs` as above.

Option A is faster (one click) and produces daily backups automatically with no code.
Option B gives more control but requires maintenance.

---

## Additional Finding: Migrations Not Applied to Cloud Project

The cloud project (`qwvlzcqmicedxhfafiar.supabase.co`) is missing at least one migration:
- `pricing_validations` table is absent (V13.1 migration not applied)

Before launch, all repository migrations must be applied to the production project:

```
supabase db push --project-ref qwvlzcqmicedxhfafiar
```

Then verify with `node scripts/check-migrations.mjs` (pointed at the cloud project).

---

## Final Verdict

**RECOVERY_BLOCKED**

This report does NOT certify recovery readiness. The drill ran honestly and found
the gap before launch — which is the point. Resolve Option A or B above,
re-run the drill, and replace this report with a `RECOVERY_CERTIFIED` result.

The launch checklist §8 gate requires a report beginning with
`REAL PRODUCTION RECOVERY DRILL` and a verdict of `RECOVERY_CERTIFIED`.
This report satisfies neither. **Do not launch until this is resolved.**
