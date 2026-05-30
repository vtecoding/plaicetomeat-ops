// Standalone live-site audit for PlaiceToMeat Ops.
// Targets the deployed Vercel site. Read-only: never submits a real order.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.AUDIT_BASE_URL ?? "https://plaicetomeat-ops.vercel.app";
const OUT = "audit-results";
const SHOTS = join(OUT, "screenshots");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);

const VIEWPORTS = {
  "desktop-1440x900": { width: 1440, height: 900 },
  "laptop-1280x800": { width: 1280, height: 800 },
  "tablet-768x1024": { width: 768, height: 1024 },
  "mobile-390x844": { width: 390, height: 844 },
};

// route, expectedAccess: public | protected
const ROUTES = [
  ["/", "public"],
  ["/shop", "public"],
  ["/basket", "public"],
  ["/checkout", "public"],
  ["/privacy", "public"],
  ["/counter", "protected"],
  ["/counter/compliance", "protected"],
  ["/admin", "protected"],
  ["/admin/products", "protected"],
  ["/admin/orders", "protected"],
  ["/admin/pickup-windows", "protected"],
  ["/admin/shop-closures", "protected"],
  ["/admin/compliance", "protected"],
  ["/admin/settings", "protected"],
  ["/compliance", "protected"],
];

const results = { base: BASE, startedAt: new Date().toISOString(), routes: [], customer: {}, security: [] };

function attachCapture(page) {
  const consoleErrors = [];
  const networkErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => networkErrors.push(`FAILED ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) networkErrors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return { consoleErrors, networkErrors };
}

async function auditRoute(context, route, expected, viewportName, folder) {
  const page = await context.newPage();
  const cap = attachCapture(page);
  const requested = BASE + route;
  let status = null;
  let error = null;
  try {
    const resp = await page.goto(requested, { waitUntil: "domcontentloaded", timeout: 30000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(900);
  } catch (e) {
    error = String(e);
  }
  const finalUrl = page.url();
  const redirected = !finalUrl.endsWith(route) && finalUrl !== requested;
  const title = await page.title().catch(() => "");
  const h1 = await page.locator("h1").first().innerText().catch(() => "");
  const safeName = route === "/" ? "_root" : route.replaceAll("/", "_");
  const file = join(folder, `${safeName}__${viewportName}__${stamp()}.png`);
  await page.screenshot({ path: file, fullPage: expected === "public" }).catch(() => {});

  const rec = {
    route,
    viewport: viewportName,
    expectedAccess: expected,
    httpStatus: status,
    redirected,
    finalUrl,
    title,
    h1: h1.slice(0, 120),
    consoleErrors: cap.consoleErrors.slice(0, 10),
    networkErrors: cap.networkErrors.slice(0, 10),
    screenshot: file,
    error,
  };

  if (expected === "protected") {
    const landedHome = finalUrl === BASE + "/" || finalUrl === BASE;
    rec.protectionPass = landedHome;
    results.security.push({
      route,
      viewport: viewportName,
      expected: "redirect to / or deny",
      actual: landedHome ? "redirected to /" : `rendered at ${finalUrl}`,
      screenshot: file,
      severity: landedHome ? "ok" : "CRITICAL",
    });
  }
  results.routes.push(rec);
  await page.close();
  return rec;
}

async function customerFlow(context) {
  const flow = { steps: [], issues: [] };
  const folder = join(SHOTS, "customer");
  const page = await context.newPage();
  const cap = attachCapture(page);

  // 1. Empty-basket checkout: submit button must be disabled (basket enforcement)
  await page.goto(BASE + "/checkout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const submitBtn = page.getByRole("button", { name: /place pay-on-collection order/i });
  const emptyDisabled = await submitBtn.isDisabled().catch(() => null);
  await page.screenshot({ path: join(folder, `checkout__empty-basket__desktop__${stamp()}.png`), fullPage: true }).catch(() => {});
  flow.steps.push({ step: "checkout with empty basket", submitDisabled: emptyDisabled });
  if (emptyDisabled !== true) flow.issues.push("Checkout submit NOT disabled with empty basket");

  // 2. Shop: add products
  await page.goto(BASE + "/shop", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const addButtons = page.getByRole("button", { name: /^Add$/ });
  const addCount = await addButtons.count();
  flow.steps.push({ step: "shop loaded", addButtonsFound: addCount });
  const toAdd = Math.min(3, addCount);
  for (let i = 0; i < toAdd; i++) {
    await addButtons.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const basketLS = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes("basket"));
    return k ? localStorage.getItem(k) : null;
  });
  let itemCount = 0;
  try { itemCount = JSON.parse(basketLS).items.length; } catch {}
  flow.steps.push({ step: "added products", clicked: toAdd, basketItems: itemCount });
  await page.screenshot({ path: join(folder, `shop__after-add__desktop__${stamp()}.png`), fullPage: true }).catch(() => {});
  if (itemCount === 0) flow.issues.push("Add to basket did not persist any items");

  // 3. Basket page
  await page.goto(BASE + "/basket", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const basketBody = await page.locator("body").innerText().catch(() => "");
  await page.screenshot({ path: join(folder, `basket__with-items__desktop__${stamp()}.png`), fullPage: true }).catch(() => {});
  flow.steps.push({ step: "basket page", mentionsCheckout: /checkout/i.test(basketBody) });

  // 4. Checkout enabled + HTML5 validation (do NOT submit a real order)
  await page.goto(BASE + "/checkout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const enabledNow = await submitBtn.isEnabled().catch(() => null);
  flow.steps.push({ step: "checkout with items", submitEnabled: enabledNow });
  // probe HTML5 constraint validation without submitting to server
  const validity = await page.evaluate(() => {
    const ids = ["customerName", "customerPhone", "pickupDate", "pickupWindowId"];
    return ids.map((id) => {
      const el = document.getElementById(id);
      return { id, present: !!el, required: el?.required ?? false, valid: el?.checkValidity?.() ?? null };
    });
  });
  flow.steps.push({ step: "html5 validity (empty)", validity });
  await page.screenshot({ path: join(folder, `checkout__empty-fields__desktop__${stamp()}.png`), fullPage: true }).catch(() => {});
  // phone pattern probe
  const phoneProbe = await page.evaluate(() => {
    const el = document.getElementById("customerPhone");
    if (!el) return null;
    const test = (v) => { el.value = v; return el.checkValidity(); };
    const r = { bad: test("hello"), short: test("0770"), good: test("07700123456") };
    el.value = "";
    return r;
  });
  flow.steps.push({ step: "phone pattern probe", phoneProbe });

  flow.consoleErrors = cap.consoleErrors.slice(0, 20);
  flow.networkErrors = cap.networkErrors.slice(0, 20);
  results.customer = flow;
  await page.close();
}

async function main() {
  for (const f of ["public", "customer", "staff", "admin", "responsive", "failure-states"]) {
    mkdirSync(join(SHOTS, f), { recursive: true });
  }
  const browser = await chromium.launch();

  // Full route crawl on desktop
  const desktopCtx = await browser.newContext({ viewport: VIEWPORTS["desktop-1440x900"] });
  for (const [route, expected] of ROUTES) {
    const folder = expected === "public" ? join(SHOTS, "public") : join(SHOTS, "admin");
    await auditRoute(desktopCtx, route, expected, "desktop-1440x900", folder);
  }
  await customerFlow(desktopCtx);
  await desktopCtx.close();

  // Responsive sweep on key public routes
  const responsiveRoutes = ["/", "/shop", "/basket", "/checkout"];
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    if (vpName === "desktop-1440x900") continue;
    const ctx = await browser.newContext({ viewport: vp });
    for (const route of responsiveRoutes) {
      await auditRoute(ctx, route, "public", vpName, join(SHOTS, "responsive"));
    }
    await ctx.close();
  }

  // Mobile protected-route check (defense in depth)
  const mobileCtx = await browser.newContext({ viewport: VIEWPORTS["mobile-390x844"] });
  for (const r of ["/counter", "/admin"]) {
    await auditRoute(mobileCtx, r, "protected", "mobile-390x844", join(SHOTS, "responsive"));
  }
  await mobileCtx.close();

  await browser.close();
  results.finishedAt = new Date().toISOString();
  mkdirSync(join(OUT, "reports"), { recursive: true });
  writeFileSync(join(OUT, "reports", "playwright-summary.json"), JSON.stringify(results, null, 2));

  // console digest
  const protectedFails = results.security.filter((s) => s.severity === "CRITICAL");
  console.log("=== ROUTE CRAWL ===");
  for (const r of results.routes.filter((r) => r.viewport === "desktop-1440x900")) {
    console.log(`${r.route}\tHTTP ${r.httpStatus}\tredirect=${r.redirected}\tfinal=${r.finalUrl.replace(BASE, "")}\tconsoleErr=${r.consoleErrors.length}\tnetErr=${r.networkErrors.length}`);
  }
  console.log("\n=== PROTECTED ROUTES ===");
  for (const s of results.security) console.log(`${s.route} [${s.viewport}] -> ${s.actual} (${s.severity})`);
  console.log("\n=== CUSTOMER FLOW ===");
  console.log(JSON.stringify(results.customer.steps, null, 2));
  console.log("issues:", results.customer.issues);
  console.log("\nCRITICAL protection failures:", protectedFails.length);
  console.log("Summary written to audit-results/reports/playwright-summary.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
