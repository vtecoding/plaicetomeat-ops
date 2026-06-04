import { spawnSync } from "node:child_process";

const releaseMode = (process.env.RELEASE_REPORT_MODE ?? "release").toLowerCase();
const isLocalOnlyMode = releaseMode === "local" || releaseMode === "dev";
const isProductionClosureMode = releaseMode === "release" || releaseMode === "ci";
const driftMode = (process.env.MIGRATION_DRIFT_CHECK_MODE ?? "release").toLowerCase();
const isLocalOnlyDriftMode = driftMode === "local" || driftMode === "dev";

const results = [];
const localPlaywrightPort = process.env.RELEASE_PLAYWRIGHT_PORT ?? "4173";

if (isProductionClosureMode && isLocalOnlyDriftMode) {
  console.error(
    "Release assertion failed: MIGRATION_DRIFT_CHECK_MODE=local|dev is not allowed when RELEASE_REPORT_MODE=release|ci.",
  );
  process.exit(1);
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", ...(options.env ?? {}) },
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    shell: process.platform === "win32",
  });

  if (options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  const status = result.status ?? 1;
  const ok = status === 0;
  results.push({ label, status: ok ? "PASS" : "FAIL" });
  return { ok, status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

run("Typecheck", "npx", ["tsc", "--noEmit"]);
run("Lint", "npx", ["eslint", "."]);
run("Unit", "npx", ["vitest", "run"]);
run("Build", "npm", ["run", "build"]);
run("Ops Verify", "node", ["scripts/verify-ops.mjs"]);
run("Ops Capture Verify", "node", ["scripts/verify-ops-capture.mjs"]);

if (isLocalOnlyMode) {
  const playwrightEnv = {
    PLAYWRIGHT_SKIP_BUILD: "true",
    PORT: localPlaywrightPort,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${localPlaywrightPort}`,
  };

  run("Playwright Smoke", "node", ["scripts/run-playwright.mjs", "smoke"], { env: playwrightEnv });
  run("Playwright V3", "node", ["scripts/run-playwright.mjs", "v3"], { env: playwrightEnv });
  run("Playwright V4", "node", ["scripts/run-playwright.mjs", "v4"], { env: playwrightEnv });
  run("Playwright Full", "node", ["scripts/run-playwright.mjs", "full"], { env: playwrightEnv });
}

const hostedAppUrl = isLocalOnlyMode
  ? process.env.NEXT_PUBLIC_APP_URL ?? process.env.HOSTED_BASE_URL ?? "http://127.0.0.1:3000"
  : process.env.HOSTED_BASE_URL ?? "https://plaicetomeat-ops.vercel.app";
if (isLocalOnlyMode) {
  results.push({ label: "Migration Drift Check", status: "SKIPPED_LOCAL_ONLY" });
  console.log("Migration Drift Check: SKIPPED_LOCAL_ONLY");
  run("Hosted Smoke", "node", ["scripts/run-playwright.mjs", "hosted"], {
    env: {
      PORT: localPlaywrightPort,
      NEXT_PUBLIC_APP_URL: hostedAppUrl,
      PLAYWRIGHT_SKIP_BUILD: "true",
      PLAYWRIGHT_SKIP_DB_RESET: "true",
    },
  });
} else {
  const migrationDriftEnv = { MIGRATION_DRIFT_CHECK_MODE: "release" };
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceRoleKey) {
    migrationDriftEnv.SUPABASE_URL = supabaseUrl;
    migrationDriftEnv.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
    migrationDriftEnv.SUPABASE_SERVICE_ROLE_KEY = supabaseServiceRoleKey;
  } else {
    console.warn("Release env not present; using linked Supabase CLI fallback for migration drift.");
  }

  const migrationResult = run("Migration Drift Check", "node", ["scripts/check-migrations.mjs"], {
    env: migrationDriftEnv,
    capture: true,
  });
  const migrationStatusMatch = migrationResult.stdout.match(/Migration Drift Check: (PASS|FAIL|SKIPPED_LOCAL_ONLY)/);
  if (migrationStatusMatch) {
    results[results.length - 1].status = migrationStatusMatch[1];
  }

  run("Hosted Smoke", "node", ["scripts/run-playwright.mjs", "hosted"], {
    env: {
      PORT: localPlaywrightPort,
      NEXT_PUBLIC_APP_URL: hostedAppUrl,
      PLAYWRIGHT_SKIP_DB_RESET: "true",
    },
  });
}

const required = results.every(({ label, status }) => {
  if (status === "PASS") return true;
  if (label === "Migration Drift Check" && status === "SKIPPED_LOCAL_ONLY") return isLocalOnlyMode;
  return false;
});

console.log("");
console.log(`Release Report Mode: ${releaseMode}`);
console.log(`Hosted App URL: ${hostedAppUrl}`);
console.log(`Deployment Identity: ${process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? "unavailable"}`);
for (const { label, status } of results) {
  console.log(`${label}: ${status}`);
}
console.log(`Release Recommendation: ${required ? "PASS" : "FAIL"}`);

process.exit(required ? 0 : 1);
