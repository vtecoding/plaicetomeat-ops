// backup-production.mjs
// V13.4 — exports all core tables via Supabase service-role REST API,
// encrypts the result with AES-256-GCM, writes a manifest and checksums.
// Does NOT require pg_dump or a direct Postgres connection.
//
// Required env vars:
//   BACKUP_ENVIRONMENT=PRODUCTION
//   STRICT=1
//   NEXT_PUBLIC_SUPABASE_URL    — production Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY   — production service role key
//   BACKUP_ENCRYPTION_KEY       — strong passphrase (min 32 chars recommended)
//
// Optional:
//   CANONICAL_BRANCH_ID         — recorded in manifest
//   BACKUP_OUTPUT_DIR           — output root dir (default: ./backups)
//   BACKUP_KEEP_RAW=1           — keep intermediate JSON for local debugging only

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

import { readFileSync, readdirSync } from "node:fs";

import {
  validateBackupEnv,
  formatTimestamp,
  backupFileName,
  checksum,
  encryptPayload,
  buildManifest,
  RESTORE_ORDER,
  extractProjectRef,
} from "./backup-lib.mjs";

async function applyMigrations(supabaseUrl, accessToken) {
  const projectRef = extractProjectRef(supabaseUrl);
  const migrationsDir = resolve(process.cwd(), "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  console.log(`  applying ${files.length} migrations to ${projectRef}...`);
  let applied = 0;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    if (response.ok) {
      applied++;
    } else {
      const body = await response.text();
      console.warn(`  WARN ${file}: HTTP ${response.status} — ${body.slice(0, 100).replace(/\n/g, " ")}`);
    }
  }
  console.log(`  migrations: ${applied}/${files.length} applied`);
}

const PAGE_SIZE = 1000;

async function exportTable(client, table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`export ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function getMigrationCount(client) {
  try {
    const { count } = await client
      .schema("supabase_migrations")
      .from("schema_migrations")
      .select("*", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0; // not accessible via REST — not a failure
  }
}

async function main() {
  console.log("backup-production: starting");

  const env = validateBackupEnv(process.env);
  const timestamp = formatTimestamp();
  const outputDir = resolve(process.cwd(), env.BACKUP_OUTPUT_DIR, `plaicetomeat-production-${timestamp}`);

  mkdirSync(outputDir, { recursive: true });
  console.log(`  output dir: ${outputDir}`);

  // ── Optional: apply migrations if access token provided ──────────────────
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? null;
  if (accessToken) {
    await applyMigrations(env.SUPABASE_URL, accessToken);
  }

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Export all core tables ─────────────────────────────────────────────────
  const tables = {};
  const rowCounts = {};

  const missingTables = [];
  for (const table of RESTORE_ORDER) {
    process.stdout.write(`  exporting ${table}... `);
    try {
      const rows = await exportTable(client, table);
      tables[table] = rows;
      rowCounts[table] = rows.length;
      console.log(`${rows.length} rows`);
    } catch (err) {
      if (err.message.includes("Could not find the table")) {
        console.log(`MISSING (table does not exist)`);
        missingTables.push(table);
        rowCounts[table] = null;
      } else {
        throw err;
      }
    }
  }

  if (missingTables.length > 0) {
    console.error("");
    console.error(`ERROR: ${missingTables.length} core table(s) missing from production DB:`);
    for (const t of missingTables) console.error(`  - ${t}`);
    console.error("");
    console.error("This means repo migrations have not been fully applied to the cloud project.");
    console.error("Apply migrations first:");
    console.error("  supabase db push --project-ref <project-ref>");
    console.error("  OR provide SUPABASE_ACCESS_TOKEN and re-run this script (it will apply migrations).");
    process.exit(1);
  }

  const migrationCount = await getMigrationCount(client);
  const projectRef = extractProjectRef(env.SUPABASE_URL);

  // ── Build payload ──────────────────────────────────────────────────────────
  const payloadObj = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    source_project_ref: projectRef,
    tables,
    row_counts: rowCounts,
  };
  const payloadJson = JSON.stringify(payloadObj);

  // ── Encrypt ───────────────────────────────────────────────────────────────
  console.log("  encrypting payload...");
  const encrypted = encryptPayload(payloadJson, env.BACKUP_ENCRYPTION_KEY);
  const encFile = join(outputDir, backupFileName(timestamp));
  writeFileSync(encFile, encrypted);

  // ── Checksums ─────────────────────────────────────────────────────────────
  const encChecksum = checksum(encrypted);
  const checksumLine = `${encChecksum}  ${backupFileName(timestamp)}\n`;
  writeFileSync(join(outputDir, "checksums.sha256"), checksumLine);

  // ── Manifest ──────────────────────────────────────────────────────────────
  const manifest = buildManifest({
    timestamp,
    environment: "PRODUCTION",
    projectRef,
    rowCounts,
    migrationCount,
    backupMode: "rest_api",
    encryptedFile: backupFileName(timestamp),
    encryptedChecksum: `sha256:${encChecksum}`,
  });
  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // ── Safety: no raw SQL/JSON left behind (unless BACKUP_KEEP_RAW=1) ────────
  const rawFiles = readdirSync(outputDir).filter(
    (f) => f.endsWith(".sql") || f.endsWith(".json.raw") || (f.endsWith(".json") && f !== "manifest.json"),
  );
  if (rawFiles.length > 0 && !env.BACKUP_KEEP_RAW) {
    for (const f of rawFiles) rmSync(join(outputDir, f));
  }

  // ── Final check: only encrypted + manifest + checksums remain ────────────
  const finalFiles = readdirSync(outputDir);
  const unexpectedRaw = finalFiles.filter((f) => f.endsWith(".sql") || f.endsWith(".json.raw"));
  if (unexpectedRaw.length > 0) {
    throw new Error(`Raw files found in backup dir after cleanup: ${unexpectedRaw.join(", ")}`);
  }

  const totalRows = Object.values(rowCounts).reduce((s, n) => s + n, 0);
  console.log("");
  console.log("RESULT: backup PASSED (BACKUP_CERTIFIED)");
  console.log(`  encrypted archive : ${backupFileName(timestamp)}`);
  console.log(`  checksum          : sha256:${encChecksum}`);
  console.log(`  total rows        : ${totalRows}`);
  console.log(`  timestamp         : ${manifest.created_at}`);
  console.log(`  directory         : ${outputDir}`);
}

main().catch((err) => {
  console.error("backup-production crashed:", err.message);
  process.exit(1);
});
