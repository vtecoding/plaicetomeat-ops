import { execFileSync } from "node:child_process";

import { test } from "@playwright/test";

function shouldResetLocalState() {
  if (process.env.PLAYWRIGHT_SKIP_DB_RESET === "true") return false;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3100";
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(baseUrl);
}

export function resetStateBeforeEach() {
  test.beforeEach(() => {
    if (!shouldResetLocalState()) return;

    execFileSync("node", ["scripts/seed-dev.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
  });
}
