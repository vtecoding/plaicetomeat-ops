// One-off: capture Operator Mode screenshots logged in as the operator account.
// Usage: BASE=http://127.0.0.1:3001 node scripts/operator-screens.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const OUT = resolve(process.cwd(), "docs", "v17", "screens");
mkdirSync(OUT, { recursive: true });
const KILL = `*{animation:none!important;transition:none!important} nextjs-portal{display:none!important}`;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 820, height: 1180 } })).newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("#email", "operator@ptm.test");
await page.fill("#password", "PlaiceTest123!");
await Promise.all([page.waitForURL("**/operator", { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);

async function snap(name) {
  await page.addStyleTag({ content: KILL }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
  console.log(`saved ${name}.png — ${page.url()}`);
}

await snap("operator-home");
await page.goto(`${BASE}/operator/open`, { waitUntil: "networkidle" });
await snap("operator-open");
await browser.close();
