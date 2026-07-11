// restore-backup-scratch.mjs — Phase-1 remediation recovery drill (PTM-DR-001).
//
// Decrypts a full-logical backup (from backup-production-full.mjs), restores it
// into an ISOLATED scratch Postgres, and validates recoverability. NEVER point
// SCRATCH_PSQL at production.
//
// Required env:
//   BACKUP_FILE            path to the .backup.enc bundle
//   BACKUP_ENCRYPTION_KEY  the key used to create it
//   SCRATCH_PSQL           a psql command that targets the scratch DB, e.g.
//                          "docker exec -i supabase_db_x psql -U postgres -d ptm_scratch"
//                          or "psql postgresql://postgres:pw@127.0.0.1:5432/ptm_scratch"
//
// The scratch DB must already have the Supabase prerequisites (auth/extensions/
// vault schemas + roles). See docs/runbooks/ptm-phase1-recovery.md for bootstrap.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { decryptPayload } from "./backup-lib.mjs";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required but not set`);
  return v;
}

// SQL is fed over STDIN so the helper works identically for a direct `psql ...`
// connection string and a `docker exec -i ... psql ...` wrapper (the host temp
// file is not visible inside a container, so -f cannot be used).
function runSql(sql) {
  const base = need("SCRATCH_PSQL");
  return execSync(`${base} -v ON_ERROR_STOP=0`, {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function query(sql) {
  const base = need("SCRATCH_PSQL");
  return execSync(`${base} -tA`, { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`); }
}

function main() {
  const file = need("BACKUP_FILE");
  const key = need("BACKUP_ENCRYPTION_KEY");
  console.log(`restore-backup-scratch: decrypting ${file}`);
  const payload = JSON.parse(decryptPayload(readFileSync(file), key).toString("utf8"));
  const parts = payload.parts ?? {};

  // Restore order: auth schema, public schema, storage schema, then data (triggers off).
  console.log("restore-backup-scratch: restoring schema...");
  for (const key2 of ["schema_auth", "schema_public", "schema_storage"]) {
    if (parts[key2]) runSql(parts[key2]);
  }
  console.log("restore-backup-scratch: restoring data...");
  for (const key2 of ["data_auth", "data_public", "data_storage"]) {
    if (parts[key2]) runSql(`SET session_replication_role=replica;\n${parts[key2]}`);
  }

  console.log("restore-backup-scratch: validating...");
  const tables = Number(query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"));
  const rlsOn = query("SELECT count(*) FILTER (WHERE rowsecurity)||'/'||count(*) FROM pg_tables WHERE schemaname='public';");
  const authUsers = Number(query("SELECT count(*) FROM auth.users;"));
  const orphanProfiles = Number(query("SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL;"));
  const orders = Number(query("SELECT count(*) FROM public.orders;"));

  check("public base tables restored", tables >= 40, `tables=${tables}`);
  const [rlsCount, rlsTotal] = rlsOn.split("/").map(Number);
  check("RLS enabled on every public table", rlsCount === rlsTotal && rlsTotal > 0, `rls=${rlsOn}`);
  check("auth users restored (login reconstruction)", authUsers > 0, `auth.users=${authUsers}`);
  check("profiles reconcile to auth.users (no orphans)", orphanProfiles === 0, `orphans=${orphanProfiles}`);
  check("critical business data present", orders > 0, `orders=${orders}`);

  console.log("");
  console.log(`Scratch restore drill: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

try {
  main();
} catch (err) {
  console.error("restore-backup-scratch crashed:", err.message);
  process.exitCode = 2;
}
