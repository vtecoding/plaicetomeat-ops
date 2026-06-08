// V11.1 migration verification — clean-database apply + populated pre-V11 upgrade.
//
// Runs against the local Supabase Postgres container. Creates throwaway databases
// (from template0), bootstraps the minimal Supabase base the repo migrations
// assume (auth.users, auth.uid(), the supabase_realtime publication, the data
// API roles), then:
//   1) CLEAN: applies ALL migrations in order on an empty DB and asserts the
//      V11.1 end-state (legacy reader gone, sealed grants, new columns).
//   2) UPGRADE: applies every migration EXCEPT the two V11.1 ones, seeds a
//      representative pre-V11 order, asserts the pre-V11 hole exists, then applies
//      the V11.1 migrations and asserts the order was backfilled and the hole is
//      closed.
// Exits non-zero on any unmet expectation.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const MIG_DIR = join(process.cwd(), "supabase", "migrations");
const FIRST_V11_VERSION = "202606051200";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS ${name}`);
  else { failures += 1; console.error(`  FAIL ${name} ${detail}`); }
}

function psql(db, sql, { quiet = false } = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"];
  if (quiet) args.push("-q");
  return execFileSync("docker", args, { input: sql, encoding: "utf8" });
}
function query(db, sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

function migrationFiles() {
  return readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
}
function versionOf(file) {
  return file.split("_")[0];
}

function recreate(db) {
  psql("postgres", `DROP DATABASE IF EXISTS ${db} (FORCE); CREATE DATABASE ${db} TEMPLATE template0;`);
  psql(db, BOOTSTRAP);
}

function applyMigrations(db, files) {
  for (const f of files) {
    try {
      psql(db, readFileSync(join(MIG_DIR, f), "utf8"), { quiet: true });
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e.stderr || e.message || "").toString().split("\n").slice(-4).join(" ")}`);
    }
  }
}

function assertV11EndState(db) {
  check(
    "legacy get_public_order removed",
    query(db, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_public_order';") === "0",
  );
  check(
    "cancel_order_by_ref removed",
    query(db, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='cancel_order_by_ref';") === "0",
  );
  check(
    "orders.public_access_id column present",
    query(db, "select count(*) from information_schema.columns where table_name='orders' and column_name='public_access_id';") === "1",
  );
  check(
    "cancel_public_order NOT executable by anon",
    query(db, "select has_function_privilege('anon','public.cancel_public_order(uuid,text,integer)','EXECUTE');") === "f",
  );
  check(
    "cancel_public_order executable by service_role",
    query(db, "select has_function_privilege('service_role','public.cancel_public_order(uuid,text,integer)','EXECUTE');") === "t",
  );
  check(
    "establish_public_order_access NOT executable by anon",
    query(db, "select has_function_privilege('anon','public.establish_public_order_access(text,text)','EXECUTE');") === "f",
  );
  check(
    "get_public_order_status executable by anon (status stays readable)",
    query(db, "select has_function_privilege('anon','public.get_public_order_status(uuid)','EXECUTE');") === "t",
  );
}

function assertV12AuthoritySeal(db) {
  const serviceOnly = [
    "public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb,boolean)",
    "public.check_rate_limit(text,text,integer,integer)",
    "public.establish_public_order_access(text,text)",
    "public.cancel_public_order(uuid,text,integer)",
    "public.emit_audit_log(text,text,uuid,uuid,jsonb,text)",
  ];

  for (const signature of serviceOnly) {
    check(
      `${signature} NOT executable by anon`,
      query(db, `select has_function_privilege('anon','${signature}','EXECUTE');`) === "f",
    );
    check(
      `${signature} NOT executable by authenticated`,
      query(db, `select has_function_privilege('authenticated','${signature}','EXECUTE');`) === "f",
    );
    check(
      `${signature} executable by service_role`,
      query(db, `select has_function_privilege('service_role','${signature}','EXECUTE');`) === "t",
    );
  }

  check(
    "legacy 9-arg create_checkout_order removed",
    query(db, "select to_regprocedure('public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb)') is null;") === "t",
  );
  check(
    "transition_order_status remains authenticated-callable",
    query(db, "select has_function_privilege('authenticated','public.transition_order_status(uuid,text,text)','EXECUTE');") === "t",
  );
}

function main() {
  const files = migrationFiles();

  console.log("V11.1 migration verification");
  console.log(`\n[1] CLEAN database: apply all ${files.length} migrations in order`);
  const cleanDb = "ptm_v11_clean";
  recreate(cleanDb);
  applyMigrations(cleanDb, files);
  check("all migrations applied on clean DB", true);
  assertV11EndState(cleanDb);
  assertV12AuthoritySeal(cleanDb);
  psql("postgres", `DROP DATABASE IF EXISTS ${cleanDb} (FORCE);`);

  console.log("\n[2] UPGRADE: pre-V11 DB with a seeded order, then apply V11+");
  const upDb = "ptm_v11_upgrade";
  recreate(upDb);
  const preV11 = files.filter((f) => versionOf(f) < FIRST_V11_VERSION);
  const v11AndLater = files.filter((f) => versionOf(f) >= FIRST_V11_VERSION);
  applyMigrations(upDb, preV11);

  // Seed a representative pre-V11 order.
  psql(
    upDb,
    `INSERT INTO public.branches(id,name,slug,address,timezone)
       VALUES ('00000000-0000-4000-8000-0000000000aa','Up Test','up-test','1 St','Europe/London');
     INSERT INTO public.branch_settings(branch_id) VALUES ('00000000-0000-4000-8000-0000000000aa');
     INSERT INTO public.orders(branch_id,order_ref,customer_name,customer_phone,pickup_date,subtotal,idempotency_key)
       VALUES ('00000000-0000-4000-8000-0000000000aa','PTM-2000-00001','Upgrade Person','07700900222',current_date,10,'up-1');`,
  );

  // Pre-V11 state: no access-id column; legacy reader present and anon-callable.
  check(
    "pre-V11: orders has NO public_access_id column",
    query(upDb, "select count(*) from information_schema.columns where table_name='orders' and column_name='public_access_id';") === "0",
  );
  check(
    "pre-V11: legacy get_public_order present (the hole)",
    query(upDb, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_public_order';") === "1",
  );

  // Apply V11.1 and later forward-only seals.
  applyMigrations(upDb, v11AndLater);

  // Post-upgrade: existing order backfilled with a unique, non-null access id.
  check(
    "upgrade: seeded order backfilled with public_access_id",
    /^[0-9a-f-]{36}$/.test(query(upDb, "select public_access_id from public.orders where order_ref='PTM-2000-00001';")),
  );
  check(
    "upgrade: public_access_id is NOT NULL on all rows",
    query(upDb, "select count(*) from public.orders where public_access_id is null;") === "0",
  );
  check(
    "upgrade: public_access_version defaults to 1",
    query(upDb, "select public_access_version from public.orders where order_ref='PTM-2000-00001';") === "1",
  );
  assertV11EndState(upDb);
  assertV12AuthoritySeal(upDb);
  psql("postgres", `DROP DATABASE IF EXISTS ${upDb} (FORCE);`);

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} migration check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: clean-apply and pre-V11 upgrade migration checks PASSED");
}

main();
