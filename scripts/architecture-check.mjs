import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const tierArgIndex = process.argv.findIndex((arg) => arg === "--tier");
const tier = tierArgIndex >= 0 ? process.argv[tierArgIndex + 1] : "static";

function run(command, args) {
  const res = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if ((res.status ?? 1) !== 0) process.exit(res.status ?? 1);
}

function queryLocalDb(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_plaicetomeat-ops", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

if (tier === "static") {
  run("pnpm", [
    "exec",
    "vitest",
    "run",
    "src/lib/server/audit-imports.test.ts",
    "src/lib/server/public-route-imports.test.ts",
  ]);
  run("node", ["scripts/verify-operational-truth.mjs"]);
  process.exit(0);
}

if (tier === "db") {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const expected = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.split("_")[0])
    .sort();

  const applied = queryLocalDb("select version from supabase_migrations.schema_migrations order by version;")
    .split(/\r?\n/)
    .filter(Boolean);
  const appliedSet = new Set(applied);
  const missing = expected.filter((version) => !appliedSet.has(version));

  if (missing.length > 0) {
    console.error(`Architecture DB check failed: missing migrations ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`Architecture DB check passed: ${expected.length} migrations applied locally.`);
  process.exit(0);
}

console.error(`Unknown architecture tier: ${tier}`);
process.exit(1);
