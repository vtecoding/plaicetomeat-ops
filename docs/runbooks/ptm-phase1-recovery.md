# PTM Phase-1 — Backup & Recovery Runbook

Retires (in substance) **PTM-DR-001** (no verified recoverable backup) and
**PTM-DR-011** (backup scope excluded Auth/Storage/schema). Covers: what is
backed up, how it is encrypted and verified, retention/expiry, and a repeatable
restore-into-scratch drill with a full validation battery.

## What the full backup captures

`scripts/backup-production-full.mjs` produces a single encrypted bundle covering
every data class the old REST backup missed:

| Class | Source | Restores |
|---|---|---|
| public schema | `supabase db dump` | tables, **functions, triggers, policies, grants** |
| public data | `supabase db dump --data-only` | all business rows (not just 8 tables) |
| auth schema + `auth.users` | `--schema auth [--data-only]` | **login reconstruction** |
| storage schema + buckets/objects rows | `--schema storage` | **evidence-object metadata** |
| roles | `--role-only` | role definitions |

Encryption: AES-256-GCM with a scrypt-derived key (`backup-lib.mjs`,
`aes-256-gcm-scrypt-n16384`). Output: `*.backup.enc` + `checksums.sha256` +
`manifest.json`. No raw `.sql` is left on disk.

> **Storage object BYTES** (the actual photo/certificate files) live in the
> storage backend, not the DB. This bundle captures their metadata; export the
> binaries separately with the Storage API / S3 sync (`supabase storage cp`) and
> store alongside the encrypted bundle. Only 1 bucket / few objects exist today.

## Owner secret configuration (GitHub → Settings → Secrets → Actions)

The daily `Production Backup` workflow fails closed until these are set. Set them;
never print their values.

| Secret | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | REST export + stamp the freshness ledger |
| `CANONICAL_BRANCH_ID` | recorded in manifest |
| `BACKUP_ENCRYPTION_KEY` | AES-256-GCM passphrase (≥ 32 chars) |
| `SUPABASE_DB_URL` | **new** — direct pooler connection string for the full logical dump |

Validation (no values printed):

```bash
gh secret list                                   # names present, 5 rows
gh workflow run "Production Backup"              # manual trigger
gh run watch                                     # expect success
gh run view --log | grep "BACKUP_CERTIFIED"      # full backup certified
# health then shows a fresh backup within a run:
curl -s https://plaicetomeat-ops.vercel.app/api/health | jq '.backup'
```

## Retention & expiry

- GitHub artifact retention: **90 days** (`retention-days: 90`).
- Freshness threshold: **48h** (`get_backup_freshness`, health, release gate).
  A backup older than 48h → health `DEGRADED`, release gate BLOCKS.
- Free-tier Supabase has **no PITR**; best-case RPO is one backup interval.
- Encryption key: store in the owner's password manager; rotating it makes prior
  archives unreadable — keep the retiring key until all archives it protects age out.

## Restore-into-scratch drill (repeatable)

Prereqs: an ISOLATED scratch Postgres with Supabase prerequisites (roles are
cluster-wide in a Supabase Postgres container; create the `auth`/`extensions`/
`vault` schemas + extensions in the target DB). Bootstrap example (local
container, DB `ptm_scratch`):

```bash
DB=supabase_db_plaicetomeat-ops
docker exec $DB psql -U postgres -d postgres -c "CREATE DATABASE ptm_scratch;"
docker exec $DB psql -U postgres -d ptm_scratch -c \
 "CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; \
  CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE PUBLICATION supabase_realtime;"
docker exec $DB psql -U postgres -d ptm_scratch -c \
 'CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions; \
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; \
  CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions; \
  CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA vault;'
```

Run the drill:

```bash
BACKUP_FILE=backups/plaicetomeat-production-<ts>/plaicetomeat-production-<ts>.backup.enc \
BACKUP_ENCRYPTION_KEY=***** \
SCRATCH_PSQL="docker exec -i $DB psql -U postgres -d ptm_scratch" \
node scripts/restore-backup-scratch.mjs
```

The script decrypts, restores schema then data (triggers disabled), and validates:
public base tables ≥ 40, RLS enabled on every public table, `auth.users` restored,
profiles reconcile to `auth.users` (0 orphans), and business data present. Exit 0
= recoverable.

### Full validation battery (measured on the 2026-07-11 drill)

| Check | Result |
|---|---|
| schema object counts | 48 tables · 66 functions · 56 policies · 22 triggers |
| migration ledger | seeded to prod head, then advanced to 40 |
| critical row counts | orders 5 · order_items 5 · products 9 · audit_logs 120 |
| foreign-key integrity | 0 orphans (order_items, status_events, movements, profiles) |
| Auth/profile reconciliation | 5 users, 0 orphaned profiles |
| Storage reconciliation | 1 bucket / objects metadata restored |
| RLS enabled state | 48/48 |
| representative read path | `get_public_order_status` → non-null (anon) |
| representative write path | `create_checkout_order` → `PTM-2026-00003` (service role) |
| checksum integrity | encrypted archive checksum stable; decrypt round-trip OK |

**Measured RPO / RTO (drill):** RPO ≤ 24h (daily backup cadence; no PITR on free
tier). RTO ≈ 10–15 min from encrypted artifact to validated scratch restore
(schema + data + validation), plus dump time when generating a fresh backup.
