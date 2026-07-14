// Proves the production worker loader can execute its TypeScript domain imports.
// Empty credentials deliberately stop execution at the worker's explicit guard,
// after every static import has loaded successfully.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/owner-alert-worker.mjs"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  },
);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const expected = "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.";
if (result.status === 0 || !output.includes(expected)) {
  console.error(output.trim());
  throw new Error(`Owner-alert worker did not reach its explicit missing-environment guard (status ${result.status}).`);
}

console.log("PASS owner-alert worker loaded all TypeScript modules and reached the missing-environment guard.");
