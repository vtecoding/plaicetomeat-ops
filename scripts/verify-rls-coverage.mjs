// RLS coverage guard — every table in public must have ROW LEVEL SECURITY enabled.
//
// Why this matters here specifically: 202607011300_service_role_api_grants.sql sets
// ALTER DEFAULT PRIVILEGES so every FUTURE table is SELECT-granted to anon and
// authenticated the moment it is created. With RLS enabled that grant is harmless
// (policies decide rows); with RLS forgotten it is a public data leak. This static
// scan makes "CREATE TABLE without ENABLE ROW LEVEL SECURITY" a failing gate instead
// of a silent fail-open default.
//
// Pure source scan of supabase/migrations — no running database needed (static tier).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const created = new Set();
const rlsEnabled = new Set();
const dropped = new Set();

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    // strip line comments so commented-out DDL never counts
    .replace(/--[^\n]*/g, "");

  for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    created.add(match[1].toLowerCase());
    dropped.delete(match[1].toLowerCase());
  }
  for (const match of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/gi)) {
    rlsEnabled.add(match[1].toLowerCase());
  }
  for (const match of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    dropped.add(match[1].toLowerCase());
  }
}

const missing = [...created].filter((table) => !rlsEnabled.has(table) && !dropped.has(table)).sort();

console.log(`RLS coverage: ${created.size} table(s) created, ${dropped.size} later dropped.`);

if (missing.length > 0) {
  console.error("\nFAIL — table(s) created without ENABLE ROW LEVEL SECURITY:");
  for (const table of missing) console.error(`  - public.${table}`);
  console.error(
    "\nEvery new table is auto-granted SELECT to anon/authenticated by the default-privileges\n" +
      "migration; without RLS that is a public data leak. Add\n" +
      "  ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;\n" +
      "plus explicit policies in the same migration.",
  );
  process.exit(1);
}

console.log("PASS — every created (non-dropped) table enables row level security.");
