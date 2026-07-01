// Browser guard for the local dev seed.
//
// Usage:
//   BASE=http://127.0.0.1:3100 node scripts/verify-seeded-logins.mjs
//
// Requires the app dev server to be running against a seeded local Supabase stack.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const PASSWORD = process.env.TEST_PASSWORD ?? "PlaiceTest123!";

const CASES = [
  { role: "owner", email: "owner@ptm.test", expectedPath: "/admin/today" },
  { role: "manager", email: "manager@ptm.test", expectedPath: "/admin/today" },
  { role: "staff", email: "staff@ptm.test", expectedPath: "/counter" },
  { role: "operator_mode", email: "operator@ptm.test", expectedPath: "/operator" },
];

function pathOf(url) {
  return new URL(url).pathname;
}

async function signIn(page, email, password = PASSWORD) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {}),
  ]);
  await page.waitForTimeout(500);
}

async function expectPath(page, expectedPath, label) {
  const actual = pathOf(page.url());
  if (actual !== expectedPath) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`${label}: expected ${expectedPath}, got ${actual}\n${body.slice(0, 500)}`);
  }
  console.log(`  ok ${label} -> ${actual}`);
}

async function main() {
  const browser = await chromium.launch();

  try {
    for (const item of CASES) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const page = await context.newPage();
      await signIn(page, item.email);
      await expectPath(page, item.expectedPath, item.role);
      await context.close();
    }

    const wrongContext = await browser.newContext();
    const wrongPage = await wrongContext.newPage();
    await signIn(wrongPage, "owner@ptm.test", "WrongPlaiceTest123!");
    const wrongBody = await wrongPage.locator("body").innerText();
    if (pathOf(wrongPage.url()) !== "/login" || !wrongBody.includes("Invalid email or password")) {
      throw new Error("wrong password did not fail safely");
    }
    console.log("  ok wrong password stays on /login");
    await wrongContext.close();

    const operatorContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const operatorPage = await operatorContext.newPage();
    await signIn(operatorPage, "operator@ptm.test");
    await expectPath(operatorPage, "/operator", "operator initial landing");

    for (const forbiddenPath of ["/admin", "/counter"]) {
      await operatorPage.goto(`${BASE}${forbiddenPath}`, { waitUntil: "domcontentloaded" });
      await operatorPage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await expectPath(operatorPage, "/operator", `operator blocked from ${forbiddenPath}`);
    }
    await operatorContext.close();
  } finally {
    await browser.close();
  }

  console.log("Seeded login guard passed.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
