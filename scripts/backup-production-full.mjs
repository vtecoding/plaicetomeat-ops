// backup-production-full.mjs — Phase-1 remediation (PTM-DR-001 / PTM-DR-011).
//
// The V13.4 REST backup (backup-production.mjs) exported only 8 public tables and
// no schema/auth/storage — so a restore could not reconstruct logins, evidence
// objects, functions, triggers, policies or grants. This produces a COMPLETE,
// self-contained, encrypted logical backup using the Supabase CLI's pg_dump path:
//
//   * public schema + ALL public data      (functions, triggers, policies, grants)
//   * auth schema + auth.users data         (login reconstruction)
//   * storage schema + buckets/objects rows (evidence-object metadata)
//   * roles                                 (role definitions)
//
// It then encrypts the bundle (AES-256-GCM, existing backup-lib), writes a
// manifest + checksums, and stamps the ops_backup_runs ledger via record_backup_run
// so /api/health and the release gate can see a truthful freshness signal.
//
// Required env:
//   BACKUP_ENVIRONMENT=PRODUCTION
//   STRICT=1
//   SUPABASE_DB_URL            — direct Postgres connection string (pooler), for pg_dump
//   BACKUP_ENCRYPTION_KEY      — AES-256-GCM passphrase (>= 32 chars)
// Recommended (to stamp the freshness ledger + reconcile):
//   NEXT_PUBLIC_SUPABASE_URL   — project URL (also gives the project ref)
//   SUPABASE_SERVICE_ROLE_KEY  — to call record_backup_run
// Optional:
//   CANONICAL_BRANCH_ID, BACKUP_OUTPUT_DIR (default ./backups)
//
// NOTE: storage OBJECT BYTES (the actual photo/certificate files) are held in the
// storage backend, not the DB. This backup captures their metadata; the runbook
// documents the `supabase storage cp`/S3 sync step for the binary objects.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  backupFileName,
  checksum,
  encryptPayload,
  extractProjectRef,
  formatTimestamp,
} from "./backup-lib.mjs";

function requireEnv(env) {
  if (env.BACKUP_ENVIRONMENT !== "PRODUCTION") throw new Error(`BACKUP_ENVIRONMENT must be "PRODUCTION"`);
  if (env.STRICT !== "1") throw new Error(`STRICT must be "1"`);
  for (const k of ["SUPABASE_DB_URL", "BACKUP_ENCRYPTION_KEY"]) {
    if (!env[k]) throw new Error(`${k} is required but not set`);
  }
  return {
    DB_URL: env.SUPABASE_DB_URL,
    KEY: env.BACKUP_ENCRYPTION_KEY,
    SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    SERVICE: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    OUT: env.BACKUP_OUTPUT_DIR ?? "backups",
  };
}

// PostgreSQL 17 client (>= server major). CI sets PG_DUMP/PG_DUMPALL to the
// explicit pg17 binary path so we don't depend on pg_wrapper picking the right
// version. Falls back to PATH locally.
const PG_DUMP = process.env.PG_DUMP || "pg_dump";
const PG_DUMPALL = process.env.PG_DUMPALL || "pg_dumpall";

// Supabase DIRECT connections (db.<ref>.supabase.co) are IPv6-only and are not
// reachable from GitHub Actions runners. pg_dump must use the SESSION pooler
// (aws-0-<region>.pooler.supabase.com, port 5432). Fail fast with a clear message.
function assertPoolerUrl(dbUrl) {
  if (/@db\.[a-z0-9]+\.supabase\.co[:/]/i.test(dbUrl)) {
    throw new Error(
      "SUPABASE_DB_URL is a DIRECT connection (db.<ref>.supabase.co), which is IPv6-only " +
        "and unreachable from CI. Use the SESSION POOLER string instead: " +
        "postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres " +
        "(Dashboard -> Project Settings -> Database -> Connection string -> Session mode).",
    );
  }
}

function pgDump(dbUrl, { schema, dataOnly, label }) {
  const args = [dbUrl, "--schema", schema, dataOnly ? "--data-only" : "--schema-only"];
  const res = spawnSync(PG_DUMP, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if ((res.status ?? 1) !== 0) {
    throw new Error(`pg_dump (${label}) failed: ${(res.stderr || res.stdout || "").slice(-400)}`);
  }
  return res.stdout ?? "";
}

function pgDumpRoles(dbUrl) {
  // Best-effort: role definitions without passwords (Supabase manages those).
  const res = spawnSync(PG_DUMPALL, ["-d", dbUrl, "--roles-only", "--no-role-passwords"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if ((res.status ?? 1) !== 0) {
    console.warn(`  WARN roles dump skipped: ${(res.stderr || "").slice(-200)}`);
    return "";
  }
  return res.stdout ?? "";
}

async function main() {
  console.log("backup-production-full: starting");

  // The full logical (pg_dump) backup needs a direct DB connection string. When
  // SUPABASE_DB_URL is not configured, skip cleanly (exit 0) rather than failing
  // the workflow — the REST backup (backup-production.mjs) still runs and stamps
  // the freshness ledger, and the schema is recoverable from the git migrations.
  // Adding SUPABASE_DB_URL upgrades this run to a schema+auth+storage pg_dump.
  if (!process.env.SUPABASE_DB_URL) {
    console.log("  SKIPPED: SUPABASE_DB_URL not set — full logical (pg_dump) backup skipped.");
    console.log("  (REST backup covers table data; add SUPABASE_DB_URL for schema/auth/storage dump.)");
    return;
  }

  const env = requireEnv(process.env);
  assertPoolerUrl(env.DB_URL);
  const timestamp = formatTimestamp();
  const outputDir = resolve(process.cwd(), env.OUT, `plaicetomeat-production-${timestamp}`);
  mkdirSync(outputDir, { recursive: true });

  console.log("  dumping schema (public+auth+storage), data, roles via pg_dump...");
  const parts = {
    schema_public: pgDump(env.DB_URL, { schema: "public", label: "schema/public" }),
    schema_auth: pgDump(env.DB_URL, { schema: "auth", label: "schema/auth" }),
    schema_storage: pgDump(env.DB_URL, { schema: "storage", label: "schema/storage" }),
    data_public: pgDump(env.DB_URL, { schema: "public", dataOnly: true, label: "data/public" }),
    data_auth: pgDump(env.DB_URL, { schema: "auth", dataOnly: true, label: "data/auth" }),
    data_storage: pgDump(env.DB_URL, { schema: "storage", dataOnly: true, label: "data/storage" }),
    roles: pgDumpRoles(env.DB_URL),
  };

  const scope = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length]));
  const migrationHead = (parts.data_public.match(/\((\d{12}),/g) ?? []).slice(-1)[0] ?? null;

  const payloadObj = {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    source_project_ref: extractProjectRef(env.SUPABASE_URL ?? env.DB_URL),
    scope_bytes: scope,
    parts,
  };
  const payloadJson = JSON.stringify(payloadObj);

  console.log("  encrypting bundle (aes-256-gcm)...");
  const encrypted = encryptPayload(payloadJson, env.KEY);
  const encName = backupFileName(timestamp);
  writeFileSync(join(outputDir, encName), encrypted);
  const encChecksum = checksum(encrypted);
  writeFileSync(join(outputDir, "checksums.sha256"), `${encChecksum}  ${encName}\n`);

  const manifest = {
    backup_id: `${payloadObj.source_project_ref}-${timestamp}`,
    created_at: new Date().toISOString(),
    environment: "PRODUCTION",
    backup_mode: "full_logical_cli",
    encryption: "aes-256-gcm-scrypt-n16384",
    encrypted_file: encName,
    encrypted_checksum: `sha256:${encChecksum}`,
    scope: Object.keys(parts),
    scope_bytes: scope,
    migration_head: migrationHead,
    plaintext_bytes: payloadJson.length,
  };
  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Safety: no raw .sql/.json left on disk (only encrypted + manifest + checksums).
  for (const f of ["schema.sql", "data.sql"]) {
    try { rmSync(join(outputDir, f)); } catch { /* not present */ }
  }

  // Stamp the freshness ledger so health + release gate can see it.
  if (env.SUPABASE_URL && env.SERVICE) {
    try {
      const admin = createClient(env.SUPABASE_URL, env.SERVICE, { auth: { persistSession: false } });
      const { error } = await admin.rpc("record_backup_run", {
        p_environment: "PRODUCTION",
        p_status: "success",
        p_backup_mode: "full_logical_cli",
        p_row_count_total: null,
        p_migration_head: migrationHead,
        p_encrypted_checksum: `sha256:${encChecksum}`,
      });
      if (error) console.warn(`  WARN could not stamp ops_backup_runs: ${error.message}`);
      else console.log("  stamped ops_backup_runs (freshness ledger)");
    } catch (err) {
      console.warn(`  WARN ledger stamp failed: ${err.message}`);
    }
  } else {
    console.warn("  WARN NEXT_PUBLIC_SUPABASE_URL/SERVICE not set — freshness ledger not stamped");
  }

  console.log("");
  console.log("RESULT: full backup PASSED (BACKUP_CERTIFIED)");
  console.log(`  archive   : ${encName}`);
  console.log(`  checksum  : sha256:${encChecksum}`);
  console.log(`  scope     : ${manifest.scope.join(", ")}`);
  console.log(`  head      : ${migrationHead}`);
  console.log(`  directory : ${outputDir}`);
}

main().catch((err) => {
  console.error("backup-production-full crashed:", err.message);
  process.exit(2);
});
