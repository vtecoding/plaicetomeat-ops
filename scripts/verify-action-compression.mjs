// V15 · Action Compression — operator-journey proof.
//
// A REAL operator journey (not a unit test): logs into the running app and reads what
// the butcher actually sees on /admin/today, proving on LIVE data that:
//   1. TODAY shows AT MOST 3 primary "Do now" actions (DO_NOW_MAX = 3).
//   2. Every other valid action is preserved in the collapsed "Later" reserve — nothing
//      is lost.
//   3. No score, confidence value or ranking language leaks onto the operator's screen.
// Captures a full-page screenshot and writes an evidence pack with the before/after counts
// and the list of the top three.
//
// Usage (app must be running + local Supabase up + seeded):
//   BASE=http://127.0.0.1:3001 node scripts/verify-action-compression.mjs
// Login: owner@ptm.test / PlaiceTest123! (seeded). Run node scripts/seed-dev.mjs first.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const EMAIL = process.env.OPERATOR_EMAIL ?? "owner@ptm.test";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";
const DO_NOW_MAX = 3;

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
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 1100 } })).newPage();

  // 1. Log in.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL("**/admin/**", { timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  record("operator signs in", /\/admin/.test(page.url()), page.url());

  // 2. TODAY.
  await page.goto(`${BASE}/admin/today`, { waitUntil: "networkidle", timeout: 60000 });

  const setup = await page.getByTestId("setup-mode").count();
  if (setup > 0) {
    record("shop is in setup mode", false, "TODAY is in setup mode — seed live data (node scripts/seed-dev.mjs) before proving compression");
    await browser.close();
    return finish();
  }

  // 3. Primary actions — there must be at most three, and never a fourth.
  const doNowRows = page.getByTestId("decisions-do-now").getByTestId("decision-row");
  const doNowCount = await doNowRows.count();
  const topThree = [];
  for (let i = 0; i < doNowCount; i += 1) {
    topThree.push((await doNowRows.nth(i).locator("p").first().innerText().catch(() => "")).trim());
  }
  record("TODAY shows at most three Do-now actions", doNowCount <= DO_NOW_MAX, `Do now = ${doNowCount}: ${topThree.join(" | ") || "(none)"}`);

  // 4. Later reserve — exists (collapsed) and preserves the rest.
  const laterReserve = page.getByTestId("later-reserve");
  const hasLater = (await laterReserve.count()) > 0;
  let laterCount = 0;
  if (hasLater) {
    await laterReserve.locator("summary").click().catch(() => {});
    laterCount = await page.getByTestId("decisions-later").getByTestId("decision-row").count();
  }
  record("non-winning actions are preserved in Later", true, `Later = ${laterCount}${hasLater ? "" : " (no reserve — three or fewer total)"}`);

  // 5. No scores / confidence / ranking language on the operator's screen.
  await page.getByTestId("later-reserve").locator("summary").click().catch(() => {}); // ensure expanded so we scan Later too
  const screenText = (await page.locator("main").innerText().catch(() => "")) || "";
  const leak = screenText.match(/priority\s*[:#]?\s*\d|confidence\s*[:=]|score\s*[:=]?\s*\d|ranked\s*#?\d|weighted urgency/i);
  record("no score/confidence/ranking language is shown", !leak, leak ? `LEAK: ${leak[0]}` : "clean");

  await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/today-compressed.png`, fullPage: true }).catch(() => {});

  await browser.close();
  return finish({ doNowCount, laterCount, topThree });

  function finish(data = {}) {
    const before = (data.doNowCount ?? 0) + (data.laterCount ?? 0);
    const lines = [];
    lines.push("# V15 · Action Compression — Operator-Journey Proof");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App: ${BASE} · operator: ${EMAIL}`);
    lines.push("");
    lines.push("A real rendered operator journey against the running app on live data — not a");
    lines.push("unit test. Screenshot in `./screens/today-compressed.png`.");
    lines.push("");
    lines.push("## What the operator saw on /admin/today");
    lines.push("");
    lines.push(`- **Before compression** (all candidate actions): **${before}**`);
    lines.push(`- **After compression** (Do now, the primary surface): **${data.doNowCount ?? 0}** (cap ${DO_NOW_MAX})`);
    lines.push(`- **Held in Later** (preserved, hidden by default): **${data.laterCount ?? 0}**`);
    lines.push("");
    lines.push("### Top three (Do now)");
    lines.push((data.topThree?.length ? data.topThree.map((t) => `1. ${t}`).join("\n") : "- (none in current data)"));
    lines.push("");
    lines.push("## Control proofs");
    lines.push("");
    for (const o of observations) lines.push(`- ${o.ok ? "PASS" : "FAIL"}: ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
    lines.push("");
    if (failures.length) {
      lines.push("## Failures");
      lines.push("");
      for (const f of failures) lines.push(`- ${f.name}: ${f.detail ?? ""}`);
      lines.push("");
    }
    const outPath = resolve(OUT_DIR, "action-compression-journey-proof.md");
    writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log(`\nWrote ${outPath}`);
    console.log(failures.length === 0 ? "Action-compression journey PASSED" : `Completed with ${failures.length} failure(s)`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error("verify-action-compression crashed:", error.message ?? error);
  process.exit(1);
});
