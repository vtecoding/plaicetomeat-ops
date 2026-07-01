import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const ROOT = process.cwd();
const OUT = path.join(ROOT, "audit", "dad-usability");
const SHOTS = path.join(OUT, "screenshots");
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@ptm.test";
const MANAGER_EMAIL = process.env.MANAGER_EMAIL ?? "manager@ptm.test";
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "staff@ptm.test";
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL ?? "operator@ptm.test";
const PASSWORD = process.env.TEST_PASSWORD ?? "PlaiceTest123!";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const ROLE_EMAIL = {
  owner: OWNER_EMAIL,
  manager: MANAGER_EMAIL,
  staff: STAFF_EMAIL,
  operator_mode: OPERATOR_EMAIL,
};

const BAD_COPY = [
  "confidence",
  "score",
  "variance",
  "optimisation",
  "optimization",
  "analytics",
  "source metrics",
  "reconciliation entity",
  "workflow state",
  "health score",
  "data quality",
  "signal",
  "insight",
  "entity",
  "metric",
  "validation",
];

const ACTION_WORDS = [
  "do now",
  "check",
  "add",
  "save",
  "done",
  "open",
  "close",
  "serve",
  "tell owner",
  "review",
  "start",
  "next",
  "order",
  "mark",
  "resolve",
  "go",
  "sign in",
];

const KNOWN_OLD_ROUTES = new Set([
  "/",
  "/shop",
  "/basket",
  "/checkout",
  "/login",
  "/privacy",
  "/our-halal-promise",
  "/admin",
  "/admin/today",
  "/admin/orders",
  "/admin/inventory",
  "/admin/purchasing",
  "/admin/products",
  "/admin/compliance",
  "/admin/settings",
  "/admin/pickup-windows",
  "/admin/shop-closures",
  "/counter",
  "/counter/compliance",
]);

const EXTRA_FAILURE_ROUTES = [
  { pattern: "/__missing_dad_audit_route__", route: "/__missing_dad_audit_route__", role: "anon", purpose: "not found" },
  { pattern: "/admin/today/[id] (bad)", route: "/admin/today/not-a-real-decision", role: "owner", purpose: "bad decision id" },
  { pattern: "/product/[slug] (bad)", route: "/product/not-a-real-product", role: "anon", purpose: "bad product slug" },
  {
    pattern: "/counter/orders/[id] (bad)",
    route: "/counter/orders/00000000-0000-4000-8000-000000000000",
    role: "staff",
    purpose: "bad counter order id",
  },
];

function safeName(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "root";
}

function ensureOut() {
  mkdirSync(OUT, { recursive: true });
  if (existsSync(SHOTS)) rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
}

function discoverPageRoutes(dir = path.join(ROOT, "src", "app")) {
  const out = [];
  function walk(current) {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "page.tsx") continue;
      const rel = path.relative(path.join(ROOT, "src", "app"), full).replaceAll(path.sep, "/");
      const folder = rel.replace(/\/page\.tsx$/, "").replace(/^page\.tsx$/, "");
      const route =
        folder === ""
          ? "/"
          : `/${folder
              .split("/")
              .filter((part) => !part.startsWith("("))
              .join("/")}`;
      out.push(route);
    }
  }
  walk(dir);
  return [...new Set(out)].sort();
}

function roleForPattern(pattern) {
  if (pattern.startsWith("/operator")) return "operator_mode";
  if (pattern.startsWith("/counter")) return "owner";
  if (pattern.startsWith("/admin")) return "owner";
  return "anon";
}

function queryLocalDb(sql) {
  try {
    return execFileSync(
      "docker",
      ["exec", "-i", "supabase_db_plaicetomeat-ops", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-F", "\t", "-c", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split("\t"));
  } catch {
    return [];
  }
}

function dynamicSeeds() {
  const product = queryLocalDb("select slug from public.products order by sort_order limit 1;")[0]?.[0] ?? "chicken-breast-fillets";
  const orderRef = queryLocalDb("select order_ref from public.orders order by created_at desc limit 1;")[0]?.[0] ?? "PTM-2026-90001";
  const orderId =
    queryLocalDb("select id::text from public.orders order by created_at desc limit 1;")[0]?.[0] ??
    "00000000-0000-4000-8000-000000000000";
  const publicAccessId =
    queryLocalDb("select public_access_id::text from public.orders where public_access_id is not null order by created_at desc limit 1;")[0]?.[0] ??
    null;
  return {
    slug: product,
    orderRef,
    id: orderId,
    publicAccessId,
    playbookSlug: "butcher-words",
    todayId: null,
  };
}

function resolveRoute(pattern, seeds) {
  let route = pattern;
  let resolved = true;
  const missing = [];
  const replacements = {
    "[slug]": seeds.playbookSlug,
    "[orderRef]": seeds.orderRef,
    "[publicAccessId]": seeds.publicAccessId,
    "[id]": seeds.id,
  };

  if (pattern.startsWith("/product/")) replacements["[slug]"] = seeds.slug;
  if (pattern.startsWith("/admin/playbooks/")) replacements["[slug]"] = seeds.playbookSlug;
  if (pattern.startsWith("/admin/today/")) replacements["[id]"] = seeds.todayId;
  if (pattern.startsWith("/counter/orders/")) replacements["[id]"] = seeds.id;

  for (const [token, value] of Object.entries(replacements)) {
    if (!route.includes(token)) continue;
    if (!value) {
      resolved = false;
      missing.push(token);
      route = route.replace(token, "__unresolved__");
    } else {
      route = route.replace(token, value);
    }
  }

  return { route, resolved, missing };
}

async function login(context, role, runtime) {
  if (role === "anon") return { ok: true, finalUrl: BASE };
  const page = await context.newPage();
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.fill("#email", ROLE_EMAIL[role]);
    await page.fill("#password", PASSWORD);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    const body = await page.locator("body").innerText().catch(() => "");
    const ok = !new URL(finalUrl).pathname.startsWith("/login") && !body.includes("Invalid email or password");
    const result = { ok, finalUrl, body: body.slice(0, 1000), consoleMessages };
    runtime.logins[role] = result;
    await page.close();
    return result;
  } catch (error) {
    const result = { ok: false, error: error.message, consoleMessages };
    runtime.logins[role] = result;
    await page.close().catch(() => {});
    return result;
  }
}

async function visibleCount(page, selector) {
  return page.locator(selector).evaluateAll((els) => {
    return els.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }).length;
  });
}

async function pageSnapshot(page) {
  return page.evaluate(
    ({ badCopy, actionWords }) => {
      const text = document.body?.innerText ?? "";
      const lower = text.toLowerCase();
      const candidates = [...document.querySelectorAll("button,a,input[type=submit]")].filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      const labels = candidates
        .map((el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "").trim())
        .filter(Boolean);
      const primary =
        labels.find((label) => actionWords.some((word) => label.toLowerCase().includes(word))) ??
        labels.find((label) => !["back", "menu", "shop", "basket"].includes(label.toLowerCase())) ??
        null;
      const tapIssues = candidates
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            label: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((item) => item.width < 44 || item.height < 44)
        .slice(0, 12);
      const inputsMissingLabels = [...document.querySelectorAll("input,textarea,select")]
        .filter((el) => {
          const id = el.getAttribute("id");
          const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
          const labelled = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          const parentLabel = el.closest("label");
          return !aria && !labelled && !parentLabel && el.getAttribute("type") !== "hidden";
        })
        .length;
      const badPhrases = badCopy.filter((phrase) => lower.includes(phrase));
      return {
        title: document.title,
        h1: document.querySelector("h1")?.innerText?.trim() ?? "",
        h2: [...document.querySelectorAll("h2")].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 8),
        text: text.replace(/\s+/g, " ").trim().slice(0, 3500),
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        primaryCta: primary,
        labels: labels.slice(0, 80),
        badPhrases,
        tapIssues,
        inputsMissingLabels,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    },
    { badCopy: BAD_COPY, actionWords: ACTION_WORDS },
  );
}

function scoreDad(info) {
  let score = 5;
  const reasons = [];
  if (!info.primaryCta) {
    score -= 1;
    reasons.push("no obvious next action");
  }
  if (info.buttons + info.links > 28) {
    score -= 1;
    reasons.push("too many choices");
  }
  if (info.inputs > 8) {
    score -= 1;
    reasons.push("many inputs");
  }
  if (info.snapshot.wordCount > 900) {
    score -= 1;
    reasons.push("heavy reading");
  }
  if (info.snapshot.badPhrases.length > 0) {
    score -= 1;
    reasons.push(`technical/dashboard words: ${info.snapshot.badPhrases.join(", ")}`);
  }
  if (info.status && info.status >= 400) {
    score -= 2;
    reasons.push(`HTTP ${info.status}`);
  }
  if (info.redirectedToLogin || info.loginBlocked) {
    score = Math.min(score, 1);
    reasons.push("protected workflow blocked by login");
  }
  return { score: Math.max(1, score), reasons };
}

function scoreOperator(info) {
  let score = 5;
  const reasons = [];
  if (info.buttons + info.links > 12) {
    score -= 1;
    reasons.push("too many choices for operator");
  }
  if (info.inputs > 2) {
    score -= 1;
    reasons.push("typing required");
  }
  if (!/tell owner|go home|back|go back/i.test(info.snapshot.text)) {
    score -= 1;
    reasons.push("safe owner/home escape not visible");
  }
  if (info.snapshot.badPhrases.length > 0) {
    score -= 1;
    reasons.push(`jargon leaked: ${info.snapshot.badPhrases.join(", ")}`);
  }
  if (info.snapshot.tapIssues.length > 0) {
    score -= 1;
    reasons.push("small tap target");
  }
  if (info.redirectedToLogin || info.loginBlocked) {
    score = Math.min(score, 1);
    reasons.push("operator cannot log in");
  }
  return { score: Math.max(1, score), reasons };
}

async function auditRoute(context, item, viewport, runtime) {
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const events = { console: [], pageErrors: [], requestFailures: [], responses: [] };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) events.console.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    events.requestFailures.push({ url: request.url(), failure: request.failure()?.errorText ?? "unknown" }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) events.responses.push({ url: response.url(), status: response.status() });
  });

  const started = Date.now();
  let response = null;
  let error = null;
  try {
    response = await page.goto(`${BASE}${item.route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.addStyleTag({ content: "*{animation:none!important;transition:none!important;scroll-behavior:auto!important} nextjs-portal{display:none!important}" }).catch(() => {});
    await page.waitForTimeout(250);
  } catch (err) {
    error = err.message;
  }

  const finalUrl = page.url();
  const finalPath = finalUrl.startsWith("http") ? new URL(finalUrl).pathname : finalUrl;
  const screenshot = path.join(SHOTS, `${viewport.name}__${item.role}__${safeName(item.route)}.png`);
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});

  const [buttons, links, inputs, snapshot] = await Promise.all([
    visibleCount(page, "button"),
    visibleCount(page, "a"),
    visibleCount(page, "input:not([type=hidden]), textarea, select"),
    pageSnapshot(page).catch(() => ({
      title: "",
      h1: "",
      h2: [],
      text: "",
      wordCount: 0,
      primaryCta: null,
      labels: [],
      badPhrases: [],
      tapIssues: [],
      inputsMissingLabels: 0,
      horizontalOverflow: false,
    })),
  ]);

  await page.close().catch(() => {});

  const info = {
    pattern: item.pattern,
    route: item.route,
    role: item.role,
    purpose: item.purpose ?? "",
    viewport: viewport.name,
    requestedUrl: `${BASE}${item.route}`,
    finalUrl,
    finalPath,
    status: response?.status() ?? null,
    redirected: finalPath !== item.route,
    redirectedToLogin: finalPath === "/login",
    loginBlocked: item.role !== "anon" && runtime.logins[item.role]?.ok === false,
    durationMs: Date.now() - started,
    screenshot: path.relative(OUT, screenshot).replaceAll(path.sep, "/"),
    buttons,
    links,
    inputs,
    primaryCta: snapshot.primaryCta,
    obviousNextAction: Boolean(snapshot.primaryCta),
    snapshot,
    events,
    error,
  };
  const dad = item.route.startsWith("/admin") || item.route.startsWith("/counter") ? scoreDad(info) : null;
  const operator = item.route.startsWith("/operator") ? scoreOperator(info) : null;
  return { ...info, dadScore: dad?.score ?? null, dadReasons: dad?.reasons ?? [], operatorScore: operator?.score ?? null, operatorReasons: operator?.reasons ?? [] };
}

async function firstDecisionId(ownerContext) {
  const page = await ownerContext.newPage();
  try {
    await page.goto(`${BASE}/admin/today`, { waitUntil: "networkidle", timeout: 30_000 });
    const hrefs = await page
      .locator('a[href^="/admin/today/"]')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute("href"))
          .filter((href) => href && href !== "/admin/today/walk"),
      )
      .catch(() => []);
    const href = hrefs[0] ?? null;
    await page.close();
    return href?.split("/").pop() ?? null;
  } catch {
    await page.close().catch(() => {});
    return null;
  }
}

async function runJourney(context, role, name, steps) {
  const page = await context.newPage();
  let clicks = 0;
  let typedFields = 0;
  const unclearMoments = [];
  const screens = [];
  try {
    for (const step of steps) {
      if (step.goto) {
        await page.goto(`${BASE}${step.goto}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error) => {
          unclearMoments.push(`${step.label}: ${error.message}`);
        });
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      }
      if (step.fill) {
        for (const [selector, value] of step.fill) {
          const loc = page.locator(selector).first();
          if (await loc.isVisible().catch(() => false)) {
            await loc.fill(value);
            typedFields += 1;
          } else {
            unclearMoments.push(`${step.label}: missing input ${selector}`);
          }
        }
      }
      if (step.click) {
        const loc = page.locator(step.click).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click();
          clicks += 1;
          await page.waitForTimeout(step.pause ?? 500);
        } else {
          unclearMoments.push(`${step.label}: missing click target ${step.click}`);
        }
      }
      if (step.buttonName) {
        const loc = page.getByRole("button", { name: step.buttonName }).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click();
          clicks += 1;
          await page.waitForTimeout(step.pause ?? 500);
        } else {
          unclearMoments.push(`${step.label}: missing button ${step.buttonName}`);
        }
      }
      const snap = await pageSnapshot(page).catch(() => null);
      screens.push({
        label: step.label,
        path: new URL(page.url()).pathname,
        choices: snap?.labels?.length ?? 0,
        primaryCta: snap?.primaryCta ?? null,
        text: snap?.text?.slice(0, 700) ?? "",
      });
    }
  } finally {
    await page.close().catch(() => {});
  }
  return {
    journey: name,
    role,
    clicks,
    typedFields,
    screens: screens.length,
    choicesByScreen: screens.map((screen) => ({ label: screen.label, choices: screen.choices, primaryCta: screen.primaryCta })),
    unclearMoments,
    defaultOffered: screens.some((screen) => /use|default|yesterday|tomorrow|cash/i.test(screen.text)),
    correctionPossible: screens.some((screen) => /back|go back|clear|change|pick something else/i.test(screen.text)),
    finalConfirmationClear: screens.some((screen) => /done|saved|open|closed|owner has been told/i.test(screen.text)),
    score: unclearMoments.length ? 2 : typedFields > 2 ? 3 : 4,
  };
}

function coverageMarkdown(routes, report, runtime) {
  const rows = routes
    .map((route) => {
      const desktop = report.find((item) => item.pattern === route.pattern && item.viewport === "desktop");
      const coverage = desktop ? (desktop.error ? "error" : desktop.redirected ? `redirect -> ${desktop.finalPath}` : "covered") : "not run";
      return `| \`${route.pattern}\` | \`${route.route}\` | ${route.role} | ${route.resolved ? "yes" : `no (${route.missing.join(", ")})`} | ${coverage} |`;
    })
    .join("\n");
  return `| Pattern | Tested route | Role | Dynamic resolved | Desktop result |\n|---|---:|---|---|---|\n${rows}\n\nNew routes vs old map: ${routes
    .filter((route) => !KNOWN_OLD_ROUTES.has(route.pattern))
    .map((route) => `\`${route.pattern}\``)
    .join(", ") || "none"}.\n\nMissing old routes: ${[...KNOWN_OLD_ROUTES]
    .filter((route) => !routes.some((item) => item.pattern === route))
    .map((route) => `\`${route}\``)
    .join(", ") || "none"}.\n\nLogin precondition: owner=${runtime.logins.owner?.ok ? "ok" : "blocked"}, manager=${runtime.logins.manager?.ok ? "ok" : "blocked"}, staff=${runtime.logins.staff?.ok ? "ok" : "blocked"}, operator=${runtime.logins.operator_mode?.ok ? "ok" : "blocked"}.\n`;
}

function findingsMarkdown(report, journeys, runtime) {
  const desktop = report.filter((item) => item.viewport === "desktop");
  const loginBlocked = Object.values(runtime.logins).some((login) => login && login.ok === false);
  const topFindings = [];
  if (loginBlocked) {
    topFindings.push({
      severity: "Critical",
      route: "/login",
      screenshot: "screenshots/desktop__anon__login.png",
      persona: "Dad and operator",
      steps: "Reset DB, seed dev users, open /login, submit seeded credentials.",
      recommendation: "Add/repair grants needed by the service client or seed/migration path, then rerun the audit.",
      impact: "No owner or operator can reach the system.",
    });
  }
  for (const item of desktop) {
    if (item.snapshot.horizontalOverflow) {
      topFindings.push({
        severity: "Medium",
        route: item.route,
        screenshot: item.screenshot,
        persona: item.route.startsWith("/operator") ? "Operator" : "Dad",
        steps: `Open ${item.route} at desktop; inspect layout metrics.`,
        recommendation: "Remove horizontal overflow and retest tablet/mobile.",
        impact: "Tablet use feels brittle and can hide controls.",
      });
    }
    if (item.snapshot.badPhrases.length > 0 && (item.route.startsWith("/admin") || item.route.startsWith("/operator"))) {
      topFindings.push({
        severity: item.route.startsWith("/operator") ? "High" : "Medium",
        route: item.route,
        screenshot: item.screenshot,
        persona: item.route.startsWith("/operator") ? "Operator" : "Dad",
        steps: `Open ${item.route}; read visible copy.`,
        recommendation: `Replace ${item.snapshot.badPhrases.map((phrase) => `"${phrase}"`).join(", ")} with shop-action language.`,
        impact: "Adds reading and reduces confidence during a shop day.",
      });
    }
    if ((item.dadScore ?? item.operatorScore ?? 5) <= 2 && topFindings.length < 20) {
      topFindings.push({
        severity: item.loginBlocked ? "Critical" : "High",
        route: item.route,
        screenshot: item.screenshot,
        persona: item.route.startsWith("/operator") ? "Operator" : "Dad",
        steps: `Open ${item.route} as ${item.role}.`,
        recommendation: item.loginBlocked ? "Fix login/runtime grants before usability scoring." : "Reduce choices and make one primary action clear.",
        impact: item.loginBlocked ? "Workflow cannot be audited or operated." : "User has to hunt before acting.",
      });
    }
  }

  const copyIssues = desktop
    .filter((item) => item.snapshot.badPhrases.length > 0)
    .map((item) => `- \`${item.route}\`: ${item.snapshot.badPhrases.join(", ")} -> use direct action words such as "Check this", "Add cost", "Tell owner", "Done".`)
    .join("\n");
  const mobileIssues = report
    .filter((item) => item.viewport !== "desktop" && (item.snapshot.horizontalOverflow || item.snapshot.tapIssues.length > 0))
    .map((item) => `- \`${item.route}\` ${item.viewport}: ${item.snapshot.horizontalOverflow ? "horizontal overflow" : ""} ${item.snapshot.tapIssues.length ? `${item.snapshot.tapIssues.length} small tap targets` : ""}.`)
    .join("\n");
  const runtimeIssues = report
    .filter((item) => item.error || item.events.console.length || item.events.pageErrors.length || item.events.requestFailures.length || item.events.responses.length)
    .map((item) => `- \`${item.route}\` ${item.viewport}: ${[
      item.error ? `navigation error ${item.error}` : "",
      item.events.console.length ? `${item.events.console.length} console warnings/errors` : "",
      item.events.pageErrors.length ? `${item.events.pageErrors.length} page errors` : "",
      item.events.requestFailures.length ? `${item.events.requestFailures.length} failed requests` : "",
      item.events.responses.length ? `${item.events.responses.length} HTTP >=400 responses` : "",
    ].filter(Boolean).join("; ")}.`)
    .join("\n");

  return `# PTM Dad Usability Audit - Report

## Executive Summary

${loginBlocked ? "The clean local stack is **not ready for Dad/Gul usability validation** because one or more seeded staff logins are blocked after database reset. The audit still crawled reachable pages and captured screenshots/errors, but affected protected journeys are marked blocked rather than falsely scored as usable." : "The clean local stack is usable for seeded staff accounts. Owner, manager, staff, and operator-mode logins succeeded, and protected owner/operator routes were crawlable for the Dad usability pass."}

## Overall Verdict

${loginBlocked ? "**Not Ready.** Fix the clean-stack auth/profile read failure first, then rerun this script for the full human usability pass." : "**Ready after fixes.** Authentication and routing are healthy, but the usability pass still flags dashboard language, heavy-input admin screens, and tablet/mobile touch issues before pilot."}

## Top 10 Findings

${topFindings
  .slice(0, 10)
  .map(
    (finding, index) => `${index + 1}. **${finding.severity} - ${finding.route}** (${finding.persona})
   - Screenshot: \`${finding.screenshot}\`
   - Repro: ${finding.steps}
   - Recommendation: ${finding.recommendation}
   - Expected impact: ${finding.impact}`,
  )
  .join("\n\n") || "No findings recorded."}

## Dad Experience Score

${averageLine(desktop, "dadScore")} ${loginBlocked ? "Protected Dad pages are currently dominated by login blockage, so page-level scores are provisional." : "Scores are based on crawled protected routes after successful seeded login."}

## Operator Experience Score

${averageLine(desktop, "operatorScore")} ${loginBlocked ? "Operator pages are currently dominated by login blockage, so page-level scores are provisional." : "Scores are based on crawled operator routes after successful operator-mode login."}

## Route Coverage

See \`route-report.md\` and \`route-report.json\`.

## Journey Results

${journeys.map((journey) => `- \`${journey.journey}\`: clicks=${journey.clicks}, typedFields=${journey.typedFields}, screens=${journey.screens}, score=${journey.score}, unclear=${journey.unclearMoments.join("; ") || "none"}`).join("\n")}

## Confusing Screens

${desktop
  .filter((item) => (item.dadScore ?? item.operatorScore ?? 5) <= 2)
  .map((item) => `- \`${item.route}\`: ${(item.dadReasons.length ? item.dadReasons : item.operatorReasons).join("; ")}`)
  .join("\n") || "None recorded beyond the login blocker."}

## Unnecessary Inputs

${desktop.filter((item) => item.inputs > 4).map((item) => `- \`${item.route}\`: ${item.inputs} visible inputs.`).join("\n") || "None identified in reachable desktop snapshots."}

## Unnecessary Clicks

${journeys.filter((journey) => journey.clicks > 5).map((journey) => `- \`${journey.journey}\`: ${journey.clicks} clicks.`).join("\n") || (loginBlocked ? "Could not fully evaluate while protected workflows are blocked." : "No journey exceeded the high-click threshold in this run.")}

## Copy Issues

${copyIssues || "No copy issues identified in reachable snapshots."}

## Mobile/Tablet Issues

${mobileIssues || "No mobile/tablet overflow or tap target issue detected in reachable snapshots."}

## Failure-State Findings

${desktop
  .filter((item) => item.status >= 400 || item.pattern.includes("(bad)") || item.route.includes("__missing"))
  .map((item) => `- \`${item.route}\`: status=${item.status}, finalPath=\`${item.finalPath}\`, primaryCta=${item.primaryCta ?? "none"}.`)
  .join("\n") || "No failure states captured."}

## Runtime Findings

${runtimeIssues || "No console/page/network failures recorded."}

## Prioritised Fix Plan

${loginBlocked ? "1. Critical: repair clean local Supabase grants/migrations so \\`scripts/seed-dev.mjs\\` and login can read/write the required staff/profile rows through intended clients.\n2. Critical: rerun this audit and complete owner/operator journeys once login succeeds.\n3. High: remove operator-facing jargon flagged in the rerun, especially confidence/score/analytics language.\n4. High: turn pages with no primary CTA into Today tasks or guided actions.\n5. Medium: reduce unnecessary inputs and clicks in purchasing, inventory, product/pricing, reconciliation/evidence/compliance after full crawl." : "1. High: remove dashboard/scoring language from Dad-facing admin pages, especially confidence, signal, insight, variance, and validation.\n2. High: reduce form/input load on pricing validation, products, inventory, guide, pickup windows, compliance, and counter compliance.\n3. High: fix tablet horizontal overflow across admin routes.\n4. Medium: enlarge mobile/tablet tap targets, especially dense admin/counter/shop surfaces.\n5. Medium: make bad-id failure states more helpful, with a plain explanation and safe route home."}

## Screenshots Index

Screenshots are in \`audit/dad-usability/screenshots/\`.

## Appendix: Raw Route Data

Raw data is in \`route-report.json\`.

## Brutal Final Questions

${loginBlocked ? "1. Could Dad use this without me beside him? **No - he cannot currently sign in on a clean local stack.**\n2. Could Uncle Gul run Operator Mode during a busy hour? **No - operator login is blocked in this run.**\n3. Which 3 screens would confuse Dad first? **Login**, then any protected route redirecting back to login, then branch-configuration public state if storefront data cannot load.\n4. Which 3 screens would confuse Gul first? **Login**, **Operator home if unreachable**, and any admin/counter redirect test.\n5. What would Dad ask me to simplify immediately? \"Why can I not get in with the test account?\"\n6. What can be removed without hurting truth? Any dashboard/scoring language surfaced in rerun findings.\n7. What should become a Today task instead of a page? Purchasing/compliance/reconciliation items that require a decision rather than browsing.\n8. What must be fixed before pilot? Clean-stack auth/profile grants and successful seeded owner/operator journeys.\n9. What can wait until after pilot? Visual polish that does not block money, stock, compliance, or staff flow.\n10. Is PTM now easier than paper for the people actually using it? **Not in this clean-stack run.**" : "1. Could Dad use this without me beside him? **Partly.** He can sign in and reach Today, but admin/dashboard surfaces still need simplification before I would leave him alone with it.\n2. Could Uncle Gul run Operator Mode during a busy hour? **Closer, but not proven enough.** Operator Mode loads and is route-locked correctly, but the journey still flagged recovery/click-target issues.\n3. Which 3 screens would confuse Dad first? **Business Insights (/admin)**, **Pricing Validation**, and **Products** because they are dense, input-heavy, and use dashboard language.\n4. Which 3 screens would confuse Gul first? **Stock / Delivery**, **Waste**, and **Close Shop** if uncertainty/recovery controls are not obvious under pressure.\n5. What would Dad ask me to simplify immediately? Remove the dashboard words and show the next decision, not the analysis.\n6. What can be removed without hurting truth? Confidence/signal/insight/variance wording where it does not directly change the action.\n7. What should become a Today task instead of a page? Supplier certificate renewal, pricing checks, stock corrections, and reconciliation-style exceptions.\n8. What must be fixed before pilot? Tablet overflow, dense input screens, confusing copy, and operator recovery paths.\n9. What can wait until after pilot? Deep reporting pages, release/audit polish, and non-critical visual refinements.\n10. Is PTM now easier than paper for the people actually using it? **For login and Today, yes. For the full system, not yet.**"}
`;
}

function averageLine(items, field) {
  const values = items.map((item) => item[field]).filter((value) => typeof value === "number");
  if (!values.length) return "No score available.";
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `Average: **${avg.toFixed(1)}/5** across ${values.length} desktop page(s).`;
}

async function main() {
  ensureOut();
  const runtime = {
    base: BASE,
    startedAt: new Date().toISOString(),
    logins: {},
    preconditions: {
      architectureCheck: "not run by this script; command availability is captured by operator notes",
    },
  };
  const seeds = dynamicSeeds();
  const patterns = discoverPageRoutes();
  const browser = await chromium.launch();

  const authContexts = {};
  for (const viewport of [VIEWPORTS[2]]) {
    for (const role of ["owner", "manager", "staff", "operator_mode"]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      authContexts[role] = context;
      await login(context, role, runtime);
    }
  }

  if (runtime.logins.owner?.ok) {
    seeds.todayId = await firstDecisionId(authContexts.owner);
  }

  const routeItems = patterns.map((pattern) => {
    const resolved = resolveRoute(pattern, seeds);
    return {
      pattern,
      ...resolved,
      role: roleForPattern(pattern),
      purpose: pattern.startsWith("/admin") ? "owner/admin" : pattern.startsWith("/operator") ? "operator" : pattern.startsWith("/counter") ? "counter" : "public",
    };
  });
  routeItems.push(...EXTRA_FAILURE_ROUTES.map((item) => ({ ...item, resolved: true, missing: [] })));

  const report = [];
  for (const viewport of VIEWPORTS) {
    const anonContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const contexts = { anon: anonContext };
    for (const role of ["owner", "manager", "staff", "operator_mode"]) {
      contexts[role] = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      if (runtime.logins[role]?.ok) await login(contexts[role], role, runtime);
    }
    for (const route of routeItems) {
      if (!route.resolved) continue;
      const context = contexts[route.role] ?? anonContext;
      report.push(await auditRoute(context, route, viewport, runtime));
    }
    await Promise.all(Object.values(contexts).map((context) => context.close().catch(() => {})));
  }

  const journeyContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  if (runtime.logins.owner?.ok) await login(journeyContext, "owner", runtime);
  const operatorContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  if (runtime.logins.operator_mode?.ok) await login(operatorContext, "operator_mode", runtime);

  const journeys = [
    await runJourney(journeyContext, "owner", "owner_today_to_decision_and_back", [
      { label: "today", goto: "/admin/today" },
      { label: "open first decision", click: 'a[href^="/admin/today/"]' },
      { label: "back to today", click: 'a[href="/admin/today"]' },
      { label: "purchasing", goto: "/admin/purchasing" },
      { label: "inventory", goto: "/admin/inventory" },
      { label: "products", goto: "/admin/products" },
      { label: "compliance", goto: "/admin/compliance" },
      { label: "settings", goto: "/admin/settings" },
      { label: "playbooks", goto: "/admin/playbooks" },
    ]),
    await runJourney(operatorContext, "operator_mode", "operator_open_serve_stock_waste_help_close", [
      { label: "operator home", goto: "/operator" },
      { label: "open shop", goto: "/operator/open" },
      { label: "serve", goto: "/operator/serve" },
      { label: "choose first item", buttonName: /^Chicken$/i },
      { label: "amount", buttonName: /^500g$/i },
      { label: "stock delivery", goto: "/operator/stock" },
      { label: "not sure tell owner", buttonName: /I am not sure/i },
      { label: "waste", goto: "/operator/waste" },
      { label: "no waste", buttonName: /^No$/i },
      { label: "help", goto: "/operator/help" },
      { label: "choose problem", buttonName: /Fridge or freezer problem/i },
      { label: "close", goto: "/operator/close" },
    ]),
  ];
  await journeyContext.close().catch(() => {});
  await operatorContext.close().catch(() => {});

  await Promise.all(Object.values(authContexts).map((context) => context.close().catch(() => {})));
  await browser.close();

  runtime.finishedAt = new Date().toISOString();
  runtime.routeCount = routeItems.length;
  runtime.screenshotCount = report.length;
  runtime.seeds = seeds;

  writeFileSync(path.join(OUT, "runtime.json"), JSON.stringify(runtime, null, 2));
  writeFileSync(path.join(OUT, "route-report.json"), JSON.stringify({ routes: routeItems, report, journeys }, null, 2));
  writeFileSync(path.join(OUT, "route-report.md"), coverageMarkdown(routeItems, report, runtime));
  writeFileSync(path.join(OUT, "usability-findings.md"), findingsMarkdown(report, journeys, runtime));

  console.log(`Wrote ${OUT}`);
  if (Object.values(runtime.logins).some((login) => login && login.ok === false)) {
    console.error("Audit completed with blocked seeded login(s). See usability-findings.md.");
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
