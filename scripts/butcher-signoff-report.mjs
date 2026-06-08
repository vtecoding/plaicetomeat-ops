// V13.1 — Butcher sign-off report generator.
//
// Reads the captured pricing_validations for a branch from the (local by default)
// Supabase stack and writes docs/butcher-signoff-report.md: per-species tables of
// system-vs-butcher figures, price variance, and the per-cut verdict, plus an overall
// APPROVED / CHANGES REQUIRED / INCOMPLETE sign-off.
//
// This is evidence, not a gate: it reports honestly on whatever the butcher recorded.
// An INCOMPLETE or CHANGES REQUIRED result is a real finding, not a script failure, so
// it exits 0. The V13.5 launch gate decides pass/fail. Pass --strict to exit non-zero
// unless the verdict is APPROVED (for use inside a gate).

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const BRANCH_ID = process.env.PRICING_VALIDATION_BRANCH_ID ?? "00000000-0000-4000-8000-000000000001";
const STRICT = process.argv.includes("--strict");

// Saleable (non-waste) cut ids per species — mirrors src/lib/butchery/cut-sheets.ts.
// Used to judge review completeness (an unreviewed cut keeps the verdict INCOMPLETE).
const EXPECTED = {
  lamb: { label: "Lamb", cuts: ["leg", "shoulder", "loin-chops", "rack", "breast", "neck", "shanks", "mince-trim"] },
  goat: { label: "Goat", cuts: ["leg", "shoulder", "ribs-chops", "loin", "neck", "shanks", "curry-mince"] },
  beef: { label: "Beef", cuts: ["chuck", "brisket", "rib", "sirloin", "rump", "topside", "silverside", "flank", "shin", "mince-trim"] },
  chicken: { label: "Chicken", cuts: ["breast", "thigh", "drumstick", "wing", "carcass"] },
};
const SPECIES_ORDER = ["lamb", "goat", "beef", "chicken"];

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

function fmtPct(v) {
  return v === null ? "—" : `${Math.round(v * 1000) / 10}%`;
}

function fmtMoney(v) {
  return v === null ? "—" : `£${Number(v).toFixed(2)}`;
}

function fmtVariance(v) {
  if (v === null) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${n}%`;
}

function speciesVerdict(species, byCut) {
  const expected = EXPECTED[species].cuts;
  let approved = 0;
  let changes = 0;
  const outstanding = [];
  for (const cutId of expected) {
    const row = byCut.get(cutId);
    if (!row || row.decision === "pending") outstanding.push(cutId);
    else if (row.decision === "approved") approved += 1;
    else if (row.decision === "changes_required") changes += 1;
  }
  let verdict;
  if (changes > 0) verdict = "CHANGES REQUIRED";
  else if (outstanding.length > 0) verdict = "INCOMPLETE";
  else verdict = "APPROVED";
  return { verdict, approved, changes, outstanding, total: expected.length };
}

async function main() {
  const { data, error } = await service
    .from("pricing_validations")
    .select("species, cut_id, cut_name, system_yield_pct, system_price_per_kg, butcher_yield_pct, butcher_price_per_kg, variance_pct, decision, notes, butcher_name, reviewed_at")
    .eq("branch_id", BRANCH_ID);

  if (error) {
    console.error(`butcher-signoff-report: could not read pricing_validations: ${error.message}`);
    process.exit(1);
  }

  const rows = data ?? [];
  const bySpecies = new Map(SPECIES_ORDER.map((s) => [s, new Map()]));
  const butchers = new Set();
  let lastReviewed = null;
  for (const row of rows) {
    if (!bySpecies.has(row.species)) continue;
    bySpecies.get(row.species).set(row.cut_id, row);
    if (row.butcher_name) butchers.add(row.butcher_name);
    if (row.reviewed_at && (!lastReviewed || row.reviewed_at > lastReviewed)) lastReviewed = row.reviewed_at;
  }

  const speciesResults = SPECIES_ORDER.map((s) => ({ species: s, ...speciesVerdict(s, bySpecies.get(s)) }));
  const totalExpected = speciesResults.reduce((a, r) => a + r.total, 0);
  const totalApproved = speciesResults.reduce((a, r) => a + r.approved, 0);
  const totalChanges = speciesResults.reduce((a, r) => a + r.changes, 0);

  let overall;
  if (totalChanges > 0) overall = "CHANGES REQUIRED";
  else if (totalApproved === totalExpected && totalExpected > 0) overall = "APPROVED";
  else overall = "INCOMPLETE";

  const lines = [];
  lines.push("# Butcher Sign-off Report — V13.1 Pricing Validation");
  lines.push("");
  lines.push(`_Generated: ${new Date().toISOString()} · Branch: ${BRANCH_ID}_`);
  lines.push("");
  lines.push(`## Verdict: ${overall}`);
  lines.push("");
  lines.push(`- Saleable cuts approved: **${totalApproved} / ${totalExpected}**`);
  if (totalChanges > 0) lines.push(`- Cuts needing changes: **${totalChanges}**`);
  lines.push(`- Butcher(s): ${butchers.size ? [...butchers].join(", ") : "_not recorded_"}`);
  lines.push(`- Last reviewed: ${lastReviewed ?? "_never_"}`);
  lines.push("");
  if (overall === "CHANGES REQUIRED") {
    lines.push("> **The butcher rejected one or more pricing assumptions.** Per the V13 spec this is a");
    lines.push("> launch FAIL until the flagged cuts are corrected and re-approved. See the notes below.");
    lines.push("");
  } else if (overall === "INCOMPLETE") {
    lines.push("> Not every saleable cut has been reviewed yet. The sign-off is not valid evidence");
    lines.push("> until all cuts carry an Approved or Changes-required verdict.");
    lines.push("");
  } else {
    lines.push("> Every saleable cut of every species has been reviewed and approved by the butcher.");
    lines.push("");
  }

  for (const result of speciesResults) {
    const meta = EXPECTED[result.species];
    const byCut = bySpecies.get(result.species);
    lines.push(`## ${meta.label} — ${result.verdict} (${result.approved}/${result.total} approved)`);
    lines.push("");
    lines.push("| Cut | System yield | System £/kg | Butcher yield | Butcher £/kg | Variance | Verdict | Notes |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const cutId of meta.cuts) {
      const row = byCut.get(cutId);
      if (!row) {
        lines.push(`| ${cutId} | — | — | — | — | — | _not reviewed_ | |`);
        continue;
      }
      const verdict = row.decision === "approved" ? "Approved" : row.decision === "changes_required" ? "Changes required" : "Not reviewed";
      lines.push(
        `| ${row.cut_name} | ${fmtPct(num(row.system_yield_pct))} | ${fmtMoney(num(row.system_price_per_kg))} | ` +
          `${fmtPct(num(row.butcher_yield_pct))} | ${fmtMoney(num(row.butcher_price_per_kg))} | ${fmtVariance(num(row.variance_pct))} | ` +
          `${verdict} | ${(row.notes ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
      );
    }
    if (result.outstanding.length) {
      lines.push("");
      lines.push(`_Outstanding (unreviewed): ${result.outstanding.join(", ")}_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Evidence note: every row was written through the manager-gated `record_pricing_validation`");
  lines.push("RPC (no forgeable direct writes) and is mirrored by a `pricing_validation_recorded` audit log._");
  lines.push("");

  const reportsDir = resolve(process.cwd(), "docs", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const outPath = resolve(reportsDir, "butcher-signoff-report.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`Verdict: ${overall} (${totalApproved}/${totalExpected} approved, ${totalChanges} need changes)`);

  if (STRICT && overall !== "APPROVED") {
    console.error("butcher-signoff-report: --strict and verdict is not APPROVED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("butcher-signoff-report crashed:", err);
  process.exit(1);
});
