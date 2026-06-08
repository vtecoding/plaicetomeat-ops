# Runbook: Free-Tier Backup System

Owner: shop operator / deployment admin
Last reviewed: 2026-06-08 (V13.4)
Scope: automated daily backup, encryption, off-site storage (GitHub Actions),
restore procedure, quarterly recovery drill.

---

## Why Supabase Free tier is not sufficient alone

Supabase Free Plan does not include automated daily backups or point-in-time recovery.
Confirmed 2026-06-08: the Backups page shows "Free Plan does not include project backups."

If the production database is lost or corrupted on the Free Plan, **there is no restore path
through Supabase's interface alone**.

V13.4 adds a free-tier backup system that runs entirely within GitHub Actions (free for public
repos / included in private repo free tier) and stores encrypted archives as workflow artifacts.

---

## How the backup works

1. **Daily at 02:00 UTC**, `.github/workflows/production-backup.yml` runs automatically.
2. The workflow exports all core tables via the Supabase service-role REST API (no pg_dump needed).
3. The export is compressed (gzip) and encrypted with AES-256-GCM using `BACKUP_ENCRYPTION_KEY`.
4. A `manifest.json` and `checksums.sha256` are written alongside the encrypted archive.
5. The encrypted archive + manifest + checksums are uploaded as a GitHub Actions artifact.
6. **Raw SQL/JSON is never uploaded** — only the encrypted `.backup.enc` file.
7. Artifacts are retained for **90 days**.

---

## Required GitHub Secrets

Set these in: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key |
| `BACKUP_ENCRYPTION_KEY` | Generate once: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CANONICAL_BRANCH_ID` | UUID of the production branch (in branch settings) |

**Never commit these to git.** Store them in the team password manager.

### Key rotation

To rotate `BACKUP_ENCRYPTION_KEY`:
1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Save the old key securely (you still need it to decrypt old archives).
3. Update the GitHub secret.
4. Trigger a manual backup run to confirm the new key works.
5. Old archives can only be decrypted with the old key — document which key corresponds to which archive dates.

---

## Verifying backup age and integrity

After a backup runs, verify it locally (requires the latest artifact downloaded):

```bash
BACKUP_ENVIRONMENT=PRODUCTION \
STRICT=1 \
BACKUP_ENCRYPTION_KEY=<your key> \
BACKUP_OUTPUT_DIR=<path to extracted artifact dir> \
node scripts/verify-latest-backup.mjs
```

Expected output: `RESULT: latest backup verification PASSED (BACKUP_CERTIFIED)`

---

## Quarterly recovery drill

Run this every quarter and before any major launch. Takes approximately 20–30 minutes.

### Step 1 — Download the latest backup artifact

1. GitHub repo → Actions → Production Backup → latest successful run → Artifacts.
2. Download the artifact zip.
3. Extract to a local directory, e.g. `~/ptm-drill-backups/`.

### Step 2 — Create a throwaway Supabase project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → New project.
2. Name it `ptm-restore-drill-YYYYMMDD`. Any region. Note the project URL and service role key.

### Step 3 — Get a Supabase personal access token

1. [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
2. Generate a new token named `ptm-restore-drill`.
3. Copy it — you will not be able to see it again.

### Step 4 — Restore the backup

```bash
BACKUP_FILE=<path to extracted>/plaicetomeat-production-YYYYMMDD-HHMMSS.backup.enc \
BACKUP_ENCRYPTION_KEY=<your key> \
RESTORED_SUPABASE_URL=https://<throwaway-ref>.supabase.co \
RESTORED_SUPABASE_SERVICE_ROLE_KEY=<throwaway service role key> \
SUPABASE_ACCESS_TOKEN=<your personal access token> \
node scripts/restore-backup-local.mjs
```

The script will apply all 24+ repo migrations to the throwaway project, then insert all data.

### Step 5 — Verify parity and integrity

```bash
RECOVERY_ENVIRONMENT=PRODUCTION \
STRICT=1 \
SOURCE_SUPABASE_URL=https://qwvlzcqmicedxhfafiar.supabase.co \
SOURCE_SUPABASE_SERVICE_ROLE_KEY=<production service role key> \
RESTORED_SUPABASE_URL=https://<throwaway-ref>.supabase.co \
RESTORED_SUPABASE_SERVICE_ROLE_KEY=<throwaway service role key> \
node scripts/verify-disaster-recovery.mjs
```

Expected: `RESULT: disaster-recovery verification PASSED (RECOVERY_CERTIFIED)`

### Step 6 — Generate the certification report

```bash
RECOVERY_DRILL_ID=<drill ID from step 5 output> \
STRICT=1 \
node scripts/disaster-recovery-certification.mjs
```

Report saved to `docs/reports/disaster-recovery-certification.md`.

### Step 7 — Clean up

Delete the throwaway Supabase project from the dashboard.

---

## What counts as launch-certified evidence

The launch checklist §8 gate requires **all** of:

- `docs/reports/disaster-recovery-certification.md` beginning with `REAL PRODUCTION RECOVERY DRILL`
- Final verdict: `RECOVERY_CERTIFIED`
- Drill dated within this quarter
- `node scripts/verify-latest-backup.mjs` PASSED (BACKUP_CERTIFIED)
- GitHub Actions backup workflow confirmed running on schedule

A report beginning with `LOCAL TEST DATA ONLY` or `RECOVERY DRILL BLOCKED` does **not** satisfy the gate.

---

## Escalation

If the backup workflow fails:
1. Check GitHub Actions → Production Backup for the error log.
2. Common causes: expired/rotated service role key, BACKUP_ENCRYPTION_KEY not set, Supabase project
   paused (free tier projects pause after 1 week of inactivity — unpause in dashboard).
3. Trigger a manual run after fixing.
4. If two consecutive days fail, alert the operator — a 3-day gap means potential data loss window.
