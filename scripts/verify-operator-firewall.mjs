// V17 · Operator Firewall — static boundary guard (no running app / DB needed).
//
// Extends the V15.4 Intelligence Firewall to the new Operator Mode surface.
// Uncle Gul must never see analytics, scores, percentages or owner-only
// intelligence. This proves it structurally: it scans every Operator-Mode source
// file and asserts:
//   1. No owner-brain internal scoring identifier is reachable.
//   2. No analytics/score jargon word appears (case-insensitive, whole word).
//   3. No literal percentage value (e.g. "80%") is rendered.
//
// Usage: node scripts/verify-operator-firewall.mjs
//
// Scope grows automatically as later phases add files — it walks the directories,
// it does not hardcode a file list.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const ROOT = process.cwd();

// Every directory the operator surface is built from. Adapters
// (src/app/actions/operator) may CALL domain actions but must not import
// owner-brain scoring internals or speak analytics — so they are scanned too.
const SCAN_DIRS = [
  "src/app/operator",
  "src/lib/operator",
  "src/app/actions/operator",
];

// Internal scoring identifiers that must never reach the operator surface.
const FORBIDDEN_IDENTIFIERS = [
  "getDecisionDiagnostics",
  "ScoredAction",
  "OwnerDecision",
  "DecisionDiagnostics",
  "ActionEvidence",
  "estimatedImpact",
  "sourceEvidence",
  "compressActions",
  "classifyDoctrine",
];

// Analytics / judgement jargon the operator must never be shown. Matched as
// whole words, case-insensitive, in copy AND comments (the surface stays clean).
const FORBIDDEN_WORDS = [
  "confidence",
  "variance",
  "percentile",
  "percentage",
  "priority",
  "kpi",
  "dashboard",
  "analytics",
  "forecast",
  "score",
];

const observations = [];
const failures = [];
function record(name, ok, detail) {
  observations.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push({ name, detail });
}

function walk(dir) {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(relative(ROOT, full)));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap(walk);
record("operator surface has files to scan", files.length > 0, `${files.length} file(s)`);

const wordRegexes = FORBIDDEN_WORDS.map((w) => ({ w, re: new RegExp(`\\b${w}\\b`, "i") }));
const percentRe = /\d\s*%/;

for (const file of files) {
  const src = readFileSync(resolve(ROOT, file), "utf8");

  const idHits = FORBIDDEN_IDENTIFIERS.filter((id) => src.includes(id));
  const wordHits = wordRegexes.filter(({ re }) => re.test(src)).map(({ w }) => w);
  const percentHit = percentRe.test(src);

  const leaks = [
    ...idHits.map((h) => `identifier:${h}`),
    ...wordHits.map((h) => `word:${h}`),
    ...(percentHit ? ["percentage value"] : []),
  ];

  record(`operator surface is clean: ${file}`, leaks.length === 0, leaks.length ? `LEAK: ${leaks.join(", ")}` : "no analytics/score leakage");
}

console.log("");
console.log(failures.length === 0 ? "Operator-firewall guard PASSED" : `Operator-firewall guard FAILED with ${failures.length} violation(s)`);
process.exit(failures.length === 0 ? 0 : 1);
