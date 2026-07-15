#!/usr/bin/env node
/**
 * PTM Engineering Constitution — Architecture Check (Phase 1: The Spine).
 *
 * PTM already has a guard ecosystem — ~17 deterministic scripts that encode the
 * architectural principles built up over the V9–V17 audits (truth integrity, the
 * intelligence firewalls, route protection, owner-brain compliance, …). The problem was
 * never that they don't exist; it's that they were fragmented and only ever run when
 * someone remembered to. This runner promotes them into ONE enforceable gate.
 *
 * Design (deliberate):
 *   - Hard invariants only. Each guard is binary — it holds or it doesn't. No scores, no
 *     percentages: a fake "98%" is a number nobody can act on. We report PASS/FAIL + the
 *     name of what broke.
 *   - Tiered by dependency, so the fast path needs nothing. `static` guards are pure
 *     source/migration scans (run in the lint/test CI job). `db` guards need Supabase.
 *     `live` guards drive the running app. A guard outside the selected tier is SKIPPED
 *     (reported, never failed) — mirroring the release-report mode pattern.
 *
 * This is the SPINE. Complexity budgets (the ratchet) and the semantic review checklist
 * are later phases and deliberately NOT here.
 *
 * Usage:
 *   node scripts/architecture-check.mjs                 # static tier (default, CI-safe)
 *   node scripts/architecture-check.mjs --tier=all      # everything (local: DB + app up)
 *   node scripts/architecture-check.mjs --tier=static,db
 *   node scripts/architecture-check.mjs --list          # print the constitution articles
 *
 * Exit code: 0 iff every guard that actually ran passed.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * The articles of the constitution. Each entry is one enforceable invariant.
 *   principle — which architectural axis it protects (for the report grouping).
 *   tier      — static | db | live  (dependency class).
 */
const GUARDS = [
  // ── static: pure source / migration scans, no running services ──
  { id: "owner-brain-compliance", principle: "Decisions", tier: "static", script: "scripts/verify-owner-brain-compliance.mjs", what: "owner decision surfaces stay action-only (DO_NOW_MAX, no metrics)" },
  { id: "intelligence-firewall", principle: "Firewall", tier: "static", script: "scripts/verify-intelligence-firewall.mjs", what: "owner scoring internals never reach the UI" },
  { id: "operator-firewall", principle: "Firewall", tier: "static", script: "scripts/verify-operator-firewall.mjs", what: "operator surface carries no ranking/analytics vocabulary" },
  { id: "surface-convergence", principle: "Convergence", tier: "static", script: "scripts/verify-surface-convergence.mjs", what: "one surface per job — no competing duplicate screens" },
  { id: "operator-language", principle: "Language", tier: "static", script: "scripts/verify-operator-language.mjs", what: "operator copy stays plain, jargon-free" },
  { id: "rls-coverage", principle: "Security", tier: "static", script: "scripts/verify-rls-coverage.mjs", what: "every migrated table enables row level security (no fail-open new tables)" },
  { id: "operational-truth", principle: "Truth", tier: "static", script: "scripts/verify-operational-truth.mjs", what: "failures render as honest truth states, never demo data or fake empties" },
  { id: "migration-manifest", principle: "Release", tier: "static", script: "scripts/generate-migration-manifest.mjs", args: ["--check"], what: "generated migration manifest matches supabase/migrations (no curated-subset drift)" },
  { id: "alert-registry", principle: "Truth", tier: "static", script: "scripts/verify-alert-registry-parity.mjs", what: "SQL alert-kind seed and the TS alert registry stay one set (producers fail closed)" },
  { id: "web-push-boundaries", principle: "Truth", tier: "static", script: "scripts/verify-web-push-static.mjs", what: "Web Push keeps browser, adapter, payload, eligibility and secret boundaries" },

  // ── db: need a reachable Supabase ──
  { id: "truth-table-lock", principle: "Truth", tier: "db", script: "scripts/verify-truth-table-lock.mjs", what: "ledger & truth-table RLS lock — nothing bypasses the ledger" },
  { id: "next-order-ref-lock", principle: "Security", tier: "db", script: "scripts/verify-next-order-ref-lock.mjs", what: "next_order_ref denies anon/authenticated; only the internal command path advances the sequence" },
  { id: "shortfall-owner-alert", principle: "Truth", tier: "db", script: "scripts/verify-shortfall-owner-alert.mjs", what: "an oversell shortfall raises an unresolved owner_alert (no silent stock loss)" },
  { id: "required-compliance", principle: "Compliance", tier: "db", script: "scripts/verify-required-compliance.mjs", what: "required temperature/compliance evidence enforced" },
  { id: "compliance-integrity", principle: "Compliance", tier: "db", script: "scripts/verify-compliance-integrity.mjs", what: "temperature log RPCs hardened — no forgeable or fabricated evidence" },
  { id: "pricing-validation-integrity", principle: "Integrity", tier: "db", script: "scripts/verify-pricing-validation-integrity.mjs", what: "pricing validation recomputed server-side, not client-trusted" },
  { id: "disaster-recovery", principle: "Recovery", tier: "db", script: "scripts/verify-disaster-recovery.mjs", what: "backup/restore schema & objects exist" },
  { id: "disaster-recovery-integrity", principle: "Security", tier: "db", script: "scripts/verify-disaster-recovery-integrity.mjs", what: "recovery RPCs deny anonymous access" },
  { id: "edge-dispatcher", principle: "Truth", tier: "db", script: "scripts/verify-edge-dispatcher.mjs", nodeArgs: ["--import", "tsx"], what: "edge dispatcher sweep: lease/recover/record orchestration, concurrent invocations never share a dispatch, cron helpers round-trip" },
  { id: "dispatcher-certification", principle: "Truth", tier: "db", script: "scripts/verify-dispatcher-certification.mjs", nodeArgs: ["--import", "tsx"], what: "crash injection converges to legal states; replay idempotency; overlap, Vault fail-closed and global sanity invariants" },
  { id: "web-push", principle: "Truth", tier: "db", script: "scripts/verify-web-push.mjs", what: "verified device lifecycle, independent fan-out, open evidence and invalidation remain database-authoritative" },

  // ── live: drive the running app (need a booted server + seeded DB) ──
  { id: "operator-route-lock", principle: "Security", tier: "live", script: "scripts/verify-operator-route-lock.mjs", what: "operator routes are role-protected" },
  { id: "operator-journeys", principle: "Friction", tier: "live", script: "scripts/verify-operator-journeys.mjs", what: "operator journeys complete end-to-end" },
  { id: "action-compression", principle: "Decisions", tier: "live", script: "scripts/verify-action-compression.mjs", what: "Do-Now never exceeds three actions" },
  { id: "today-os", principle: "Decisions", tier: "live", script: "scripts/verify-today-os.mjs", what: "TODAY leads with Do-Now above the fold" },
  { id: "one-tap-actions", principle: "Friction", tier: "live", script: "scripts/verify-one-tap-actions.mjs", what: "every decision routes one tap to the work" },
  { id: "morning-briefing", principle: "Decisions", tier: "live", script: "scripts/verify-morning-briefing.mjs", what: "morning briefing orients without numbers" },
  { id: "customer-winback", principle: "Decisions", tier: "live", script: "scripts/verify-customer-winback.mjs", what: "lapsed-regular win-back surfaces correctly" },
];

const KNOWN_TIERS = ["static", "db", "live"];

function parseArgs(argv) {
  const args = { tiers: ["static"], list: false };
  for (const arg of argv) {
    if (arg === "--list") args.list = true;
    else if (arg === "--tier=all" || arg === "--all") args.tiers = [...KNOWN_TIERS];
    else if (arg.startsWith("--tier=")) {
      args.tiers = arg
        .slice("--tier=".length)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  const unknown = args.tiers.filter((t) => !KNOWN_TIERS.includes(t));
  if (unknown.length) {
    console.error(`Unknown tier(s): ${unknown.join(", ")}. Valid: ${KNOWN_TIERS.join(", ")}.`);
    process.exit(2);
  }
  return args;
}

function runGuard(guard) {
  const result = spawnSync("node", [...(guard.nodeArgs ?? []), guard.script, ...(guard.args ?? [])], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  });
  const ok = (result.status ?? 1) === 0;
  return { ok, status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const RULE = "═".repeat(72);
const PAD = 13;

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("\n  PTM Engineering Constitution — articles\n");
    for (const tier of KNOWN_TIERS) {
      console.log(`  [${tier}]`);
      for (const g of GUARDS.filter((x) => x.tier === tier)) {
        console.log(`    ${g.principle.padEnd(PAD)} ${g.what}`);
      }
      console.log("");
    }
    return;
  }

  const selected = new Set(args.tiers);
  console.log(`\n${RULE}`);
  console.log("  PTM Engineering Constitution — Architecture Check");
  console.log(`  Tiers: ${args.tiers.join(", ")}`);
  console.log(RULE);

  const ran = [];
  const skipped = [];

  for (const guard of GUARDS) {
    if (!selected.has(guard.tier)) {
      skipped.push(guard);
      continue;
    }
    const outcome = runGuard(guard);
    ran.push({ guard, outcome });
    const tag = outcome.ok ? "PASS" : "FAIL";
    console.log(`  ${tag}  ${guard.principle.padEnd(PAD)} ${guard.what}`);
    if (!outcome.ok) {
      // Surface the most useful failing line so the breakage is named, not hidden.
      const line = `${outcome.stdout}\n${outcome.stderr}`
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /fail|leak|error|denied|expected|violation|exceeded/i.test(l))
        .pop();
      if (line) console.log(`        ↳ ${line.slice(0, 110)}`);
      console.log(`        ↳ guard: ${guard.script} (exit ${outcome.status})`);
    }
  }

  const failures = ran.filter((r) => !r.outcome.ok);
  const passed = ran.length - failures.length;

  if (skipped.length) {
    console.log(`\n  Not run (outside selected tiers): ${skipped.length}`);
    for (const g of skipped) console.log(`  SKIP  ${g.principle.padEnd(PAD)} ${g.id} (${g.tier})`);
  }

  console.log(`\n${RULE}`);
  if (failures.length === 0) {
    console.log(`  RESULT: PASS  —  ${passed}/${ran.length} invariant(s) hold`);
    console.log(RULE + "\n");
    process.exit(0);
  } else {
    console.log(`  RESULT: FAIL  —  ${failures.length} invariant(s) broken: ${failures.map((f) => f.guard.id).join(", ")}`);
    console.log(RULE + "\n");
    process.exit(1);
  }
}

main();
