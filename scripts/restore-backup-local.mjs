// restore-backup-local.mjs
// V13.4 — decrypts a production backup archive and restores data to a
// throwaway Supabase project. NEVER run against the production project.
//
// Required env:
//   BACKUP_FILE                          path to the .backup.enc file
//   BACKUP_ENCRYPTION_KEY                the key used to create the backup
//   RESTORED_SUPABASE_URL                URL of the throwaway Supabase project
//   RESTORED_SUPABASE_SERVICE_ROLE_KEY   service role key for the restored project
//
// Optional:
//   SUPABASE_ACCESS_TOKEN                — personal access token from supabase.com/dashboard/account/tokens
//                                          Required to: apply migrations, seed branches, create auth users.
//   SOURCE_SUPABASE_URL                  — source project URL; used to fetch branches and branch_settings
//   SOURCE_SUPABASE_SERVICE_ROLE_KEY     — source project service role key
//
// After restore, run:
//   RECOVERY_ENVIRONMENT=PRODUCTION STRICT=1 \
//   SOURCE_SUPABASE_URL=<prod> SOURCE_SUPABASE_SERVICE_ROLE_KEY=<prod key> \
//   RESTORED_SUPABASE_URL=<throwaway> RESTORED_SUPABASE_SERVICE_ROLE_KEY=<throwaway key> \
//   node scripts/verify-disaster-recovery.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { decryptPayload, extractProjectRef, RESTORE_ORDER } from "./backup-lib.mjs";

const BATCH_SIZE = 500;

// ─── SQL helpers ──────────────────────────────────────────────────────────────

function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    // Postgres array literal: '{1,2,3}' for int[] or '{"a","b"}' for text[]
    const items = v.map((item) => {
      if (item === null || item === undefined) return "NULL";
      if (typeof item === "number" || typeof item === "boolean") return String(item);
      // String items need quoting inside the array literal
      return `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    });
    return `'{${items.join(",")}}'`;
  }
  if (typeof v === "object") {
    // JSON object — cast as jsonb
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

function buildInsertSql(table, row) {
  const cols = Object.keys(row);
  const vals = cols.map((k) => sqlLiteral(row[k]));
  return `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT (id) DO NOTHING;`;
}

// ─── Management API helpers ───────────────────────────────────────────────────

async function executeManagementQuery(projectRef, accessToken, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    const body = await response.text();
    return { ok: false, body };
  }
  return { ok: true, body: "" };
}

// ─── Migration application ────────────────────────────────────────────────────

async function applyMigrationsViaApi(projectRef, accessToken) {
  const migrationsDir = resolve(process.cwd(), "supabase", "migrations");
  let files;
  try {
    files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.warn("  WARNING: supabase/migrations/ not found — skipping schema setup");
    return 0;
  }
  console.log(`  Applying ${files.length} migrations via Supabase management API...`);
  let applied = 0;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    let response;
    try {
      response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
    } catch (err) {
      console.warn(`  WARNING: network error applying ${file}: ${err.message}`);
      continue;
    }
    if (!response.ok) {
      const body = await response.text();
      // Many migration errors are benign (table already exists etc.) — log but continue
      const preview = body.slice(0, 120).replace(/\n/g, " ");
      console.warn(`  WARN ${file}: HTTP ${response.status} — ${preview}`);
    } else {
      applied++;
      process.stdout.write(".");
    }
  }
  console.log(`\n  Applied: ${applied}/${files.length}`);
  return applied;
}

// ─── Prerequisite seeding from source ────────────────────────────────────────
//
// These tables are FK prerequisites for the backed-up core tables but are NOT
// themselves exported in the backup (they are config/setup tables populated by
// the app, not by migrations). We fetch them from the SOURCE project.
//
// Seed order (respects inter-table FKs):
//   branches → product_categories, branch_settings, pickup_windows
//
// branches reference no app tables so go first.
// product_categories and pickup_windows reference branches.
// branch_settings references branches.

const SEED_TABLES_IN_ORDER = [
  "branches",           // no app-table FKs — goes first
  "branch_settings",    // references branches
  "product_categories", // references branches — needed by products.category_id
  "suppliers",          // references branches (nullable) — needed by inventory_batches.supplier_id
  "pickup_windows",     // references branches — needed by orders.pickup_window_id
];

async function seedFromSource(sourceUrl, sourceKey, restoredProjectRef, accessToken) {
  const sourceClient = createClient(sourceUrl, sourceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const table of SEED_TABLES_IN_ORDER) {
    const { data: rows, error } = await sourceClient.from(table).select("*");
    if (error) {
      console.warn(`  WARN fetching ${table} from source: ${error.message}`);
      continue;
    }
    const count = rows?.length ?? 0;
    console.log(`  seeding ${table}: ${count} row(s) from source`);
    for (const row of rows ?? []) {
      const sql = buildInsertSql(table, row);
      const { ok, body } = await executeManagementQuery(restoredProjectRef, accessToken, sql);
      if (!ok && !body.includes("duplicate key") && !body.includes("already exists")) {
        console.warn(`  WARN inserting ${table} row ${row.id ?? "?"}: ${body.slice(0, 100)}`);
      }
    }
  }

  console.log(`  prerequisite tables seeded OK`);
}

// ─── Auth user creation ───────────────────────────────────────────────────────
//
// profiles.id is a FK → auth.users.id. Before inserting profiles we must
// ensure every referenced auth user exists in the restored project.
// We use the profiles backup data (which contains email) to recreate users.
// Passwords are set to a drill-specific placeholder — the throwaway project
// is ephemeral and these credentials are never used for real access.
//
// The correct endpoint is the GoTrue admin API on the PROJECT URL:
//   POST https://{ref}.supabase.co/auth/v1/admin/users
// authenticated with the SERVICE ROLE KEY (not the management API access token).
// The management API (/v1/projects/{ref}/auth/users) does NOT exist for user creation.

async function createAuthUsers(restoredUrl, restoredServiceRoleKey, profiles) {
  console.log(`  creating ${profiles.length} auth user(s) in restored project...`);
  const authAdminUrl = `${restoredUrl.replace(/\/$/, "")}/auth/v1/admin/users`;
  let ready = 0;
  for (const profile of profiles) {
    if (!profile.id || !profile.email) {
      console.warn(`  WARN profile missing id or email — skipping auth user creation`);
      continue;
    }
    const response = await fetch(authAdminUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${restoredServiceRoleKey}`,
        apikey: restoredServiceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: profile.id,
        email: profile.email,
        email_confirm: true,
        // Placeholder password — throwaway project only, never used for production access
        password: `RecoveryDrill-${profile.id.slice(0, 8)}!`,
      }),
    });
    if (response.ok) {
      ready++;
    } else {
      const body = await response.text();
      // 422 = email already registered (idempotent re-run) — count as OK
      if (body.includes("already") || body.includes("registered") || response.status === 422) {
        ready++;
      } else {
        console.warn(
          `  WARN creating auth user ${profile.id}: HTTP ${response.status} — ${body.slice(0, 100)}`,
        );
      }
    }
  }
  console.log(`  auth users: ${ready}/${profiles.length} ready`);
  return ready;
}

// ─── Table restore ────────────────────────────────────────────────────────────

async function restoreTable(client, table, rows) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // upsert with ignoreDuplicates: true → INSERT ... ON CONFLICT (id) DO NOTHING
    // This is safe for append-only tables like audit_logs that have triggers blocking UPDATE
    // (no UPDATE is attempted when a row already exists — it's silently skipped).
    // Re-running is idempotent: existing rows are left untouched.
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`${table} batch at ${i}: ${error.message}`);
    inserted += batch.length;
  }
  return inserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const backupFile = process.env.BACKUP_FILE;
  const encKey = process.env.BACKUP_ENCRYPTION_KEY;
  const restoredUrl = process.env.RESTORED_SUPABASE_URL;
  const restoredKey = process.env.RESTORED_SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? null;
  const productionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const sourceUrl = process.env.SOURCE_SUPABASE_URL ?? null;
  const sourceKey = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY ?? null;

  if (!backupFile) throw new Error("BACKUP_FILE is required");
  if (!encKey) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  if (!restoredUrl) throw new Error("RESTORED_SUPABASE_URL is required");
  if (!restoredKey) throw new Error("RESTORED_SUPABASE_SERVICE_ROLE_KEY is required");

  // Safety: refuse to restore over production
  if (productionUrl && restoredUrl.trim() === productionUrl.trim()) {
    throw new Error(
      "SAFETY ABORT: RESTORED_SUPABASE_URL matches the production URL. Never restore over production.",
    );
  }

  console.log("restore-backup-local: starting");
  console.log(`  backup file : ${backupFile}`);
  console.log(`  target      : ${restoredUrl}`);
  console.log(`  schema      : ${accessToken ? "will apply via management API" : "SUPABASE_ACCESS_TOKEN not set — tables must be pre-created"}`);
  console.log(`  branches    : ${sourceUrl ? "will fetch from source project" : "SOURCE_SUPABASE_URL not set — must be pre-seeded"}`);

  // ── Step 1: Decrypt ──────────────────────────────────────────────────────────
  const ciphertext = readFileSync(resolve(backupFile));
  console.log("  decrypting...");
  const plaintext = decryptPayload(ciphertext, encKey);
  const backup = JSON.parse(plaintext.toString("utf8"));
  console.log(`  decrypted OK — exported at ${backup.exported_at}`);
  console.log(`  source rows : ${Object.values(backup.row_counts ?? {}).reduce((s, n) => s + n, 0)}`);

  const projectRef = extractProjectRef(restoredUrl);

  // ── Step 2: Apply migrations (schema setup) ──────────────────────────────────
  if (accessToken) {
    await applyMigrationsViaApi(projectRef, accessToken);
  } else {
    console.warn("");
    console.warn("  SUPABASE_ACCESS_TOKEN not provided.");
    console.warn("  Without migrations applied, the upsert step will fail with 'table not found'.");
    console.warn("");
  }

  // ── Step 3: Seed prerequisite tables from source ─────────────────────────────
  // branches, product_categories, pickup_windows etc. must exist before
  // profiles/products/orders can be inserted (FK deps).
  if (accessToken && sourceUrl && sourceKey) {
    console.log("  seeding prerequisite tables from source project...");
    await seedFromSource(sourceUrl, sourceKey, projectRef, accessToken);
  } else {
    if (!sourceUrl || !sourceKey) {
      console.warn("  WARN: SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY not set.");
      console.warn("  Prerequisite tables (branches, product_categories, pickup_windows) will not be seeded.");
      console.warn("  Tables with FK deps on these will fail to insert.");
    }
    if (!accessToken) {
      console.warn("  WARN: SUPABASE_ACCESS_TOKEN not set — cannot seed via management API.");
    }
  }

  // ── Step 4: Create auth users ────────────────────────────────────────────────
  // profiles.id is a FK → auth.users.id. Create users before inserting profiles.
  // Uses the GoTrue admin API on the restored project URL with service role key.
  const profiles = backup.tables?.profiles ?? [];
  if (profiles.length > 0) {
    console.log("  creating auth users for profile records...");
    await createAuthUsers(restoredUrl, restoredKey, profiles);
  }

  // ── Step 5: Restore data ─────────────────────────────────────────────────────
  const client = createClient(restoredUrl, restoredKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("  restoring tables...");
  const restored = {};
  let anyFailed = false;
  for (const table of RESTORE_ORDER) {
    const rows = backup.tables[table] ?? [];
    try {
      const inserted = await restoreTable(client, table, rows);
      restored[table] = inserted;
      console.log(`  ${table}: ${inserted} rows`);
    } catch (err) {
      console.error(`  FAIL ${table}: ${err.message}`);
      restored[table] = 0;
      anyFailed = true;
    }
  }

  const totalRestored = Object.values(restored).reduce((s, n) => s + n, 0);
  const totalSource = Object.values(backup.row_counts ?? {}).reduce((s, n) => s + n, 0);
  const parity = totalRestored === totalSource;

  console.log("");
  console.log(`RESULT: restore ${parity && !anyFailed ? "PASSED" : "INCOMPLETE"}`);
  console.log(`  source rows   : ${totalSource}`);
  console.log(`  restored rows : ${totalRestored}`);
  if (!parity) {
    const delta = totalSource - totalRestored;
    console.warn(`  WARNING: ${Math.abs(delta)} row(s) not restored`);
    if (!accessToken) {
      console.warn("  Likely cause: migrations not applied. Re-run with SUPABASE_ACCESS_TOKEN set.");
    }
  }
  console.log("");
  console.log("Next step: run verify-disaster-recovery.mjs to certify parity and integrity.");
  console.log(
    `  RECOVERY_ENVIRONMENT=PRODUCTION STRICT=1 SOURCE_SUPABASE_URL=${sourceUrl ?? "<prod>"} ...`,
  );

  if (anyFailed) process.exit(1);
}

main().catch((err) => {
  console.error("restore-backup-local crashed:", err.message);
  process.exit(1);
});
