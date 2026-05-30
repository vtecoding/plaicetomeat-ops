import { chromium } from "@playwright/test";
import { join } from "node:path";
const BASE = "http://localhost:3100";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
const routes = [
  ["/counter", "staff", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/counter", "staff", "tablet-768x1024", { width: 768, height: 1024 }],
  ["/counter/compliance", "staff", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin/products", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin/orders", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin/pickup-windows", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin/shop-closures", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin/compliance", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
  ["/admin/settings", "admin", "desktop-1440x900", { width: 1440, height: 900 }],
];
const b = await chromium.launch();
const out = [];
for (const [route, folder, vpName, vp] of routes) {
  const ctx = await b.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  let status = null;
  try { const r = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 20000 }); status = r?.status(); } catch (e) { errs.push(String(e)); }
  await page.waitForTimeout(500);
  const h1 = await page.locator("h1").first().innerText().catch(() => "");
  const safe = route.replaceAll("/", "_");
  const file = join("audit-results/screenshots", folder, `${safe}__${vpName}__${stamp()}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  out.push({ route, vpName, status, h1: h1.slice(0,80), errs: errs.slice(0,5), file });
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(out, null, 2));
