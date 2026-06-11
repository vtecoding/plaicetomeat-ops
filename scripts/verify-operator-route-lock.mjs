// V17 · Operator Route-Lock — live journey proof.
//
// Proves the account boundary on the running app:
//   1. The operator account (operator@ptm.test, manager rank + operator_mode)
//      lands on /operator at login — never /admin.
//   2. It is LOCKED there: navigating to /admin and /counter redirects back to
//      /operator (not /unauthorised, not through to admin).
//   3. The owner account is NOT operator-locked — it still lands on /admin and
//      can reach /admin pages (no regression).
//
// Usage (app running + local Supabase up, after node scripts/seed-dev.mjs):
//   BASE=http://127.0.0.1:3001 node scripts/verify-operator-route-lock.mjs

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL ?? "operator@ptm.test";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@ptm.test";

const observations = [];
const failures = [];
function record(name, ok, detail) {
  observations.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push({ name, detail });
}

async function login(context, email) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  return page;
}

async function landingFor(context, email) {
  const page = await login(context, email);
  const url = new URL(page.url());
  await page.close();
  return url.pathname;
}

async function gotoPath(context, email, path) {
  const page = await login(context, email);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  // Allow any middleware redirect to settle.
  await page.waitForTimeout(500);
  const pathname = new URL(page.url()).pathname;
  await page.close();
  return pathname;
}

async function main() {
  const browser = await chromium.launch();

  // 1. Operator lands on /operator.
  {
    const context = await browser.newContext();
    const landing = await landingFor(context, OPERATOR_EMAIL);
    record("operator account lands on /operator at login", landing === "/operator", landing);
    await context.close();
  }

  // 2. Operator is locked: /admin and /counter bounce back to /operator.
  {
    const context = await browser.newContext();
    const adminDest = await gotoPath(context, OPERATOR_EMAIL, "/admin/today");
    record("operator cannot reach /admin (redirected to /operator)", adminDest === "/operator", adminDest);
    await context.close();
  }
  {
    const context = await browser.newContext();
    const counterDest = await gotoPath(context, OPERATOR_EMAIL, "/counter");
    record("operator cannot reach /counter (redirected to /operator)", counterDest === "/operator", counterDest);
    await context.close();
  }

  // 3. Owner is NOT operator-locked — lands on /admin and reaches admin pages.
  {
    const context = await browser.newContext();
    const landing = await landingFor(context, OWNER_EMAIL);
    record("owner account lands on /admin (not operator-locked)", landing.startsWith("/admin"), landing);
    await context.close();
  }
  {
    const context = await browser.newContext();
    const dest = await gotoPath(context, OWNER_EMAIL, "/admin/settings");
    record("owner still reaches /admin pages (no regression)", dest === "/admin/settings", dest);
    await context.close();
  }

  await browser.close();

  console.log("");
  console.log(failures.length === 0 ? "Operator-route-lock proof PASSED" : `Operator-route-lock proof FAILED with ${failures.length} failure(s)`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-operator-route-lock crashed:", error.message ?? error);
  process.exit(1);
});
