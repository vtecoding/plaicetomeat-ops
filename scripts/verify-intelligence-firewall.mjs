// V15.4 · Intelligence Firewall — static boundary guard.
//
// Proves the firewall structurally, with no running app: it reads the operator-facing
// source files and asserts they cannot reach internal scoring.
//   1. No operator/UI module imports an internal decision type or engine function
//      (ScoredAction, OwnerDecision, ActionEvidence, DecisionDiagnostics,
//       getDecisionDiagnostics, compressActions, classifyDoctrine, resolveActionTarget,
//       classifyActionType).
//   2. No operator/UI module reaches internal scored fields
//      (.priority, sourceEvidence, actionEvidence, .estimatedImpact, .category).
//   3. The action-rendering modules DO consume the external OperatorAction type.
//   4. The single transformation boundary exists (operator-action.ts → toOperatorAction)
//      and the engine actually crosses it (brain.ts imports toOperatorActions).
//
// Usage: node scripts/verify-intelligence-firewall.mjs   (no app / DB needed)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

// Operator-facing surfaces: everything the butcher's screens are built from.
const OPERATOR_FILES = [
  "src/app/admin/today/page.tsx",
  "src/app/admin/today/[id]/page.tsx",
  "src/app/admin/today/walk/page.tsx",
  "src/components/owner-brain/decision-detail.tsx",
  "src/components/owner-brain/guided-day.tsx",
  "src/components/owner-brain/action-context.tsx",
  "src/lib/owner-brain/briefing.ts",
];

// Identifiers / accessors that must never appear in an operator surface.
const FORBIDDEN = [
  "ScoredAction",
  "OwnerDecision",
  "ActionEvidence",
  "DecisionDiagnostics",
  "getDecisionDiagnostics",
  "compressActions",
  "classifyDoctrine",
  "resolveActionTarget",
  "classifyActionType",
  "actionEvidence",
  ".priority",
  "sourceEvidence",
  ".estimatedImpact",
  ".category",
];

// Modules that render actions must speak the external type.
const MUST_USE_OPERATOR_ACTION = [
  "src/app/admin/today/page.tsx",
  "src/components/owner-brain/decision-detail.tsx",
  "src/components/owner-brain/guided-day.tsx",
  "src/lib/owner-brain/briefing.ts",
];

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

// 1 + 2. No operator surface reaches internal scoring.
for (const file of OPERATOR_FILES) {
  const src = read(file);
  const hits = FORBIDDEN.filter((term) => src.includes(term));
  record(`operator surface is firewalled: ${file}`, hits.length === 0, hits.length ? `LEAK: ${hits.join(", ")}` : "no internal scoring reachable");
}

// 3. Action-rendering modules consume the external type.
for (const file of MUST_USE_OPERATOR_ACTION) {
  const src = read(file);
  record(`consumes OperatorAction: ${file}`, src.includes("OperatorAction"), src.includes("OperatorAction") ? "ok" : "does not reference OperatorAction");
}

// 4. The single transformation boundary exists and the engine crosses it.
const boundary = read("src/lib/owner-brain/operator-action.ts");
record(
  "transformation boundary exists (toOperatorAction)",
  boundary.includes("export function toOperatorAction"),
  "operator-action.ts → toOperatorAction",
);
const brain = read("src/lib/owner-brain/brain.ts");
record(
  "engine crosses the boundary before returning the operator brain",
  brain.includes("toOperatorActions("),
  "brain.ts converts scored → operator via toOperatorActions",
);

// Internal evidence is preserved on the internal path only (Mission 7).
record(
  "internal diagnostics path is preserved (getDecisionDiagnostics)",
  brain.includes("export function getDecisionDiagnostics"),
  "scored picture + evidence reachable for audit/dev, not via the operator brain",
);

console.log("");
console.log(failures.length === 0 ? "Intelligence-firewall guard PASSED" : `Intelligence-firewall guard FAILED with ${failures.length} violation(s)`);
process.exit(failures.length === 0 ? 0 : 1);
