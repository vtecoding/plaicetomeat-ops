#!/usr/bin/env node
// Static tripwire for the two P0 truth boundaries. The DB battery proves runtime
// behaviour; this guard prevents a later migration/source edit from silently
// removing the forward seal before DB-dependent CI runs.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202608130900_p0_truth_and_schema_compatibility.sql"),
  "utf8",
);

const required = [
  "CREATE CONSTRAINT TRIGGER orders_collected_requires_sale_tender",
  "DEFERRABLE INITIALLY DEFERRED",
  "FROM public.payment_events pe",
  "pe.direction = 'sale'",
  "REVOKE ALL ON FUNCTION public.admin_reverse_order_inventory(uuid, text)",
  "FROM PUBLIC, anon, authenticated, service_role",
  "CREATE TABLE public.application_schema_contract",
  "CREATE OR REPLACE FUNCTION public.get_application_schema_contract_v1()",
  "CREATE OR REPLACE FUNCTION public.get_application_schema_versions_v1()",
];

const missing = required.filter((contract) => !migration.includes(contract));
if (missing.length > 0) {
  console.error(`p0-truth-boundaries: FAIL - missing contracts: ${missing.join(" | ")}`);
  process.exit(1);
}

if (migration.includes("REVOKE ALL ON FUNCTION public.get_applied_migration_versions()")) {
  console.error("p0-truth-boundaries: FAIL - expand migration retires generation 18 before generation 19 promotion");
  process.exit(1);
}

const postSealSql = readdirSync(join(process.cwd(), "supabase", "migrations"))
  .filter((file) => file.endsWith(".sql") && file.split("_")[0] >= "202608130900")
  .sort()
  .map((file) => readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8"))
  .join("\n");
if (/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_reverse_order_inventory/iu.test(postSealSql)) {
  console.error("p0-truth-boundaries: FAIL - a post-seal migration re-grants the legacy reversal");
  process.exit(1);
}

const applicationSources = [
  "src/app/actions/counter.ts",
  "src/app/actions/operator/serve.ts",
  "src/app/actions/order-corrections.ts",
].map((file) => ({ file, source: readFileSync(join(process.cwd(), file), "utf8") }));

const legacyCallers = applicationSources
  .filter(({ source }) => source.includes('rpc("admin_reverse_order_inventory"') || source.includes("rpc('admin_reverse_order_inventory'"))
  .map(({ file }) => file);
if (legacyCallers.length > 0) {
  console.error(`p0-truth-boundaries: FAIL - legacy reversal caller(s): ${legacyCallers.join(", ")}`);
  process.exit(1);
}

console.log("p0-truth-boundaries: PASS - tendered collection constrained; legacy reversal sealed");
