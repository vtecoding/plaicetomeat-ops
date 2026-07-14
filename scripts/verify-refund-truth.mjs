import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const sql = readFileSync(new URL("../supabase/tests/v18_refund_truth.sql", import.meta.url), "utf8");
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres"], {
  input: sql,
  encoding: "utf8",
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
