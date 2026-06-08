# Runbook: Backup

Owner: shop operator / deployment admin
Last reviewed: 2026-06-07 (V12.9)
Scope: how PlaiceToMeat data is backed up and how to verify backups are working.
This runbook documents and validates procedures. It does NOT perform a restore
(see `restore.md`).

## What needs backing up

All durable state lives in the Supabase Postgres database:
- orders, order items, order notes
- inventory batches, movements, waste, stock counts
- products, categories, pickup windows, branch settings
- profiles (staff), audit_logs / audit_events
- ops-capture checklist sessions and evidence

The application is stateless (Vercel) — there is nothing to back up at the app
tier beyond the source repository (already in git) and the environment variables
(held in Vercel project settings; see "Secrets backup" below).

## Primary mechanism: Supabase managed backups

Supabase cloud takes automated backups of the project database:
- **Daily backups** are retained per the project's plan.
- **Point-in-Time Recovery (PITR)** (paid tiers) allows restoring to a specific
  timestamp within the retention window.

No application-side backup pipeline is required or implemented. Do not build a
parallel export pipeline that would duplicate (and risk leaking) customer data.

## Operator steps — confirm backups are enabled

1. Supabase dashboard → Project → Database → **Backups**.
2. Confirm automated daily backups are listed with recent timestamps.
3. If on a PITR-capable plan, confirm PITR is **enabled** and note the retention
   window (e.g. 7 days).
4. Record the most recent successful backup timestamp in the deploy log.

## Secrets backup

Environment secrets are NOT in git (by design — `.env*` is gitignored and the
audit bundle denylists them). They live in Vercel project settings.

1. Keep an offline, encrypted record of the production values for:
   `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_ACCESS_SECRET`, `STAFF_SESSION_SECRET`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `CANONICAL_BRANCH_ID`, and any SMS/Twilio values in use.
2. Store it in the team password manager, not in the repo or a plain file.
3. Losing `ORDER_ACCESS_SECRET` / `STAFF_SESSION_SECRET` invalidates all live
   order-access and staff-session cookies (users must re-authenticate) but does
   not lose data.

## Validation steps (no real restore)

These confirm backups exist and are usable without performing a production
restore:

1. **Backup presence**: a backup dated within the last 24h is listed.
2. **Schema parity**: `node scripts/check-migrations.mjs` (release mode) passes,
   so the live schema matches the repository migrations a restore would target.
3. **Readiness**: `PRODUCTION_READINESS_MODE=strict node
   scripts/verify-production-readiness.mjs` passes against the production env,
   confirming required secrets (needed to operate a restored DB) are present.
4. **Restore drill (non-production)**: at least once per quarter, perform the
   `restore.md` drill into a *throwaway* Supabase project and run the smoke test
   there. Never drill against production.

## Escalation

If automated backups are missing or stale:
1. Check the Supabase project status page / billing (backups can pause on an
   expired plan).
2. Re-enable the plan / backups.
3. Take a manual on-demand backup immediately from the dashboard if available.
4. Do not deploy schema-changing migrations until a fresh backup exists.
