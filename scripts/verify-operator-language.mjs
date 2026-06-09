// V14.3 · Workstream D+F — Operator language guard.
//
// Static scan of OPERATOR-FACING source for two classes of forbidden wording:
//   1. LEGACY inventory language that contradicts the V14 truth engine
//      (e.g. "sales are not deducted automatically") — these are factually
//      wrong now that collected orders deplete stock.
//   2. JARGON the butcher must never see (e.g. "inventory variance",
//      "confidence degraded", "movement ledger").
//
// Scope (doctrine): operator surfaces only — TODAY, Counter, Inventory,
// Purchasing, Compliance, open/close/stock-count, guide/playbooks, and the
// owner-brain + operator-guidance text generators.
//
// EXEMPT (intentionally NOT scanned): the /admin "Business Insights" analysis
// hub (analysis/health/confidence are *allowed* there), and deploy/audit pages
// ("Deployment Ledger", audit log) where "ledger" is not inventory language.
//
// Comments are stripped before scanning so engineering notes that mention the
// jargon (this file, confidence-routing.ts, etc.) do not trip the guard — only
// text the operator could actually see is checked. Test files are skipped.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();

// Operator-facing roots to scan (files or directories, scanned recursively).
const INCLUDE = [
  "src/app/admin/today",
  "src/app/admin/open",
  "src/app/admin/close",
  "src/app/admin/stock-count",
  "src/app/admin/purchasing",
  "src/app/admin/inventory",
  "src/app/admin/compliance",
  "src/app/admin/guide",
  "src/app/admin/playbooks",
  "src/app/counter",
  "src/components/admin-inventory-client.tsx",
  "src/lib/owner-brain",
  "src/lib/domain/operator-guidance.ts",
];

// Paths that must never be scanned even if nested under an included root.
const EXEMPT = [
  "src/app/admin/releases",
  "src/app/admin/audit",
  "src/app/admin/briefing",
  "src/app/admin/validation",
  // The language firewall itself: this file *defines* the forbidden terms as
  // data (regex + list), so it legitimately contains every jargon phrase.
  "src/lib/owner-brain/language.ts",
];

// 1. Legacy inventory wording — hard fail (contradicts V14 truth).
const LEGACY = [
  "not deducted automatically",
  "sales are not deducted",
  "not sales-decremented",
  "no-sales-decrement",
  "intake/count based",
  "sales do not affect stock",
  "sales don't affect stock",
  "only changes when counted",
  "stock is updated during counts",
  "stock only updates when you count",
];

// 2. Jargon — mirrors owner-brain language.ts FORBIDDEN_TERMS. Multi-word only,
//    so it cannot collide with code identifiers (e.g. `varianceKg`).
const JARGON = [
  "yield variance",
  "inventory discrepancy",
  "inventory adjustment",
  "operational health",
  "purchasing discipline",
  "coverage ratio",
  "stock coverage",
  "confidence score",
  "data quality score",
  "data confidence",
  "margin compression",
  "forecast degradation",
  "depletion forecast",
  "forecasted exhaustion",
  "stock exhaustion",
  "stock discrepancy",
  "inventory variance",
  "stock reconciliation",
  "movement ledger",
  "shortfall event",
  "depletion failure",
  "inventory confidence",
  "confidence degraded",
];

const FORBIDDEN = [...LEGACY.map((p) => ({ phrase: p, kind: "legacy" })), ...JARGON.map((p) => ({ phrase: p, kind: "jargon" }))];

function isExempt(relPath) {
  const norm = relPath.split("\\").join("/");
  return EXEMPT.some((ex) => norm.startsWith(ex));
}

function collectFiles(target) {
  const abs = join(ROOT, target);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return [abs];
  const out = [];
  for (const entry of readdirSync(abs, { recursive: true })) {
    const full = join(abs, entry.toString());
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(full))) continue;
    if (/\.test\.[tj]sx?$/.test(full)) continue;
    out.push(full);
  }
  return out;
}

// Strip block and line comments so engineering notes are not scanned.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const files = [...new Set(INCLUDE.flatMap(collectFiles))];
const violations = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (isExempt(rel)) continue;
  const stripped = stripComments(readFileSync(file, "utf8"));
  const lower = stripped.toLowerCase();
  for (const { phrase, kind } of FORBIDDEN) {
    let idx = lower.indexOf(phrase);
    while (idx !== -1) {
      const line = stripped.slice(0, idx).split("\n").length;
      violations.push({ rel, line, phrase, kind });
      idx = lower.indexOf(phrase, idx + phrase.length);
    }
  }
}

console.log(`Operator language guard — scanned ${files.length} operator-facing file(s).`);
if (violations.length === 0) {
  console.log("PASS: no legacy inventory wording or operator jargon found.");
  process.exit(0);
}

console.error(`\nFAIL: ${violations.length} forbidden phrase(s) on operator surfaces:\n`);
for (const v of violations) {
  console.error(`  [${v.kind}] ${v.rel}:${v.line}  →  "${v.phrase}"`);
}
console.error("\nReplace with plain butcher English aligned to V14 truth (see docs/v14/v14.3/language-audit.md).");
process.exit(1);
