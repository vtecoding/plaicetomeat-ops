// V15.3 · Morning Briefing Engine — operator-journey validation.
//
// A REAL start-of-day journey: logs into the running app and proves that /admin/today
// opens with a short operational briefing the owner reads in under 30 seconds:
//   1. A three-section briefing (Yesterday / Today / Ignore) is present, each non-empty.
//   2. It sits ABOVE Do Now and fits above the fold — no scrolling to read it.
//   3. It carries no metric, number, percentage, confidence or ranking language.
//   4. It stays within the 100-word limit (target 40–80).
//   5. It is shorter than the actions it precedes (it orients; the actions decide).
//   6. It does not contradict Do Now.
// Captures a full-page screenshot and writes an evidence pack under docs/v15/.
//
// Usage (app must be running + local Supabase up + seeded):
//   BASE=http://127.0.0.1:3001 node scripts/verify-morning-briefing.mjs

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const EMAIL = process.env.OPERATOR_EMAIL ?? "owner@ptm.test";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";
const WORD_LIMIT = 100;
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

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

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
    record("shop has live data", false, "TODAY is in setup mode — seed data before validating the briefing");
    await browser.close();
    return finish();
  }

  // 1. The briefing exists with all three sections, each non-empty.
  const briefing = page.getByTestId("morning-briefing");
  const present = (await briefing.count()) > 0;
  record("morning briefing is present", present, present ? "found" : "missing");
  if (!present) {
    await browser.close();
    return finish();
  }

  const yesterday = (await page.getByTestId("briefing-yesterday").innerText().catch(() => "")).trim();
  const today = (await page.getByTestId("briefing-today").innerText().catch(() => "")).trim();
  const ignore = (await page.getByTestId("briefing-ignore").innerText().catch(() => "")).trim();
  record("three sections present and non-empty", [yesterday, today, ignore].every((s) => s.length > 0), `Y:${yesterday ? "y" : "-"} T:${today ? "y" : "-"} I:${ignore ? "y" : "-"}`);

  const briefingText = `${yesterday} ${today} ${ignore}`;
  // The section labels render inside the testids; strip them for the word/firewall checks.
  const body = briefingText.replace(/Yesterday|Today|You can ignore/gi, " ");

  // 2. Above Do Now + above the fold (no scrolling).
  const briefBox = (await briefing.boundingBox()) ?? { x: 0, y: 99999, width: 0, height: 99999 };
  const zone = page.getByTestId("do-now-zone");
  const zoneBox = (await zone.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  record("briefing sits above Do Now", briefBox.y < zoneBox.y, `briefing top=${Math.round(briefBox.y)}px, Do Now top=${Math.round(zoneBox.y)}px`);
  const allAboveFold = briefBox.y >= 0 && zoneBox.y + zoneBox.height <= VIEWPORT.height;
  record("briefing + Do Now read without scrolling (above the fold)", allAboveFold, `Do Now bottom=${Math.round(zoneBox.y + zoneBox.height)}px (viewport ${VIEWPORT.height}px)`);

  // 3. Information firewall — no numbers, percentages, confidence/ranking/score language.
  const numberLeak = body.match(/\d|%/);
  record("no metric / number / percentage in the briefing", !numberLeak, numberLeak ? `LEAK: ${numberLeak[0]}` : "clean");
  const jargonLeak = body.match(/confidence|score|rank|priorit|weight|doctrine/i);
  record("no confidence / ranking / score language in the briefing", !jargonLeak, jargonLeak ? `LEAK: ${jargonLeak[0]}` : "clean");

  // 4. Word limit.
  const wc = words(body);
  record("briefing within the 100-word limit", wc <= WORD_LIMIT, `${wc} words (target 40–80, max ${WORD_LIMIT})`);

  // 5. Shorter than the actions.
  const actionRows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
  const n = await actionRows.count();
  let actionWords = 0;
  for (let i = 0; i < n; i += 1) actionWords += words((await actionRows.nth(i).innerText().catch(() => "")) || "");
  record("briefing is shorter than the actions", n === 0 || wc < actionWords, `briefing ${wc} words vs actions ${actionWords} words`);

  // 6. Does not contradict Do Now (lightweight checks against the rendered actions).
  const actionText = (await page.getByTestId("decisions-do-now").innerText().catch(() => "")).toLowerCase();
  const mentionsCert = /certificate|compliance|food safety/.test(actionText);
  const contradictsCompliance = mentionsCert && /food safety checks are up to date/i.test(ignore);
  const contradictsClear = n > 0 && /looks clear/i.test(today);
  record("briefing does not contradict Do Now", !contradictsCompliance && !contradictsClear, contradictsCompliance ? "claims food safety fine while a cert action is live" : contradictsClear ? "says 'clear' while actions exist" : "consistent");

  await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/morning-briefing.png`, fullPage: true }).catch(() => {});

  await browser.close();
  return finish({ yesterday, today, ignore, wc, actionWords });

  function finish(data = {}) {
    const lines = [];
    lines.push("# V15.3 · Morning Briefing Engine — Operator-Journey Proof");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App: ${BASE} · operator: ${EMAIL} · viewport: ${VIEWPORT.width}×${VIEWPORT.height}`);
    lines.push("");
    lines.push("A real start-of-day journey against the running app. Screenshot in");
    lines.push("`./screens/morning-briefing.png`.");
    lines.push("");
    if (data.yesterday !== undefined) {
      lines.push("## The briefing the owner read");
      lines.push("");
      lines.push(`- **Yesterday:** ${data.yesterday}`);
      lines.push(`- **Today:** ${data.today}`);
      lines.push(`- **You can ignore:** ${data.ignore}`);
      lines.push("");
      lines.push(`Briefing length: **${data.wc} words** (limit ${WORD_LIMIT}). Actions length: ${data.actionWords} words.`);
      lines.push("");
    }
    lines.push("## Checks");
    lines.push("");
    for (const o of observations) lines.push(`- ${o.ok ? "PASS" : "FAIL"}: ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
    lines.push("");
    if (failures.length) {
      lines.push("## Failures");
      lines.push("");
      for (const f of failures) lines.push(`- ${f.name}: ${f.detail ?? ""}`);
      lines.push("");
    }
    const outPath = resolve(OUT_DIR, "morning-briefing-journey-proof.md");
    writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log(`\nWrote ${outPath}`);
    console.log(failures.length === 0 ? "Morning-briefing journey PASSED" : `Completed with ${failures.length} failure(s)`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error("verify-morning-briefing crashed:", error.message ?? error);
  process.exit(1);
});
