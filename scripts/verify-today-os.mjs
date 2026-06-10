// V15.1 · TODAY Operating System — operator-journey validation.
//
// A REAL start-of-day journey: logs into the running app and proves that /admin/today
// behaves like an operating system, not a dashboard:
//   1. Do Now is the dominant zone and sits ABOVE the fold — the operator can see every
//      priority in one glance, no scrolling.
//   2. At most three primary actions render.
//   3. No dashboard panel sits above Do Now (the "How the shop is doing" status panel is
//      retired; the weekly summary is demoted BELOW Do Now and collapsed).
//   4. Later is collapsed by default and secondary.
//   5. No score / confidence / ranking language leaks to the operator.
// Captures a full-page screenshot and writes an evidence pack.
//
// Usage (app must be running + local Supabase up + seeded):
//   BASE=http://127.0.0.1:3001 node scripts/verify-today-os.mjs

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const EMAIL = process.env.OPERATOR_EMAIL ?? "owner@ptm.test";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";
const DO_NOW_MAX = 3;
const VIEWPORT = { width: 1366, height: 1000 };

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

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();

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
    record("shop has live data", false, "TODAY is in setup mode — seed data before validating the operating system");
    await browser.close();
    return finish();
  }

  // 1. Do Now is the dominant, first zone and fits above the fold (no scrolling to see all).
  const zone = page.getByTestId("do-now-zone");
  const zoneBox = (await zone.boundingBox()) ?? { x: 0, y: 99999, width: 0, height: 99999 };
  const aboveFold = zoneBox.y + zoneBox.height <= VIEWPORT.height;
  record(
    "Do Now is above the fold — all priorities visible without scrolling",
    aboveFold,
    `zone top=${Math.round(zoneBox.y)}px bottom=${Math.round(zoneBox.y + zoneBox.height)}px (viewport ${VIEWPORT.height}px)`,
  );

  // 2. At most three primary actions.
  const doNowRows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
  const doNowCount = await doNowRows.count();
  const topThree = [];
  for (let i = 0; i < doNowCount; i += 1) {
    topThree.push((await doNowRows.nth(i).locator("p").first().innerText().catch(() => "")).trim());
  }
  record("at most three primary actions render", doNowCount <= DO_NOW_MAX, `Do now = ${doNowCount}: ${topThree.join(" | ") || "(none)"}`);

  // 3. No dashboard panel above Do Now. The retired status panel must be absent entirely.
  record("the 'How the shop is doing' status panel is retired", (await page.getByTestId("shop-status").count()) === 0, "shop-status not present");

  // 4. Weekly summary is demoted: present, but BELOW Do Now and collapsed by default.
  const weekly = page.getByTestId("weekly-owner-summary");
  const weeklyPresent = (await weekly.count()) > 0;
  let weeklyBelow = true;
  let weeklyCollapsed = true;
  if (weeklyPresent) {
    const weeklyBox = (await weekly.boundingBox()) ?? { y: 0 };
    weeklyBelow = weeklyBox.y > zoneBox.y;
    weeklyCollapsed = !(await weekly.evaluate((el) => el.open).catch(() => false));
  }
  record("weekly summary never outranks actions (below Do Now, collapsed)", weeklyBelow && weeklyCollapsed, `present=${weeklyPresent} below=${weeklyBelow} collapsed=${weeklyCollapsed}`);

  // 5. Later is collapsed by default and secondary.
  const later = page.getByTestId("later-reserve");
  const hasLater = (await later.count()) > 0;
  const laterCollapsed = hasLater ? !(await later.evaluate((el) => el.open).catch(() => false)) : true;
  let laterBelow = true;
  if (hasLater) {
    const laterBox = (await later.boundingBox()) ?? { y: 0 };
    laterBelow = laterBox.y > zoneBox.y;
  }
  record("Later is collapsed by default and below Do Now", laterCollapsed && laterBelow, `present=${hasLater} collapsed=${laterCollapsed} below=${laterBelow}`);

  // 6. No score / confidence / ranking language anywhere the operator can read.
  const screenText = (await page.locator("main").innerText().catch(() => "")) || "";
  const leak = screenText.match(/priority\s*[:#]?\s*\d|confidence\s*[:=]|score\s*[:=]?\s*\d|ranked\s*#?\d|weighted urgency/i);
  record("no score/confidence/ranking language is shown", !leak, leak ? `LEAK: ${leak[0]}` : "clean");

  await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/today-operating-system.png`, fullPage: true }).catch(() => {});

  await browser.close();
  return finish({ doNowCount, topThree, zoneBox, aboveFold });

  function finish(data = {}) {
    const lines = [];
    lines.push("# V15.1 · TODAY Operating System — Operator-Journey Proof");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App: ${BASE} · operator: ${EMAIL} · viewport: ${VIEWPORT.width}×${VIEWPORT.height}`);
    lines.push("");
    lines.push("A real start-of-day journey against the running app. Screenshot in");
    lines.push("`./screens/today-operating-system.png`.");
    lines.push("");
    lines.push("## What the operator saw on /admin/today");
    lines.push("");
    lines.push(`- **Primary actions (Do now):** ${data.doNowCount ?? 0} (cap ${DO_NOW_MAX})`);
    if (data.aboveFold !== undefined) lines.push(`- **All priorities above the fold (no scrolling):** ${data.aboveFold ? "yes" : "NO"}`);
    lines.push("");
    lines.push("### The three things to do now");
    lines.push(data.topThree?.length ? data.topThree.map((t, i) => `${i + 1}. ${t}`).join("\n") : "- (none in current data)");
    lines.push("");
    lines.push("## Operating-system checks");
    lines.push("");
    for (const o of observations) lines.push(`- ${o.ok ? "PASS" : "FAIL"}: ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
    lines.push("");
    if (failures.length) {
      lines.push("## Failures");
      lines.push("");
      for (const f of failures) lines.push(`- ${f.name}: ${f.detail ?? ""}`);
      lines.push("");
    }
    const outPath = resolve(OUT_DIR, "today-operating-system-proof.md");
    writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log(`\nWrote ${outPath}`);
    console.log(failures.length === 0 ? "TODAY operating-system journey PASSED" : `Completed with ${failures.length} failure(s)`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error("verify-today-os crashed:", error.message ?? error);
  process.exit(1);
});
