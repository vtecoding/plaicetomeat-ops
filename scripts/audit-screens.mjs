// One-off audit capture: log in as owner and screenshot every key screen.
// Usage: BASE=http://localhost:54945 node scripts/audit-screens.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:54945";
const OUT = "docs/audit-2026-06/screens";
mkdirSync(OUT, { recursive: true });

const DESKTOP = [
  ["public-home", "/"],
  ["public-shop", "/shop"],
  ["public-halal", "/our-halal-promise"],
  ["public-basket", "/basket"],
  ["login", "/login"],
  ["admin-today", "/admin/today"],
  ["admin-today-walk", "/admin/today/walk"],
  ["admin-business-insights", "/admin"],
  ["admin-briefing", "/admin/briefing"],
  ["admin-orders", "/admin/orders"],
  ["admin-inventory", "/admin/inventory"],
  ["admin-purchasing", "/admin/purchasing"],
  ["admin-products", "/admin/products"],
  ["admin-compliance", "/admin/compliance"],
  ["admin-open", "/admin/open"],
  ["admin-close", "/admin/close"],
  ["admin-stock-count", "/admin/stock-count"],
  ["admin-pickup-windows", "/admin/pickup-windows"],
  ["admin-shop-closures", "/admin/shop-closures"],
  ["admin-cutting-guide", "/admin/cutting-guide"],
  ["admin-guide", "/admin/guide"],
  ["admin-settings", "/admin/settings"],
  ["admin-setup", "/admin/setup"],
  ["admin-audit", "/admin/audit"],
  ["admin-releases", "/admin/releases"],
  ["admin-validation-pricing", "/admin/validation/pricing"],
  ["counter", "/counter"],
  ["counter-compliance", "/counter/compliance"],
];

const MOBILE = [
  ["m-admin-today", "/admin/today"],
  ["m-counter", "/counter"],
  ["m-public-shop", "/shop"],
];

const KILL_ANIM = `*{animation:none!important;transition:none!important;scroll-behavior:auto!important} nextjs-portal{display:none!important}`;

async function snap(page, name) {
  try {
    await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const h1 = await page.locator("h1").first().textContent().catch(() => "");
    console.log(`  OK  ${name}  <${(h1 || "").trim().slice(0, 50)}>`);
  } catch (e) {
    console.log(`  ERR ${name}: ${e.message.split("\n")[0]}`);
  }
}

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();

  console.log("Logging in...");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill("#email", "owner@ptm.test");
  await page.fill("#password", "PlaiceTest123!");
  await Promise.all([
    page.waitForURL("**/admin/**", { timeout: 90000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  console.log("Landed:", new URL(page.url()).pathname);

  console.log("Desktop captures:");
  for (const [name, path] of DESKTOP) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
    await snap(page, name);
  }

  console.log("Mobile captures:");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of MOBILE) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
    await snap(page, name);
  }

  await browser.close();
  console.log("DONE ->", OUT);
};

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
