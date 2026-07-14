import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const sql = readFileSync(new URL("../supabase/tests/v18_amendment_depletion.sql", import.meta.url), "utf8");
const db = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres"], {
  input: sql,
  encoding: "utf8",
});
process.stdout.write(db.stdout ?? "");
process.stderr.write(db.stderr ?? "");
if ((db.status ?? 1) !== 0) process.exit(db.status ?? 1);

const parity = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "src/lib/domain/order-corrections.db.test.ts"],
  { encoding: "utf8", env: { ...process.env, V18_DB_PARITY: "1" } },
);
process.stdout.write(parity.stdout ?? "");
process.stderr.write(parity.stderr ?? "");
if ((parity.status ?? 1) !== 0) process.exit(parity.status ?? 1);
