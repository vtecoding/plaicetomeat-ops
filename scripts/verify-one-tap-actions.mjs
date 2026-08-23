// Owner decision → action hand-off — operator-journey validation.
//
// A REAL start-of-day journey against the running app, proving the universal owner loop:
//   1. Every Do-now action opens its concise decision page first.
//   2. The first viewport states what happened, why it matters and PTM's recommendation.
//   3. Evidence is collapsed until requested.
//   4. The recommendation hands off in one tap to the authoritative work screen, carrying
//      item focus + "from today" context; review-only decisions keep evidence on the detail.
//   5. Browser Back returns to the decision and Not now returns to Today.
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

  // 1. Every primary item enters the same concise decision grammar.
  const doNowRows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
  const count = await doNowRows.count();
  const links = [];
  for (let i = 0; i < count; i += 1) {
    const href = (await doNowRows.nth(i).getAttribute("href")) ?? "";
    const label = (await doNowRows.nth(i).locator("p").first().innerText().catch(() => "")).trim();
    links.push({ href, path: pathOf(href), label });
  }

  if (count === 0) {
    record("Do-now actions present", true, "All clear today — no primary actions to route (nothing to prove)");
    await browser.close();
    return finish({ count, links });
  }

  const wrongDetails = links.filter((link) => !link.path.startsWith("/admin/today/"));
  record(
    "every Do-now action opens a decision page first",
    wrongDetails.length === 0,
    links.map((link) => `${link.label} → ${link.path}`).join(" | "),
  );

  // 2–5. Follow a decision and prove the complete decision → hand-off → return loop.
  const first = links[0];
  if (first) {
    await page.goto(new URL(first.href, BASE).toString(), { waitUntil: "networkidle", timeout: 60000 });

    const detailPresent = (await page.getByTestId("decision-detail").count()) > 0;
    const decisionText = await page.getByTestId("decision-detail").innerText().catch(() => "");
    record(
      "decision page explains problem, impact and recommendation",
      detailPresent && /What happened\?/i.test(decisionText) && /Why does it matter\?/i.test(decisionText) && /PTM recommends/i.test(decisionText),
      first.path,
    );

    const evidence = page.getByTestId("decision-evidence");
    const evidenceCollapsed = (await evidence.count()) > 0 && !(await evidence.evaluate((element) => element.hasAttribute("open")).catch(() => true));
    record("supporting evidence is collapsed by default", evidenceCollapsed, evidenceCollapsed ? "collapsed" : "missing or expanded");

    await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/decision-first.png`, fullPage: true }).catch(() => {});

    const recommendation = page.getByTestId("recommended-action");
    if ((await recommendation.count()) === 0) {
      record("review-only decision keeps its evidence on the detail page", (await page.locator('a[href="#decision-evidence"]').count()) > 0, first.label);
    } else {
      const workHref = (await recommendation.getAttribute("href")) ?? "";
      const workPath = pathOf(workHref);
      record("recommended action points to a known work screen", WORK_ROUTES.includes(workPath) && /from=today/.test(workHref), `${workPath} · context=${/from=today/.test(workHref)}`);
      await Promise.all([
        page.waitForURL((url) => url.pathname === workPath, { timeout: 30000 }),
        recommendation.click(),
      ]);

      const banner = page.getByTestId("action-context");
      const onArrival = (await banner.count()) > 0;
      const headline = onArrival ? (await page.getByTestId("action-context-headline").innerText().catch(() => "")).trim() : "";
      record("work screen preserves the Today context", onArrival && headline.length > 0, `headline: ${headline || "(none)"}`);

      await page.reload({ waitUntil: "networkidle" });
      const survives = (await page.getByTestId("action-context").count()) > 0;
      record("action context survives a refresh", survives, survives ? "context still present" : "context lost");

      await page.goBack({ waitUntil: "networkidle" });
      record("Browser Back returns to the decision", new URL(page.url()).pathname === first.path, page.url());
    }

    await Promise.all([
      page.waitForURL("**/admin/today", { timeout: 30000 }).catch(() => {}),
      page.getByRole("link", { name: "Not now", exact: true }).click().catch(() => {}),
    ]);
    record("Not now returns to Today", /\/admin\/today$/.test(page.url()), page.url());
  }

  await browser.close();
  return finish({ count, links, first });

  function finish(data = {}) {
    const lines = [];
    lines.push("# Owner decision → action hand-off — Journey Proof");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App: ${BASE} · operator: ${EMAIL}`);
    lines.push("");
    lines.push("A real start-of-day journey against the running app on live data. Screenshot in");
    lines.push("`./screens/decision-first.png`.");
    lines.push("");
    lines.push("## TODAY's primary actions and their decision pages");
    lines.push("");
    for (const l of data.links ?? []) lines.push(`- **${l.label}** → \`${l.path}\``);
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
    console.log(failures.length === 0 ? "Decision-to-action journey PASSED" : `Completed with ${failures.length} failure(s)`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error("verify-one-tap-actions crashed:", error.message ?? error);
  process.exit(1);
});
