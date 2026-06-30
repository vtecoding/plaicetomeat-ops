// PTM full-route screenshot + runtime audit capture (audit deliverable).
// Logs in once as the owner (branch-global, reaches every staff route), resolves
// dynamic route params from list pages, and captures each route at 3 viewports.
// Records HTTP status, final URL (redirect detection) and console/page errors so
// the audit report can cite real runtime evidence. Run against a running dev server:
//   BASE=http://localhost:51384 node scripts/ptm-route-audit.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:51384";
const OUT = path.join(process.cwd(), "audit-screenshots");
const PASSWORD = "PlaiceTest123!";
const OWNER = "owner@ptm.test";

const VIEWPORTS = [
  { id: "mobile", width: 375, height: 812 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "desktop", width: 1440, height: 900 },
];

const PUBLIC_ROUTES = [
  { slug: "home", path: "/", purpose: "Public storefront landing" },
  { slug: "shop", path: "/shop", purpose: "Product catalogue" },
  { slug: "basket", path: "/basket", purpose: "Customer basket" },
  { slug: "checkout", path: "/checkout", purpose: "Customer checkout" },
  { slug: "halal-promise", path: "/our-halal-promise", purpose: "Halal assurance page" },
  { slug: "privacy", path: "/privacy", purpose: "Privacy policy" },
  { slug: "login", path: "/login", purpose: "Staff sign-in" },
  { slug: "unauthorised", path: "/unauthorised", purpose: "Access-denied page" },
  { slug: "order-lookup", path: "/order/lookup", purpose: "Customer order lookup" },
  { slug: "auth-update-password", path: "/auth/update-password", purpose: "Password reset completion" },
];

const PUBLIC_DYNAMIC = [
  { slug: "product-detail", resolve: "product", purpose: "Single product page" },
  { slug: "order-detail", path: "/order/PTM-2026-90001", purpose: "Order detail by ref (seeded)" },
  { slug: "order-cancel", path: "/order/PTM-2026-90001/cancel", purpose: "Customer order cancel" },
];

const STAFF_ROUTES = [
  { slug: "operator-home", path: "/operator", purpose: "Operator Mode home (4 big doors)" },
  { slug: "operator-open", path: "/operator/open", purpose: "Operator open-shop checklist" },
  { slug: "operator-serve", path: "/operator/serve", purpose: "Operator counter sale" },
  { slug: "operator-stock", path: "/operator/stock", purpose: "Operator stock/delivery" },
  { slug: "operator-waste", path: "/operator/waste", purpose: "Operator waste" },
  { slug: "operator-certificate", path: "/operator/certificate", purpose: "Operator paper-photo capture" },
  { slug: "operator-close", path: "/operator/close", purpose: "Operator close-shop checklist" },
  { slug: "operator-help", path: "/operator/help", purpose: "Operator help / call owner" },
  { slug: "admin-hub", path: "/admin", purpose: "Owner business-insights hub" },
  { slug: "admin-today", path: "/admin/today", purpose: "Owner Brain TODAY" },
  { slug: "admin-today-walk", path: "/admin/today/walk", purpose: "Guided shop-day walk" },
  { slug: "admin-inventory", path: "/admin/inventory", purpose: "Inventory truth view" },
  { slug: "admin-purchasing", path: "/admin/purchasing", purpose: "Purchasing / reorder" },
  { slug: "admin-stock-count", path: "/admin/stock-count", purpose: "Stock count / correction" },
  { slug: "admin-compliance", path: "/admin/compliance", purpose: "Compliance / temperature" },
  { slug: "admin-orders", path: "/admin/orders", purpose: "Orders management" },
  { slug: "admin-products", path: "/admin/products", purpose: "Product management" },
  { slug: "admin-settings", path: "/admin/settings", purpose: "Branch settings" },
  { slug: "admin-audit", path: "/admin/audit", purpose: "Audit trail (owner-only)" },
  { slug: "admin-releases", path: "/admin/releases", purpose: "Release log (owner-only)" },
  { slug: "admin-away", path: "/admin/away", purpose: "Owner away mode (owner-only)" },
  { slug: "admin-briefing", path: "/admin/briefing", purpose: "Morning briefing" },
  { slug: "admin-evidence", path: "/admin/evidence", purpose: "Evidence review" },
  { slug: "admin-guide", path: "/admin/guide", purpose: "Owner guide" },
  { slug: "admin-cutting-guide", path: "/admin/cutting-guide", purpose: "Cutting guide" },
  { slug: "admin-setup", path: "/admin/setup", purpose: "Setup checklist" },
  { slug: "admin-playbooks", path: "/admin/playbooks", purpose: "Playbooks index" },
  { slug: "admin-pickup-windows", path: "/admin/pickup-windows", purpose: "Pickup windows" },
  { slug: "admin-shop-closures", path: "/admin/shop-closures", purpose: "Shop closures" },
  { slug: "admin-validation-pricing", path: "/admin/validation/pricing", purpose: "Pricing validation" },
  { slug: "counter", path: "/counter", purpose: "Counter order board" },
  { slug: "counter-compliance", path: "/counter/compliance", purpose: "Counter compliance" },
];

const STAFF_DYNAMIC = [
  { slug: "admin-today-decision", resolve: "today", purpose: "Owner Brain decision detail" },
  { slug: "admin-playbook-detail", resolve: "playbook", purpose: "Single playbook" },
  { slug: "counter-order-detail", resolve: "counterOrder", purpose: "Counter order detail" },
];

const index = [];
function record(slug, viewport, state, file, route, status, finalUrl, notes) {
  index.push({ slug, viewport, state, file, route, status, finalUrl, notes });
}

async function settle(page) {
  await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function capture(page, slug, route, { state = "default" } = {}) {
  const errors = [];
  const onErr = (e) => errors.push(String(e?.message ?? e));
  const onConsole = (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); };
  page.on("pageerror", onErr);
  page.on("console", onConsole);

  let status = null;
  let finalUrl = route;
  try {
    const resp = await page.goto(new URL(route, BASE).toString(), { waitUntil: "commit", timeout: 45000 });
    status = resp ? resp.status() : null;
    await settle(page);
    finalUrl = page.url().replace(BASE, "");
  } catch (e) {
    errors.push(`nav: ${String(e?.message ?? e)}`);
  }

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    const file = `${slug}-${state}-${vp.id}.png`;
    try {
      await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    } catch (e) {
      errors.push(`shot ${vp.id}: ${String(e?.message ?? e)}`);
    }
    record(slug, `${vp.width}px ${vp.id}`, state, file, route, status, finalUrl, errors.slice());
  }
  page.off("pageerror", onErr);
  page.off("console", onConsole);
  return { status, finalUrl, errors };
}

async function captureViewport(page, slug, route, vpId, state) {
  const vp = VIEWPORTS.find((v) => v.id === vpId);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(200);
  const file = `${slug}-${state}-${vp.id}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  record(slug, `${vp.width}px ${vp.id}`, state, file, route, null, page.url().replace(BASE, ""), []);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---- PUBLIC PASS (logged out) ----
  const pub = await browser.newContext({ ignoreHTTPSErrors: true });
  const pubPage = await pub.newPage();
  for (const r of PUBLIC_ROUTES) await capture(pubPage, r.slug, r.path);

  let productPath = null;
  try {
    await pubPage.goto(new URL("/shop", BASE).toString(), { waitUntil: "load", timeout: 45000 });
    await pubPage.waitForTimeout(500);
    productPath = await pubPage.$eval('a[href^="/product/"]', (a) => a.getAttribute("href")).catch(() => null);
  } catch {}
  for (const r of PUBLIC_DYNAMIC) {
    const p = r.resolve === "product" ? productPath : r.path;
    if (!p) { record(r.slug, "n/a", "default", "(skipped)", "?", null, null, ["could not resolve dynamic param"]); continue; }
    await capture(pubPage, r.slug, p);
  }
  await pub.close();

  // ---- OWNER PASS (logged in) ----
  const own = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await own.newPage();
  await page.goto(new URL("/login", BASE).toString(), { waitUntil: "load" });
  await page.fill('input[name="email"]', OWNER);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(admin|operator|counter)/, { timeout: 30000 }).catch(() => {}),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  await page.waitForTimeout(900);
  const landed = page.url().replace(BASE, "");
  console.log("owner landed on:", landed);

  for (const r of STAFF_ROUTES) await capture(page, r.slug, r.path);

  async function firstHref(listPath, selector) {
    try {
      await page.goto(new URL(listPath, BASE).toString(), { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(500);
      return await page.$eval(selector, (a) => a.getAttribute("href")).catch(() => null);
    } catch { return null; }
  }
  const resolved = {
    today: await firstHref("/admin/today", 'a[href^="/admin/today/"]'),
    playbook: await firstHref("/admin/playbooks", 'a[href^="/admin/playbooks/"]'),
    counterOrder: await firstHref("/counter", 'a[href^="/counter/orders/"]'),
  };
  if (resolved.today === "/admin/today/walk") resolved.today = null;
  for (const r of STAFF_DYNAMIC) {
    const p = resolved[r.resolve];
    if (!p) { record(r.slug, "n/a", "default", "(skipped)", "?", null, null, ["no seeded data to resolve param"]); continue; }
    await capture(page, r.slug, p);
  }

  // ---- OPERATOR SERVE FLOW STATES (mobile + tablet) ----
  try {
    for (const vpId of ["mobile", "tablet"]) {
      await page.goto(new URL("/operator/serve", BASE).toString(), { waitUntil: "load" });
      await page.waitForTimeout(600);
      await captureViewport(page, "operator-serve-flow", "/operator/serve", vpId, "1-empty-what-bought");
      let b = await page.$$('[data-testid="operator-serve-flow"] button');
      if (b[0]) { await b[0].click(); await page.waitForTimeout(400); }
      await captureViewport(page, "operator-serve-flow", "/operator/serve", vpId, "2-how-much");
      b = await page.$$('[data-testid="operator-serve-flow"] button');
      if (b[0]) { await b[0].click(); await page.waitForTimeout(400); }
      await captureViewport(page, "operator-serve-flow", "/operator/serve", vpId, "3-add-more");
      b = await page.$$('[data-testid="operator-serve-flow"] button');
      if (b[1]) { await b[1].click(); await page.waitForTimeout(400); }
      await captureViewport(page, "operator-serve-flow", "/operator/serve", vpId, "4-how-paid");
    }
  } catch (e) {
    console.log("serve-flow state capture issue:", String(e?.message ?? e));
  }

  await own.close();
  await browser.close();

  // ---- WRITE INDEX ----
  let md = "# Screenshot Index\n\n";
  md += `Captured: ${new Date().toISOString()}\nBase URL: ${BASE}\nOwner landing: ${landed}\n\n`;
  md += `Viewports: 375px (mobile), 768px (tablet), 1440px (desktop).\n\n`;
  md += "Dynamic params resolved: `" + JSON.stringify(resolved) + "`\n\n---\n\n";
  for (const e of index) {
    const errs = (e.notes && e.notes.length) ? e.notes.join("; ") : "none";
    const redirect = e.finalUrl && e.route !== "?" && e.finalUrl !== e.route ? `redirected -> ${e.finalUrl}` : "";
    md += `Route: ${e.route}\nViewport: ${e.viewport}\nState: ${e.state}\nFilename: ${e.file}\nHTTP: ${e.status ?? "n/a"} ${redirect}\nNotes: ${errs}\n\n`;
  }
  fs.writeFileSync(path.join(OUT, "SCREENSHOT_INDEX.md"), md);
  fs.writeFileSync(path.join(OUT, "_runtime.json"), JSON.stringify(index, null, 2));
  console.log(`captured ${index.length} screenshot records ->`, OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
