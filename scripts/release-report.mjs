import { spawnSync } from "node:child_process";

const results = [];

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = (result.status ?? 1) === 0;
  results.push([label, ok]);
  return ok;
}

run("Typecheck", "npx", ["tsc", "--noEmit"]);
run("Lint", "npx", ["eslint", "."]);
run("Unit", "npx", ["vitest", "run"]);
run("Build", "npm", ["run", "build"]);
run("Ops Verify", "node", ["scripts/verify-ops.mjs"]);

const playwrightEnv = {
  PLAYWRIGHT_SKIP_BUILD: "true",
  PORT: "3100",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
};

run("Playwright Smoke", "node", ["scripts/run-playwright.mjs", "smoke"], { env: playwrightEnv });
run("Playwright V2.1", "node", ["scripts/run-playwright.mjs", "v2_1"], { env: playwrightEnv });
run("Playwright Full", "node", ["scripts/run-playwright.mjs", "full"], { env: playwrightEnv });

run("Hosted Smoke", "node", ["scripts/run-playwright.mjs", "hosted"], {
  env: {
    NEXT_PUBLIC_APP_URL: process.env.HOSTED_BASE_URL ?? "https://plaicetomeat-ops.vercel.app",
    PLAYWRIGHT_SKIP_DB_RESET: "true",
  },
});

const required = results.every(([, ok]) => ok);

console.log("");
for (const [label, ok] of results) {
  console.log(`${label}: ${ok ? "PASS" : "FAIL"}`);
}
console.log(`Release Recommendation: ${required ? "PASS" : "FAIL"}`);

process.exit(required ? 0 : 1);
