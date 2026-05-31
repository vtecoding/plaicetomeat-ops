import { spawnSync } from "node:child_process";

const SUITES = {
  smoke: [
    "tests/e2e/hosted-smoke.spec.ts",
    "tests/e2e/auth.spec.ts",
    "tests/e2e/route-protection.spec.ts",
    "tests/e2e/checkout.spec.ts",
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
const env = {
  ...process.env,
  PORT: process.env.PORT ?? "3100",
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL ??
    (isHosted ? process.env.HOSTED_BASE_URL ?? "https://plaicetomeat-ops.vercel.app" : "http://127.0.0.1:3100"),
};

if (!isHosted && process.env.PLAYWRIGHT_SKIP_BUILD !== "true") {
  const buildStatus = run("npm", ["run", "build"], { env });
  if (buildStatus !== 0) process.exit(buildStatus);
}

process.exit(run("npx", ["playwright", "test", ...targets, "--reporter=list"], { env }));
