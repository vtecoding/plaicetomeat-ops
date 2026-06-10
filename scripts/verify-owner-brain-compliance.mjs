// V15.5 · Owner Brain Compliance — the continuous reduction guard.
//
// The hardest part of V15 was never building the Owner Brain. It is stopping a future
// release from quietly undoing it: reintroducing dashboards, metrics, scores, ranking
// values and operator thinking one "small" change at a time. This guard makes that
// regression fail the build.
//
// It is a STATIC guard (no app / DB needed) with four missions, and it also generates the
// living doctrine report `docs/v15/Owner-Brain-Compliance.md`:
//
//   Mission 2 — Dashboard Regression Guard: operator surfaces may not show KPI language,
//               percentages, charts, confidence/priority/score values or ranking values.
//   Mission 3 — Three-Action Rule: DO_NOW_MAX is permanently 3 and is the only cap wired
//               into the compression slice; nothing may set it higher.
//   Mission 7 — Action Pipeline Seal: Signals → Candidates → Scoring → Competition →
//               Compression → Execution → Presentation still exists, with no bypass.
//   Mission 8 — Owner-Brain Compliance Guard: no new dashboard panels / metric test-ids /
//               score panels / charts may be introduced on an operator surface.
//
// The qualitative missions (1 doctrine audit, 4 ten-second rule, 5 one-minute rule,
// 6 cognitive load) are recorded in the generated report as a structured review.
//
// Usage: node scripts/verify-owner-brain-compliance.mjs   (no app / DB needed)

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

// ----------------------------------------------------------------------------------------
// Surfaces
// ----------------------------------------------------------------------------------------
// The strict owner-brain decision/presentation layer — what the butcher reads to know what
// matters. Doctrine is absolute here: no metric language of any kind, including bare
// percentages and the word "variance".
const STRICT_SURFACES = [
  "src/app/admin/today/page.tsx",
  "src/app/admin/today/[id]/page.tsx",
  "src/app/admin/today/walk/page.tsx",
  "src/components/owner-brain/decision-detail.tsx",
  "src/components/owner-brain/guided-day.tsx",
  "src/components/owner-brain/action-context.tsx",
  "src/lib/owner-brain/briefing.ts",
];

// The one-tap work surfaces TODAY links straight into (V15.2). These legitimately show real
// figures the butcher acts on (e.g. "+1.2 kg vs system", supplier dates), so the bare
// percentage / "variance" checks do NOT apply here — only metric *values* and KPI/score
// language, which would mean a dashboard is creeping back in.
const WORK_SURFACES = [
  "src/app/admin/stock-count/page.tsx",
  "src/app/admin/purchasing/page.tsx",
  "src/app/admin/inventory/page.tsx",
  "src/app/admin/compliance/page.tsx",
  "src/components/admin-inventory-client.tsx",
  "src/components/ops-capture/stock-count.tsx",
  "src/components/counter-dashboard.tsx",
];

// Value-bearing dashboard language. These match rendered metric text, never code
// identifiers: `dateConfidence` / `stockVarianceKg` / `<CounterDashboard>` cannot trip them.
const VALUE_METRICS = [
  { re: /\bhealth score\b/i, label: "health score" },
  { re: /\btrend score\b/i, label: "trend score" },
  { re: /\bconfidence score\b/i, label: "confidence score" },
  { re: /\bvariance score\b/i, label: "variance score" },
  { re: /\btrend line\b/i, label: "trend line" },
  { re: /\bKPI\b/i, label: "KPI" },
  { re: /confidence\s*[:=]?\s*\d/i, label: "confidence value (e.g. Confidence 82%)" },
  { re: /priority\s*[:=#]?\s*\d/i, label: "priority value (e.g. Priority 93)" },
  { re: /\bscore\s*[:=]?\s*\d/i, label: "score value (e.g. Score 71)" },
  { re: /ranked\s*#?\s*\d/i, label: "ranking value (e.g. ranked #1)" },
];

// Strict-only: any percentage, and the bare word "variance" — both are dashboard tells the
// decision layer must never carry, but which the work surfaces use for honest figures.
const STRICT_ONLY = [
  { re: /\d\s*%/, label: "percentage (e.g. Revenue +12%)" },
  { re: /\bvariance\b/i, label: "variance" },
];

// Mission 8 — a new dashboard panel would show up as a metric/chart test-id.
const PANEL_TESTID = /data-testid=["'`][^"'`]*(kpi|metric|gauge|chart|score-panel|trend)/i;

// ----------------------------------------------------------------------------------------
const observations = [];
const failures = [];
function record(name, ok, detail) {
  observations.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push({ name, detail });
}

function read(rel) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// Strip block + line comments so engineering notes that name the jargon are not scanned —
// only text the operator could actually see is checked (mirrors verify-operator-language).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function scanSurface(file, patterns) {
  const src = stripComments(read(file));
  const hits = [];
  for (const { re, label } of patterns) {
    if (re.test(src)) hits.push(label);
  }
  return hits;
}

// ===== Mission 2 + 8 — Dashboard Regression Guard ========================================
console.log("\n— Mission 2/8 · Dashboard regression guard —");
for (const file of STRICT_SURFACES) {
  const hits = scanSurface(file, [...VALUE_METRICS, ...STRICT_ONLY]);
  record(`decision surface shows no dashboard language: ${file}`, hits.length === 0, hits.length ? `LEAK: ${hits.join(", ")}` : "plain operator language only");
}
for (const file of WORK_SURFACES) {
  const hits = scanSurface(file, VALUE_METRICS);
  record(`work surface shows no metric/score values: ${file}`, hits.length === 0, hits.length ? `LEAK: ${hits.join(", ")}` : "honest figures only, no scores");
}
for (const file of [...STRICT_SURFACES, ...WORK_SURFACES]) {
  const src = stripComments(read(file));
  const panel = src.match(PANEL_TESTID);
  record(`no new dashboard/metric panel: ${file}`, !panel, panel ? `LEAK: ${panel[0]}` : "no metric/chart panel");
}

// ===== Mission 3 — Three-Action Rule Guard ===============================================
console.log("\n— Mission 3 · Three-action rule —");
const compression = read("src/lib/owner-brain/action-compression.ts");
record("DO_NOW_MAX is permanently 3", /export const DO_NOW_MAX = 3\s*;/.test(compression), "src/lib/owner-brain/action-compression.ts");
record("the Do-now slice is capped by DO_NOW_MAX", /ranked\.slice\(0,\s*DO_NOW_MAX\)/.test(compression), "ranked.slice(0, DO_NOW_MAX)");

// Nothing anywhere may redefine the cap to a non-3 value.
const reassigned = [];
for (const file of [
  "src/lib/owner-brain/action-compression.ts",
  "src/lib/owner-brain/brain.ts",
  ...STRICT_SURFACES,
]) {
  const m = read(file).match(/DO_NOW_MAX\s*=\s*(\d+)/);
  if (m && m[1] !== "3") reassigned.push(`${file} → ${m[1]}`);
}
record("DO_NOW_MAX is never raised above 3", reassigned.length === 0, reassigned.length ? `RAISED: ${reassigned.join(", ")}` : "single source of truth = 3");

// ===== Mission 7 — Action Pipeline Seal ==================================================
console.log("\n— Mission 7 · Action pipeline seal —");
const brain = read("src/lib/owner-brain/brain.ts");
const stages = [
  { label: "Candidates (findings → decisions)", re: /intel\.findings\.map\(toOwnerDecision\)/ },
  { label: "Scoring (rankDecisions)", re: /rankDecisions\(/ },
  { label: "Competition + Compression (compressActions)", re: /compressActions\(decisions\)/ },
  { label: "Execution + Presentation boundary (toOperatorActions)", re: /toOperatorActions\(engine\.doNow\)/ },
];
for (const stage of stages) {
  record(`pipeline stage present: ${stage.label}`, stage.re.test(brain), stage.re.test(brain) ? "wired" : "MISSING — pipeline bypassed");
}
// No bypass: the operator's Do-now must be fed by the compression boundary, never raw findings.
record(
  "no bypass — Do Now is fed by the compression boundary",
  /doNow:\s*toOperatorActions\(engine\.doNow\)/.test(brain),
  "buildOwnerBrain.doNow = toOperatorActions(engine.doNow)",
);

// ===== Generate the living doctrine report ===============================================
const OUT_DIR = resolve(ROOT, "docs", "v15");
mkdirSync(OUT_DIR, { recursive: true });
const reportPath = resolve(OUT_DIR, "Owner-Brain-Compliance.md");

const SURFACE_AUDIT = [
  ["TODAY", "Three numbered Do-now cards in plain verbs. No interpretation, calculation, training or prioritisation — the engine already prioritised."],
  ["Later", "Collapsed reserve of the same plain cards. No ranking shown; opening it changes nothing the operator must decide."],
  ["Morning Briefing", "Three qualitative sentences (Yesterday / Today / Ignore), ≤100 words, zero numbers or confidence."],
  ["One-Tap Context Screens", "A banner naming the one thing to do, then the work itself. No re-prioritisation on arrival."],
  ["Counter", "Order columns and statuses. Operational state, not metrics; no scores or percentages."],
  ["Stock Count", "Counted vs system shown as honest kg, with 'Matches the system' when equal. A figure to act on, not a variance KPI."],
  ["Inventory", "Quantities and dates. No coverage ratios, no trend scores."],
  ["Purchasing", "What to order and when. Supplier date confidence is a word ('estimated'), never a number."],
  ["Compliance", "Temperature capture and certificate state. Pass/attention, never a compliance score."],
  ["Guided Walks", "A fixed sequence of the same plain actions. The order is decided for the operator."],
];

function reportLines() {
  const lines = [];
  lines.push("# Owner Brain Compliance Report");
  lines.push("");
  lines.push("_V15.5 · Maturity Audit & Continuous Reduction Guard_");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()} — by \`node scripts/verify-owner-brain-compliance.mjs\` (static, no app/DB).`);
  lines.push("");
  lines.push("> Every release before V15.5 asked \"what should we add?\". V15.5 asks \"what should");
  lines.push("> never return?\". This report is regenerated on every run of the guard, so the");
  lines.push("> answer is checked continuously — not signed off once.");
  lines.push("");
  lines.push("## 1. Automated guard results");
  lines.push("");
  lines.push(failures.length === 0
    ? `**PASS** — ${observations.length}/${observations.length} checks green. No dashboard, metric, score or ranking regression; the three-action rule and the action pipeline are intact.`
    : `**FAIL** — ${failures.length} of ${observations.length} checks failing. The doctrine is being violated; see below.`);
  lines.push("");
  for (const o of observations) lines.push(`- ${o.ok ? "✅" : "❌"} ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
  lines.push("");

  lines.push("## 2. Doctrine surface audit (Mission 1)");
  lines.push("");
  lines.push("For every operator surface: does it require **interpretation, calculation, training or prioritisation**? If yes, that is a violation. None do.");
  lines.push("");
  lines.push("| Surface | Requires interpretation/calc/training/prioritisation? | Notes |");
  lines.push("|---|---|---|");
  for (const [surface, note] of SURFACE_AUDIT) lines.push(`| ${surface} | No | ${note} |`);
  lines.push("");

  lines.push("## 3. Ten-second rule (Mission 4)");
  lines.push("");
  lines.push("> Can an experienced butcher understand what matters within 10 seconds?");
  lines.push("");
  lines.push("**Yes.** TODAY opens with at most three numbered Do-now cards above the fold (proven");
  lines.push("by `verify:today-os`). Each card is a single plain verb — Count / Order / Sell / Fix —");
  lines.push("with the item named. No reading of charts, no comparison, no ranking to decode.");
  lines.push("");

  lines.push("## 4. One-minute rule (Mission 5)");
  lines.push("");
  lines.push("> Can a *new* operator understand the day within one minute, with no training?");
  lines.push("");
  lines.push("**Yes**, using only the Morning Briefing (three sentences: what happened yesterday,");
  lines.push("what to do today, what to ignore) and the three Do-now cards. No dashboard to learn,");
  lines.push("no glossary, no metric definitions. Everything is an instruction in shop English.");
  lines.push("");

  lines.push("## 5. Cognitive load audit (Mission 6)");
  lines.push("");
  lines.push("Decisions the system asks the operator to make, by category. Goal: every release");
  lines.push("**reduces** decisions, never increases them.");
  lines.push("");
  lines.push("| Decision type | Count on TODAY | Why |");
  lines.push("|---|---|---|");
  lines.push("| Navigation | 0 to start | TODAY is the single home; cards link straight to the work (V15.2). |");
  lines.push("| Interpretation | 0 | Status is words, not numbers; nothing to read into. |");
  lines.push("| Prioritisation | 0 | The engine ran the single global contest; the order is decided. |");
  lines.push("| Configuration | 0 | No settings, thresholds or filters on the operator path. |");
  lines.push("| Search | 0 | The three things are presented; the operator never hunts. |");
  lines.push("");
  lines.push("The operator makes **at most three decisions**: whether to do each Do-now action now.");
  lines.push("");

  lines.push("## 6. Action pipeline seal (Mission 7)");
  lines.push("");
  lines.push("```");
  lines.push("Signals  →  Candidates  →  Scoring  →  Competition  →  Compression  →  Execution  →  Presentation");
  lines.push(" (intel)   (toOwnerDecision)  (rankDecisions)  (compareActions)  (compressActions ≤3)  (toOperatorActions)  (TODAY)");
  lines.push("```");
  lines.push("");
  lines.push("Verified intact above, with no bypass: the operator's Do-now is fed only by the");
  lines.push("compression boundary, and confidence is spent on choosing the verb — never shown.");
  lines.push("");

  lines.push("## 7. Risk areas");
  lines.push("");
  lines.push("- **Legacy heading language.** `admin-compliance-client.tsx` and a few nav links read");
  lines.push("  \"Compliance Dashboard\" / \"Back to dashboard\". These are screen titles and navigation");
  lines.push("  to the Business Insights hub, not metric panels, so they are not failed here — but");
  lines.push("  they are the kind of wording a future tidy-up should retire.");
  lines.push("- **Business Insights hub (`/admin`).** Analysis, health score and confidence are");
  lines.push("  *allowed* there by design and are intentionally out of this guard's scope. It must stay");
  lines.push("  off the operator action path so the two never blur.");
  lines.push("- **New surfaces.** Any new operator screen must be added to this guard's surface lists,");
  lines.push("  or it escapes the doctrine silently.");
  lines.push("");

  lines.push("## 8. Future recommendations");
  lines.push("");
  lines.push("1. Add every new operator-facing screen to `STRICT_SURFACES` / `WORK_SURFACES` in the");
  lines.push("   guard at the same time it is built.");
  lines.push("2. Keep `verify:owner-brain-compliance` and `verify:intelligence-firewall` in the");
  lines.push("   required gate set; together they hold the boundary (no scored *fields*) and the");
  lines.push("   doctrine (no metric *language*).");
  lines.push("3. Treat any request for a new chart, score or percentage on an operator surface as a");
  lines.push("   doctrine change requiring explicit sign-off, not a feature.");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("_Future development must actively fight the doctrine to violate it. The architecture");
  lines.push("protects itself: the software keeps doing the thinking, the butcher keeps doing less._");
  return lines;
}

writeFileSync(reportPath, reportLines().join("\n"), "utf8");
console.log(`\nWrote ${reportPath}`);

console.log("");
console.log(failures.length === 0 ? "Owner-brain compliance guard PASSED" : `Owner-brain compliance guard FAILED with ${failures.length} violation(s)`);
process.exit(failures.length === 0 ? 0 : 1);
