// One-off audit screenshot capture for docs/full-audit-pack.
// Logs in as the seeded owner, walks every route, writes full-page PNGs + a manifest.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "full-audit-pack", "screenshots");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3100";
const EMAIL = "owner@ptm.test";
const PASSWORD = "PlaiceTest123!";

const manifest = [];

async function shoot(page, name, route, { role = "owner" } = {}) {
  const url = route.startsWith("http") ? route : BASE + route;
  const entry = { name, route, role, ok: false, http: null, note: "" };
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    entry.http = resp ? resp.status() : null;
    await page.waitForTimeout(900);
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    if (/Internal Server Error|Application error|This page could not be found|404/i.test(body) && body.length < 400) {
      entry.note = "error/empty page body";
    }
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    entry.ok = true;
  } catch (err) {
    entry.note = String(err.message || err).slice(0, 200);
  }
  manifest.push(entry);
  console.log(`${entry.ok ? "OK " : "FAIL"} ${name} (${entry.http ?? "-"}) ${entry.note}`);
  return entry;
}

async function firstHref(page, selector) {
  try {
    const el = page.locator(selector).first();
    if (await el.count()) return await el.getAttribute("href");
  } catch {}
  return null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();

// ---- Public (unauthenticated) ----
await shoot(page, "public-01-home", "/", { role: "public" });
await shoot(page, "public-02-shop", "/shop", { role: "public" });
const productHref = (await firstHref(page, 'a[href^="/product/"]')) ?? "/product/unknown";
await shoot(page, "public-03-product", productHref, { role: "public" });
await shoot(page, "public-04-basket", "/basket", { role: "public" });
await shoot(page, "public-05-checkout", "/checkout", { role: "public" });
await shoot(page, "public-06-halal-promise", "/our-halal-promise", { role: "public" });
await shoot(page, "public-07-privacy", "/privacy", { role: "public" });
await shoot(page, "public-08-login", "/login", { role: "public" });
await shoot(page, "public-09-order-status", "/order/PTM-2026-90001", { role: "public" });

// ---- Authenticate as owner ----
await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([
  page.waitForLoadState("networkidle"),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(1500);
const loggedIn = !/\/login/.test(page.url());
console.log("LOGIN", loggedIn ? "ok -> " + page.url() : "FAILED still on login");

// ---- Counter / staff ----
await shoot(page, "staff-01-counter", "/counter", { role: "owner-as-staff" });
const counterOrderHref = await firstHref(page, 'a[href^="/counter/orders/"]');
if (counterOrderHref) await shoot(page, "staff-02-counter-order", counterOrderHref, { role: "owner-as-staff" });
await shoot(page, "staff-03-counter-compliance", "/counter/compliance", { role: "owner-as-staff" });

// ---- Admin owner-brain ----
await shoot(page, "admin-01-today", "/admin/today", { role: "owner" });
const decisionHref = await firstHref(page, 'a[href^="/admin/today/"]');
if (decisionHref && !/walk/.test(decisionHref)) await shoot(page, "admin-02-decision-card", decisionHref, { role: "owner" });
await shoot(page, "admin-03-today-walk", "/admin/today/walk", { role: "owner" });
await shoot(page, "admin-04-dashboard-full", "/admin", { role: "owner" });
await shoot(page, "admin-05-dashboard-counter-mode", "/admin?mode=counter", { role: "owner" });
await shoot(page, "admin-06-briefing", "/admin/briefing", { role: "owner" });

// ---- Guided operational capture ----
await shoot(page, "admin-07-open", "/admin/open", { role: "owner" });
await shoot(page, "admin-08-close", "/admin/close", { role: "owner" });
await shoot(page, "admin-09-stock-count", "/admin/stock-count", { role: "owner" });

// ---- Core ops ----
await shoot(page, "admin-10-orders", "/admin/orders", { role: "owner" });
await shoot(page, "admin-11-products", "/admin/products", { role: "owner" });
await shoot(page, "admin-12-inventory", "/admin/inventory", { role: "owner" });
await shoot(page, "admin-13-purchasing", "/admin/purchasing", { role: "owner" });
await shoot(page, "admin-14-cutting-guide", "/admin/cutting-guide", { role: "owner" });
await shoot(page, "admin-15-compliance", "/admin/compliance", { role: "owner" });

// ---- Schedule / settings ----
await shoot(page, "admin-16-pickup-windows", "/admin/pickup-windows", { role: "owner" });
await shoot(page, "admin-17-shop-closures", "/admin/shop-closures", { role: "owner" });
await shoot(page, "admin-18-settings", "/admin/settings", { role: "owner" });

// ---- Owner-only / support / learning ----
await shoot(page, "admin-19-releases", "/admin/releases", { role: "owner-only" });
await shoot(page, "admin-20-audit", "/admin/audit", { role: "owner-only" });
await shoot(page, "admin-21-setup", "/admin/setup", { role: "owner" });
await shoot(page, "admin-22-guide", "/admin/guide", { role: "owner" });
await shoot(page, "admin-23-playbooks", "/admin/playbooks", { role: "owner" });
const playbookHref = await firstHref(page, 'a[href^="/admin/playbooks/"]');
if (playbookHref) await shoot(page, "admin-24-playbook-detail", playbookHref, { role: "owner" });

writeFileSync(join(OUT, "_manifest.json"), JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), loggedIn, manifest }, null, 2));
console.log(`\nDONE. ${manifest.filter((m) => m.ok).length}/${manifest.length} captured.`);
await browser.close();
