import { spawnSync } from "node:child_process";

const SUITES = {
  smoke: [
    "tests/e2e/hosted-smoke.spec.ts",
    "tests/e2e/auth.spec.ts",
    "tests/e2e/route-protection.spec.ts",
    "tests/e2e/checkout.spec.ts",
  ],
  v18: [
    "tests/e2e/operator-serve.spec.ts",
    "tests/e2e/operator-draft-resume.spec.ts",
    "tests/e2e/operator-pashto.spec.ts",
    "tests/e2e/admin-owner-jobs.spec.ts",
    "tests/e2e/order-corrections.spec.ts",
  ],
  v2_1: [
    "tests/e2e/halal-promise.spec.ts",
    "tests/e2e/admin-suppliers.spec.ts",
    "tests/e2e/admin-inventory.spec.ts",
    "tests/e2e/waste-risk.spec.ts",
    "tests/e2e/admin-action-dashboard.spec.ts",
    "tests/e2e/counter-usability.spec.ts",
    "tests/e2e/customer-trust.spec.ts",
    "tests/e2e/realtime-degraded.spec.ts",
  ],
  v3: [
    "tests/e2e/halal-promise.spec.ts",
    "tests/e2e/admin-suppliers.spec.ts",
    "tests/e2e/admin-inventory.spec.ts",
    "tests/e2e/waste-risk.spec.ts",
    "tests/e2e/admin-pickup-windows.spec.ts",
    "tests/e2e/admin-action-dashboard.spec.ts",
    "tests/e2e/counter-usability.spec.ts",
    "tests/e2e/customer-trust.spec.ts",
  ],
  v4: [
    "tests/e2e/hosted-smoke.spec.ts",
    "tests/e2e/admin-dashboard.spec.ts",
    "tests/e2e/admin-inventory.spec.ts",
    "tests/e2e/admin-suppliers.spec.ts",
    "tests/e2e/v4-ops-intelligence.spec.ts",
  ],
  full: ["tests/e2e"],
  "legacy-audit": ["tests/full-ui-audit.spec.ts", "tests/playwright-ui-audit-clean.spec.ts"],
  hosted: ["tests/e2e/hosted-smoke.spec.ts"],
};

const suite = process.argv[2] ?? "full";
const targets = SUITES[suite];

if (!targets) {
  console.error(`Unknown Playwright suite: ${suite}`);
  console.error(`Known suites: ${Object.keys(SUITES).join(", ")}`);
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

const isHosted = suite === "hosted";
const localCanonicalBranchId = "00000000-0000-4000-8000-000000000001";
const env = {
  ...process.env,
  PORT: process.env.PORT ?? "3100",
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL ??
    (isHosted ? process.env.HOSTED_BASE_URL ?? "https://plaicetomeat-ops.vercel.app" : "http://127.0.0.1:3100"),
  ...(isHosted
    ? {}
    : {
        CANONICAL_BRANCH_ID: process.env.CANONICAL_BRANCH_ID ?? localCanonicalBranchId,
        NEXT_PUBLIC_CANONICAL_BRANCH_ID:
          process.env.NEXT_PUBLIC_CANONICAL_BRANCH_ID ?? localCanonicalBranchId,
        ORDER_ACCESS_SECRET:
          process.env.ORDER_ACCESS_SECRET ?? "local-playwright-order-access-secret-2026-only",
      }),
};

if (!isHosted && process.env.PLAYWRIGHT_SKIP_BUILD !== "true") {
  const buildStatus = run("npm", ["run", "build"], { env });
  if (buildStatus !== 0) process.exit(buildStatus);
}

// Local E2E mutates append-only money/order truth (notably operator counter
// sales), so seed-only cleanup cannot make a second suite run equivalent to the
// first. Reset the disposable local stack once before the suite, then create the
// auth/profile fixtures. Hosted checks and explicit opt-outs remain read-only.
if (!isHosted && process.env.PLAYWRIGHT_SKIP_DB_RESET !== "true") {
  const resetStatus = run("npx", ["supabase", "db", "reset"], { env });
  if (resetStatus !== 0) process.exit(resetStatus);

  const seedStatus = run("node", ["scripts/seed-dev.mjs"], { env });
  if (seedStatus !== 0) process.exit(seedStatus);

}

process.exit(run("npx", ["playwright", "test", ...targets, "--reporter=list"], { env }));
