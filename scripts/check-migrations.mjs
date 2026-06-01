import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const v3MigrationPath = join(migrationsDir, "202606011430_v3_operational_system.sql");
const v4MigrationPath = join(migrationsDir, "202606011900_v4_operations_intelligence.sql");
const v5MigrationPath = join(migrationsDir, "202606012030_v5_action_intelligence.sql");
const driftMode = (process.env.MIGRATION_DRIFT_CHECK_MODE ?? "release").toLowerCase();
const isLocalOnlyMode = driftMode === "local" || driftMode === "dev";

if (isLocalOnlyMode) {
  console.log("Migration Drift Check: SKIPPED_LOCAL_ONLY");
  process.exit(0);
}

if (!existsSync(v3MigrationPath)) {
  console.error("Missing V3 operational migration.");
  process.exit(1);
}

if (!existsSync(v4MigrationPath)) {
  console.error("Missing V4 operations intelligence migration.");
  process.exit(1);
}

if (!existsSync(v5MigrationPath)) {
  console.error("Missing V5 action intelligence migration.");
  process.exit(1);
}

const v3Sql = readFileSync(v3MigrationPath, "utf8");
const v4Sql = readFileSync(v4MigrationPath, "utf8");
const v5Sql = readFileSync(v5MigrationPath, "utf8");
const requiredV3 = [
  "CREATE TABLE IF NOT EXISTS public.audit_events",
  "CREATE TABLE IF NOT EXISTS public.inventory_waste_events",
  "CREATE OR REPLACE FUNCTION public.admin_update_branch_settings",
  "CREATE OR REPLACE FUNCTION public.admin_adjust_inventory_remaining",
];
const requiredV4 = [
  "CREATE TABLE IF NOT EXISTS public.release_deployments",
  "CREATE TABLE IF NOT EXISTS public.release_verifications",
  "CREATE TABLE IF NOT EXISTS public.release_certifications",
  "CREATE OR REPLACE FUNCTION public.get_migration_health",
  "CREATE OR REPLACE FUNCTION public.certify_release",
];

const missing = [
  ...requiredV3.filter((needle) => !v3Sql.includes(needle)),
  ...requiredV4.filter((needle) => !v4Sql.includes(needle)),
  ..."202606012030 v5_action_intelligence".split(" ").filter((needle) => !v5Sql.includes(needle)),
];
if (missing.length > 0) {
  console.error(`Migration contract is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const expected = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.split("_")[0])
  .sort();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (url && serviceKey) {
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("get_applied_migration_versions");

  if (!error) {
    const applied = new Set((data ?? []).map((row) => String(row.version)));
    const missingApplied = expected.filter((version) => !applied.has(version));

    if (missingApplied.length > 0) {
      console.error(`Migration Drift Check: FAIL missing ${missingApplied.join(", ")}`);
      process.exit(1);
    }

    console.log("Migration Drift Check: PASS");
    console.log("Migration Check: V3 and V4 migrations present.");
    process.exit(0);
  }

  const fallbackReasons = ["schema cache", "not find the function", "Could not find the function"];
  const useCliFallback = fallbackReasons.some((reason) => error.message.includes(reason));

  if (!useCliFallback) {
    console.error(`Migration Drift Check: FAIL (${error.message})`);
    process.exit(1);
  }
}

const cliResult = spawnSync("npx", ["supabase", "migration", "list", "--linked"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  shell: process.platform === "win32",
});

if ((cliResult.status ?? 1) !== 0) {
  const message = (cliResult.stderr || cliResult.stdout || "Unable to run linked migration list").trim();
  console.error(`Migration Drift Check: FAIL (${message})`);
  process.exit(1);
}

const remoteVersions = new Set();
for (const line of (cliResult.stdout ?? "").split(/\r?\n/)) {
  const match = line.match(/^\s*(\d{12})\s*\|\s*(\d{12})?\s*\|/);
  if (match?.[2]) remoteVersions.add(match[2]);
}

const missingApplied = expected.filter((version) => !remoteVersions.has(version));

if (missingApplied.length > 0) {
  console.error(`Migration Drift Check: FAIL missing ${missingApplied.join(", ")}`);
  process.exit(1);
}

console.log("Migration Drift Check: PASS");
console.log("Migration Check: V3 and V4 migrations present.");
