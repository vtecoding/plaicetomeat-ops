// Static guard: the fail-closed SQL alert-kind registry and the TypeScript
// alert registry must be the same set. A producer kind that exists in only one
// of them either fails at runtime (missing SQL seed) or silently bypasses the
// owner-action registry (missing TS entry) — both are release blockers.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const REGISTRY_FILE = join(process.cwd(), "src", "lib", "domain", "alert-registry.ts");

function fail(message) {
  console.error(`alert-registry parity: FAIL — ${message}`);
  process.exit(1);
}

const registrySource = readFileSync(REGISTRY_FILE, "utf8");
const registryBlock = registrySource.match(/export const ALERT_KINDS = \{([\s\S]*?)\n\} satisfies/);
if (!registryBlock) fail("could not locate the ALERT_KINDS map in alert-registry.ts");
const tsKinds = new Set(
  [...registryBlock[1].matchAll(/^  ([a-z0-9_]+): \{/gm)].map((match) => match[1]),
);
if (tsKinds.size === 0) fail("parsed zero kinds from alert-registry.ts");

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
let seedSql = null;
let seedFile = null;
for (const file of migrationFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const match = sql.match(/INSERT INTO public\.owner_alert_kinds\(kind\) VALUES([\s\S]*?)ON CONFLICT/);
  if (match) {
    seedSql = match[1];
    seedFile = file;
  }
}
if (!seedSql) fail("no migration seeds public.owner_alert_kinds");
const sqlKinds = new Set([...seedSql.matchAll(/\('([a-z0-9_]+)'\)/g)].map((match) => match[1]));

const missingInSql = [...tsKinds].filter((kind) => !sqlKinds.has(kind));
const missingInTs = [...sqlKinds].filter((kind) => !tsKinds.has(kind));
if (missingInSql.length || missingInTs.length) {
  fail(
    `registries diverged (seed: ${seedFile}). Missing in SQL seed: [${missingInSql.join(", ")}]. `
    + `Missing in alert-registry.ts: [${missingInTs.join(", ")}]`,
  );
}

const guardPresent = migrationFiles.some((file) =>
  readFileSync(join(MIGRATIONS_DIR, file), "utf8").includes("owner_alerts_kind_registry_guard"));
if (!guardPresent) fail("the owner_alerts_kind_registry_guard trigger is not created by any migration");

console.log(`alert-registry parity: OK — ${tsKinds.size} kinds match between SQL seed (${seedFile}) and alert-registry.ts; fail-closed trigger present.`);
