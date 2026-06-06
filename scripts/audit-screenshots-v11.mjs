// V11 post-consolidation audit screenshot capture -> screenshots-v11/
// Captures public routes, the NEW secure order flow, retired/redirect routes,
// every protected route as owner, and role-gating as staff/manager.
// Writes full-page PNGs + a rich _manifest.json + HTML contact sheets.
//
// Requires: a running production server (`next start -p 3100`) with
// ORDER_ACCESS_SECRET set and the local Supabase stack seeded.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "screenshots-v11");
const SHEETS = join(OUT, "contact-sheets");
mkdirSync(OUT, { recursive: true });
mkdirSync(SHEETS, { recursive: true });

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3100";
const PASSWORD = "PlaiceTest123!";
const VIEWPORT = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

const manifest = [];

async function shoot(page, name, route, opts = {}) {
  const { role = "public", loginState = "anon", group = "misc", note = "", viewport = "1366x900" } = opts;
  const url = route.startsWith("http") ? route : BASE + route;
  const entry = {
    name,
    route,
    screenshot: `${name}.png`,
    http: null,
    loginState,
    role,
    redirectTarget: null,
    timestamp: new Date().toISOString(),
    viewport,
    group,
    note,
    ok: false,
  };
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    entry.http = resp ? resp.status() : null;
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    const finalPath = finalUrl.replace(BASE, "");
    const reqPath = route.startsWith("http") ? route.replace(BASE, "") : route;
    if (finalPath.split(/[?#]/)[0] !== reqPath.split(/[?#]/)[0]) {
      entry.redirectTarget = finalPath;
    }
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    if (/Application error|Internal Server Error/i.test(body) && body.length < 400) {
      entry.note = (entry.note ? entry.note + "; " : "") + "error page body";
    }
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    entry.ok = true;
  } catch (err) {
    entry.note = (entry.note ? entry.note + "; " : "") + String(err.message || err).slice(0, 160);
  }
  manifest.push(entry);
  const r = entry.redirectTarget ? ` -> ${entry.redirectTarget}` : "";
  console.log(`${entry.ok ? "OK " : "FAIL"} ${name} (${entry.http ?? "-"})${r} ${entry.note}`);
  return entry;
}

async function firstHref(page, selector) {
  try {
    const el = page.locator(selector).first();
    if (await el.count()) return await el.getAttribute("href");
  } catch {}
  return null;
}

async function login(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForLoadState("networkidle"), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  const ok = !/\/login/.test(page.url());
  console.log(`LOGIN ${email}: ${ok ? "ok -> " + page.url() : "FAILED"}`);
  return page;
}

const browser = await chromium.launch();

// ============ PUBLIC (anon) ============
{
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await shoot(page, "public-01-home", "/", { group: "public" });
  await shoot(page, "public-02-shop", "/shop", { group: "public" });
  const productHref = (await firstHref(page, 'a[href^="/product/"]')) ?? "/product/whole-chicken";
  await shoot(page, "public-03-product", productHref, { group: "public" });
  await shoot(page, "public-04-basket", "/basket", { group: "public" });
  await shoot(page, "public-05-checkout", "/checkout", { group: "public" });
  await shoot(page, "public-06-halal-promise", "/our-halal-promise", { group: "public" });
  await shoot(page, "public-07-privacy", "/privacy", { group: "public" });
  await shoot(page, "public-08-login", "/login", { group: "public" });

  // ---- Secure order flow (V11.1) ----
  // Retired enumerable routes redirect to lookup (no data).
  await shoot(page, "order-01-legacy-ref-redirect", "/order/PTM-2026-90001", {
    group: "order", note: "retired reference route -> lookup (no data read)",
  });
  await shoot(page, "order-02-legacy-cancel-redirect", "/order/PTM-2026-90001/cancel", {
    group: "order", note: "retired reference cancel -> lookup",
  });
  await shoot(page, "order-03-lookup", "/order/lookup", { group: "order", note: "identity-checked access (ref + phone)" });

  // Establish access for real: ref + phone -> status (extract access id).
  let accessId = null;
  try {
    await page.goto(BASE + "/order/lookup", { waitUntil: "networkidle" });
    await page.getByLabel(/order number/i).fill("PTM-2026-90001");
    await page.getByLabel(/phone/i).fill("07700900111");
    await Promise.all([page.waitForLoadState("networkidle"), page.getByRole("button").last().click()]);
    await page.waitForTimeout(1200);
    const m = page.url().match(/\/order\/status\/([0-9a-f-]{36})/);
    if (m) accessId = m[1];
  } catch (e) {
    console.log("establish flow note:", String(e.message || e).slice(0, 120));
  }
  console.log("establish accessId:", accessId);

  if (accessId) {
    await shoot(page, "order-04-status-by-accessid", `/order/status/${accessId}`, {
      group: "order", loginState: "order-session", note: "secure status by unguessable handle (safe DTO)",
    });
    await shoot(page, "order-05-cancel-with-session", `/order/status/${accessId}/cancel`, {
      group: "order", loginState: "order-session", note: "cancel reachable WITH established session",
    });
    // Stranger (fresh context, no session) hitting the same cancel URL -> asked to confirm identity.
    const strangerCtx = await browser.newContext({ viewport: VIEWPORT });
    const stranger = await strangerCtx.newPage();
    await shoot(stranger, "order-06-cancel-no-session-blocked", `/order/status/${accessId}/cancel`, {
      group: "order", loginState: "anon", role: "stranger", note: "no session -> must confirm identity (no cancel button)",
    });
    await strangerCtx.close();
  }
  await ctx.close();
}

// ============ OWNER (covers staff + admin + owner-only) ============
{
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await login(ctx, "owner@ptm.test");
  const o = { role: "owner", loginState: "owner" };

  // staff surfaces (owner can reach)
  await shoot(page, "staff-01-counter", "/counter", { ...o, role: "owner-as-staff", group: "staff" });
  const counterOrderHref = await firstHref(page, 'a[href^="/counter/orders/"]');
  if (counterOrderHref) await shoot(page, "staff-02-counter-order", counterOrderHref, { ...o, role: "owner-as-staff", group: "staff" });
  await shoot(page, "staff-03-food-safety", "/counter/compliance", { ...o, role: "owner-as-staff", group: "staff", note: "nav 'Food safety'; 4-domain split deferred V11.3b" });

  // Today (sole operational home)
  await shoot(page, "admin-01-today", "/admin/today", { ...o, group: "admin" });
  const decisionHref = await firstHref(page, 'a[href^="/admin/today/"]');
  if (decisionHref && !/walk/.test(decisionHref)) await shoot(page, "admin-02-decision-card", decisionHref, { ...o, group: "admin" });
  await shoot(page, "admin-03-today-walk", "/admin/today/walk", { ...o, group: "admin" });

  // Business Insights (analysis only) + retired/removed surfaces
  await shoot(page, "admin-04-business-insights", "/admin", { ...o, group: "admin", note: "Business Insights — analysis only (V11.3)" });
  await shoot(page, "admin-05-mode-counter-removed", "/admin?mode=counter", { ...o, group: "admin", note: "counter-mode removed -> falls through to Business Insights" });
  await shoot(page, "admin-06-briefing-redirect", "/admin/briefing", { ...o, group: "admin", note: "RETIRED -> redirects to /admin/today" });

  // rituals + single stock door
  await shoot(page, "admin-07-open", "/admin/open", { ...o, group: "admin" });
  await shoot(page, "admin-08-close", "/admin/close", { ...o, group: "admin" });
  await shoot(page, "admin-09-stock-count", "/admin/stock-count", { ...o, group: "admin", note: "single stock-correction door" });

  // core ops
  await shoot(page, "admin-10-orders", "/admin/orders", { ...o, group: "admin", note: "order history / exceptions" });
  await shoot(page, "admin-11-products", "/admin/products", { ...o, group: "admin" });
  await shoot(page, "admin-12-inventory", "/admin/inventory", { ...o, group: "admin", note: "per-batch correct stock now owner-only" });
  await shoot(page, "admin-13-purchasing", "/admin/purchasing", { ...o, group: "admin" });
  await shoot(page, "admin-14-cutting-guide", "/admin/cutting-guide", { ...o, group: "admin", note: "yields unverified by butcher" });
  await shoot(page, "admin-15-compliance", "/admin/compliance", { ...o, group: "admin" });

  // schedule / settings
  await shoot(page, "admin-16-pickup-windows", "/admin/pickup-windows", { ...o, group: "admin" });
  await shoot(page, "admin-17-shop-closures", "/admin/shop-closures", { ...o, group: "admin" });
  await shoot(page, "admin-18-settings", "/admin/settings", { ...o, group: "admin" });

  // owner-only + support
  await shoot(page, "admin-19-releases", "/admin/releases", { ...o, role: "owner-only", group: "owner-only" });
  await shoot(page, "admin-20-audit", "/admin/audit", { ...o, role: "owner-only", group: "owner-only", note: "append-only audit evidence" });
  await shoot(page, "admin-21-setup", "/admin/setup", { ...o, group: "admin" });
  await shoot(page, "admin-22-guide", "/admin/guide", { ...o, group: "admin" });
  await shoot(page, "admin-23-playbooks", "/admin/playbooks", { ...o, group: "admin" });
  const playbookHref = await firstHref(page, 'a[href^="/admin/playbooks/"]');
  if (playbookHref) await shoot(page, "admin-24-playbook-detail", playbookHref, { ...o, group: "admin" });
  await ctx.close();
}

// ============ MOBILE (owner, responsive) ============
{
  const ctx = await browser.newContext({ viewport: MOBILE });
  const page = await login(ctx, "owner@ptm.test");
  await shoot(page, "mobile-01-today", "/admin/today", { role: "owner", loginState: "owner", group: "mobile", viewport: "390x844" });
  await shoot(page, "mobile-02-business-insights", "/admin", { role: "owner", loginState: "owner", group: "mobile", viewport: "390x844" });
  await ctx.close();
}

// ============ ROLE GATING (staff, manager) ============
{
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await login(ctx, "staff@ptm.test");
  await shoot(page, "role-staff-01-counter", "/counter", { role: "staff", loginState: "staff", group: "roles", note: "staff nav: Counter + Food safety only" });
  await shoot(page, "role-staff-02-admin-blocked", "/admin/today", { role: "staff", loginState: "staff", group: "roles", note: "staff blocked from /admin -> redirect" });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await login(ctx, "manager@ptm.test");
  await shoot(page, "role-manager-01-today", "/admin/today", { role: "manager", loginState: "manager", group: "roles", note: "manager nav: Today + Business Insights" });
  await shoot(page, "role-manager-02-owneronly-blocked", "/admin/releases", { role: "manager", loginState: "manager", group: "roles", note: "manager blocked from owner-only -> redirect" });
  await ctx.close();
}

// ============ manifest + contact sheets ============
writeFileSync(
  join(OUT, "_manifest.json"),
  JSON.stringify(
    { base: BASE, capturedAt: new Date().toISOString(), commit: process.env.AUDIT_COMMIT ?? null, count: manifest.length, captures: manifest },
    null,
    2,
  ),
);

// HTML contact sheets per group.
const groups = [...new Set(manifest.map((m) => m.group))];
const files = readdirSync(OUT).filter((f) => f.endsWith(".png"));
function sheet(title, entries) {
  const cells = entries
    .map((m) => {
      const exists = files.includes(m.screenshot);
      const meta = `${m.route}<br><small>${m.role} / ${m.loginState} / ${m.http ?? "-"}${m.redirectTarget ? " &rarr; " + m.redirectTarget : ""}</small>${m.note ? `<br><small><i>${m.note}</i></small>` : ""}`;
      return `<figure>${exists ? `<a href="../${m.screenshot}"><img src="../${m.screenshot}" loading="lazy"></a>` : "<div class='missing'>missing</div>"}<figcaption>${meta}</figcaption></figure>`;
    })
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;margin:16px;background:#fbfaf7}h1{font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
figure{margin:0;border:1px solid #ded6ca;border-radius:8px;background:#fff;padding:8px}
img{width:100%;height:220px;object-fit:cover;object-position:top;border:1px solid #eee}
figcaption{font-size:12px;margin-top:6px;color:#333;word-break:break-word}
.missing{height:220px;display:grid;place-items:center;color:#a00;background:#fee}</style>
<h1>${title}</h1><div class="grid">${cells}</div>`;
}
for (const g of groups) {
  writeFileSync(join(SHEETS, `${g}.html`), sheet(`Contact sheet — ${g}`, manifest.filter((m) => m.group === g)));
}
writeFileSync(join(SHEETS, `index.html`), sheet("Contact sheet — all captures", manifest));

const ok = manifest.filter((m) => m.ok).length;
console.log(`\nDONE. ${ok}/${manifest.length} captured. Manifest + ${groups.length} contact sheets written.`);
await browser.close();
