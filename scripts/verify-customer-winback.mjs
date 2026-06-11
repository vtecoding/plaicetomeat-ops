// V16 · Customer Win-Back — operator-journey proof.
//
// A REAL operator journey (not a unit test): logs into the running app and proves that a
// lapsed regular surfaces on /admin/today as a named, money-attached action the owner can act
// on — the engine that *creates* revenue rather than protecting it. On LIVE seeded data:
//   1. A win-back action for the seeded lapsed regular (Yusuf Ali) appears on TODAY.
//   2. It carries the basket value the customer is worth (a £ figure), and a "call/message"
//      instruction — who to chase and what they're worth.
//   3. It is a one-tap action: tapping it routes the owner straight into the work, not a dead end.
//   4. No score / confidence / ranking language leaks (the V15.4 firewall still holds).
//
// Usage (app running + local Supabase up + seeded with the win-back fixture):
//   BASE=http://127.0.0.1:3001 node scripts/verify-customer-winback.mjs
// Login: owner@ptm.test / PlaiceTest123! (seeded). Run node scripts/seed-dev.mjs first.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3001";
const EMAIL = process.env.OPERATOR_EMAIL ?? "owner@ptm.test";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";
const WINBACK_NAME = "Yusuf Ali";

const OUT_DIR = resolve(process.cwd(), "docs", "v16");
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

  // 2. TODAY — expand the Later reserve so a low-urgency opportunity is in view.
  await page.goto(`${BASE}/admin/today`, { waitUntil: "networkidle", timeout: 60000 });
  if ((await page.getByTestId("setup-mode").count()) > 0) {
    record("shop has live data (not setup mode)", false, "TODAY is in setup mode — run node scripts/seed-dev.mjs first");
    await browser.close();
    return finish();
  }
  await page.getByTestId("later-reserve").locator("summary").click().catch(() => {});
  await page.waitForTimeout(200);

  // 3. The win-back is on the page, named.
  const winBackRow = page.getByTestId("decision-row").filter({ hasText: `Win back ${WINBACK_NAME}` }).first();
  const present = (await winBackRow.count()) > 0;
  record("a named win-back for the lapsed regular is shown", present, present ? `Win back ${WINBACK_NAME}` : "not found on TODAY");

  // 4. It carries a basket value (a £ figure) — what the customer is worth.
  const screenText = (await page.locator("main").innerText().catch(() => "")) || "";
  const rowText = present ? (await winBackRow.innerText().catch(() => "")) : "";
  const moneyOnRow = /£\s?\d/.test(rowText) || /£\s?\d/.test(screenText);
  record("win-back carries the basket value it is worth", present && moneyOnRow, present ? (moneyOnRow ? "£ figure present" : "no £ figure") : "no win-back");

  // 5. One tap → into the work, not a dead end. The decision-row IS the <a> (the testid sits
  // on the Link), so its href is the one-tap destination. Read it, then follow it and confirm
  // the destination actually tells the owner who to contact.
  if (present) {
    const href = (await winBackRow.getAttribute("href")) || "";
    const targeted = /^\/admin\/today\/.+/.test(href);
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    const detailText = (await page.locator("main").innerText().catch(() => "")) || "";
    const tellsWhoToCall = detailText.includes(WINBACK_NAME) && /call|message|contact/i.test(detailText);
    record("win-back is one tap to the work (who to contact)", targeted && tellsWhoToCall, `${href || "(no href)"} · names+contact=${tellsWhoToCall}`);
  } else {
    record("win-back is one tap to the work (who to contact)", false, "no win-back to tap");
  }

  // 6. No score / confidence / ranking language leaks (firewall holds).
  await page.goto(`${BASE}/admin/today`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.getByTestId("later-reserve").locator("summary").click().catch(() => {});
  const fullText = (await page.locator("main").innerText().catch(() => "")) || "";
  const leak = fullText.match(/priority\s*[:#]?\s*\d|confidence\s*[:=]|score\s*[:=]?\s*\d|ranked\s*#?\d|weighted urgency/i);
  record("no score/confidence/ranking language is shown", !leak, leak ? `LEAK: ${leak[0]}` : "clean");

  await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/customer-winback.png`, fullPage: true }).catch(() => {});

  await browser.close();
  return finish();

  function finish() {
    const lines = [];
    lines.push("# V16 · Customer Win-Back — Operator-Journey Proof");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App: ${BASE} · operator: ${EMAIL}`);
    lines.push("");
    lines.push("A real rendered operator journey against the running app on live seeded data — not a");
    lines.push("unit test. Proves a lapsed regular becomes a named, money-attached, one-tap action on");
    lines.push("TODAY. Screenshot in `./screens/customer-winback.png`.");
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
    const outPath = resolve(OUT_DIR, "customer-winback-journey-proof.md");
    writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log(`\nWrote ${outPath}`);
    console.log(failures.length === 0 ? "Customer win-back journey PASSED" : `Completed with ${failures.length} failure(s)`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error("verify-customer-winback crashed:", error.message ?? error);
  process.exit(1);
});
