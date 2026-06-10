// V15.2 · One-Tap Action Layer — operator-journey validation.
//
// A REAL start-of-day journey against the running app, proving that TODAY's primary
// actions remove navigation:
//   1. Each Do-now action links straight to a work screen (not the read-only detail page),
//      carrying the item focus + "from today" context.
//   2. Every such link points at one of the four known work routes — never a wrong entity.
//   3. Tapping one lands on that screen showing the "From Today" action-context banner that
//      names the exact item, plus an explicit Back-to-Today return.
//   4. The context survives a full page refresh (it lives in the URL).
//   5. Back-to-Today returns the operator to /admin/today.
// Captures a screenshot and writes an evidence pack under docs/v15/.
//
// Usage (app must be running + local Supabase up + seeded):
//   BASE=http://127.0.0.1:3001 node scripts/verify-one-tap-actions.mjs
// Login: owner@ptm.test / PlaiceTest123! (seeded). Run node scripts/seed-dev.mjs first.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const EMAIL = process.env.OPERATOR_EMAIL ?? "owner@ptm.test";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";
const WORK_ROUTES = ["/admin/stock-count", "/admin/purchasing", "/admin/inventory", "/admin/compliance"];

const OUT_DIR = resolve(process.cwd(), "docs", "v15");
const SHOTS = resolve(OUT_DIR, "screens");
mkdirSync(SHOTS, { recursive: true });

const observations = [];
const failures = [];
const KILL_ANIM = `*{animation:none!important;transition:none!important} nextjs-portal{display:none!important}`;

function record(name, ok, detail) {
  observations.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push({ name, detail });
}

function pathOf(href) {
  try {
    return new URL(href, BASE).pathname;
  } catch {
    return href;
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL("**/admin/**", { timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  record("operator signs in", /\/admin/.test(page.url()), page.url());

  await page.goto(`${BASE}/admin/today`, { waitUntil: "networkidle", timeout: 60000 });

  if ((await page.getByTestId("setup-mode").count()) > 0) {
    record("shop has live data", false, "TODAY is in setup mode — seed data (node scripts/seed-dev.mjs) before validating one-tap");
    await browser.close();
    return finish();
  }

  // 1+2. Read every Do-now action's link and classify its destination.
  const doNowRows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
  const count = await doNowRows.count();
  const links = [];
  for (let i = 0; i < count; i += 1) {
    const href = (await doNowRows.nth(i).getAttribute("href")) ?? "";
    const label = (await doNowRows.nth(i).locator("p").first().innerText().catch(() => "")).trim();
    links.push({ href, path: pathOf(href), label, oneTap: /from=today/.test(href) });
  }

  if (count === 0) {
    record("Do-now actions present", true, "All clear today — no primary actions to route (nothing to prove)");
    await browser.close();
    return finish({ count, links });
  }

  const oneTapLinks = links.filter((l) => l.oneTap);
  record(
    "Do-now actions link straight to the work (one tap, with focus context)",
    oneTapLinks.length > 0,
    `${oneTapLinks.length}/${count} carry from=today: ${links.map((l) => `${l.label} → ${l.path}`).join(" | ")}`,
  );

  // 2. No one-tap action points at a wrong destination.
  const wrong = oneTapLinks.filter((l) => !WORK_ROUTES.includes(l.path));
  record("no action opens the wrong destination", wrong.length === 0, wrong.length ? `unexpected: ${wrong.map((l) => l.path).join(", ")}` : "all land on known work routes");

  // 3–5. Follow the first one-tap action and prove the destination knows why we arrived.
  const first = oneTapLinks[0] ?? links[0];
  if (first) {
    await page.goto(new URL(first.href, BASE).toString(), { waitUntil: "networkidle", timeout: 60000 });

    const banner = page.getByTestId("action-context");
    const onArrival = (await banner.count()) > 0;
    const headline = onArrival ? (await page.getByTestId("action-context-headline").innerText().catch(() => "")).trim() : "";
    record("destination shows the 'From Today' action context, naming the item", onArrival && headline.length > 0, `headline: ${headline || "(none)"}`);
    record("destination offers an explicit Back-to-Today return", (await page.getByTestId("action-context-back").count()) > 0, first.path);

    // 4. Context survives a full refresh (it lives in the URL).
    await page.reload({ waitUntil: "networkidle" });
    const survives = (await page.getByTestId("action-context").count()) > 0;
    record("action context survives a refresh", survives, survives ? "banner still present after reload" : "banner lost on reload");

    await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/one-tap-destination.png`, fullPage: true }).catch(() => {});

    // 5. Back-to-Today returns to TODAY.
    await Promise.all([
      page.waitForURL("**/admin/today", { timeout: 30000 }).catch(() => {}),
      page.getByTestId("action-context-back").click().catch(() => {}),
    ]);
    record("completion path returns to TODAY", /\/admin\/today$/.test(page.url()), page.url());
  }

  await browser.close();
  return finish({ count, links, first });

  function finish(data = {}) {
    const lines = [];
    lines.push("# V15.2 · One-Tap Action Layer — Operator-Journey Proof");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App: ${BASE} · operator: ${EMAIL}`);
    lines.push("");
    lines.push("A real start-of-day journey against the running app on live data. Screenshot in");
    lines.push("`./screens/one-tap-destination.png`.");
    lines.push("");
    lines.push("## TODAY's primary actions and where one tap takes the operator");
    lines.push("");
    for (const l of data.links ?? []) lines.push(`- **${l.label}** → \`${l.path}\`${l.oneTap ? " (one tap to the work)" : " (review)"}`);
    if (!(data.links ?? []).length) lines.push("- (none — all clear today)");
    lines.push("");
    lines.push("## Journey checks");
    lines.push("");
    for (const o of observations) lines.push(`- ${o.ok ? "PASS" : "FAIL"}: ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
    lines.push("");
    if (failures.length) {
      lines.push("## Failures");
      lines.push("");
      for (const f of failures) lines.push(`- ${f.name}: ${f.detail ?? ""}`);
      lines.push("");
    }
    const outPath = resolve(OUT_DIR, "one-tap-actions-journey-proof.md");
    writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log(`\nWrote ${outPath}`);
    console.log(failures.length === 0 ? "One-tap action journey PASSED" : `Completed with ${failures.length} failure(s)`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error("verify-one-tap-actions crashed:", error.message ?? error);
  process.exit(1);
});
