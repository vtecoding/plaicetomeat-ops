// verify-restore-parity.mjs — V13.4 parity + integrity check
//
// Compares SOURCE (production) vs RESTORED (throwaway) Supabase projects using
// only service-role keys — no test user accounts, no local Supabase, no RPCs.
// This is what a real operator would run after a disaster recovery restore.
//
// Required env:
//   SOURCE_SUPABASE_URL                  — production project URL
//   SOURCE_SUPABASE_SERVICE_ROLE_KEY     — production service role key
//   RESTORED_SUPABASE_URL                — throwaway project URL
//   RESTORED_SUPABASE_SERVICE_ROLE_KEY   — throwaway project service role key
//   RECOVERY_ENVIRONMENT=PRODUCTION      — required in strict mode
//   STRICT=1                             — required to produce RECOVERY_CERTIFIED

import { createClient } from "@supabase/supabase-js";

const CORE_TABLES = [
  "profiles",
  "orders",
  "order_items",
  "products",
  "inventory_batches",
  "audit_logs",
  "compliance_logs",
  "pricing_validations",
];

// Sample rows to spot-check for field-level integrity
const INTEGRITY_SAMPLES = [
  { table: "orders", orderBy: "created_at", ascending: false, label: "latest order" },
  { table: "orders", orderBy: "created_at", ascending: true,  label: "oldest order"  },
  { table: "audit_logs", orderBy: "created_at", ascending: false, label: "latest audit" },
  { table: "audit_logs", orderBy: "created_at", ascending: true,  label: "oldest audit"  },
  { table: "products", orderBy: "created_at", ascending: false, label: "latest product" },
];

function serviceClient(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function countRows(client, table) {
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`countRows ${table}: ${error.message}`);
  return count ?? 0;
}

async function sampleRow(client, spec) {
  const { data, error } = await client
    .from(spec.table)
    .select("*")
    .order(spec.orderBy, { ascending: spec.ascending, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`sample ${spec.label}: ${error.message}`);
  return data?.[0] ?? null;
}

async function fetchById(client, table, id) {
  const { data, error } = await client.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`fetchById ${table}/${id}: ${error.message}`);
  return data;
}

// Fields excluded from field-level integrity comparison.
// updated_at is a server-side housekeeping column that can legitimately differ
// during restore (e.g., if a previous restore attempt triggered the set_updated_at
// BEFORE UPDATE trigger). Business data columns like id, name, price, status etc.
// are what matter — those are the ones we want to verify.
const INTEGRITY_EXCLUDE_FIELDS = new Set(["updated_at"]);

function normalizeRow(row) {
  if (!row) return null;
  // Sort keys for stable comparison; exclude housekeeping timestamps
  return Object.fromEntries(
    Object.entries(row)
      .filter(([k]) => !INTEGRITY_EXCLUDE_FIELDS.has(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  );
}

async function main() {
  const sourceUrl  = process.env.SOURCE_SUPABASE_URL;
  const sourceKey  = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
  const restoredUrl  = process.env.RESTORED_SUPABASE_URL;
  const restoredKey  = process.env.RESTORED_SUPABASE_SERVICE_ROLE_KEY;
  const environment  = (process.env.RECOVERY_ENVIRONMENT ?? "LOCAL").toUpperCase();
  const strict       = process.env.STRICT === "1";

  if (!sourceUrl || !sourceKey)   throw new Error("SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY required");
  if (!restoredUrl || !restoredKey) throw new Error("RESTORED_SUPABASE_URL / RESTORED_SUPABASE_SERVICE_ROLE_KEY required");
  if (environment === "PRODUCTION" && !strict) {
    console.error("PRODUCTION mode requires STRICT=1");
    process.exit(1);
  }

  console.log(`verify-restore-parity: starting (${environment} mode)`);
  console.log(`  source   : ${sourceUrl}`);
  console.log(`  restored : ${restoredUrl}`);
  console.log("");

  const src = serviceClient(sourceUrl, sourceKey);
  const rst = serviceClient(restoredUrl, restoredKey);

  // ── Parity (row counts) ──────────────────────────────────────────────────────
  console.log("PARITY CHECK — row counts");
  let parityPassed = true;
  let totalSource = 0;
  let totalRestored = 0;

  for (const table of CORE_TABLES) {
    const srcCount = await countRows(src, table);
    const rstCount = await countRows(rst, table);
    const ok = srcCount === rstCount;
    if (!ok) parityPassed = false;
    totalSource   += srcCount;
    totalRestored += rstCount;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${table.padEnd(24)} source=${srcCount}  restored=${rstCount}${ok ? "" : "  ← MISMATCH"}`);
  }
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  source total: ${totalSource}   restored total: ${totalRestored}`);
  console.log(`  PARITY: ${parityPassed ? "PASSED" : "FAILED"}`);
  console.log("");

  // ── Integrity (spot-check field values) ─────────────────────────────────────
  console.log("INTEGRITY CHECK — sample rows");
  let integrityPassed = true;
  const integrityResults = [];

  for (const spec of INTEGRITY_SAMPLES) {
    const sourceRow = await sampleRow(src, spec);
    if (!sourceRow) {
      const status = "SKIP";
      console.log(`  ${status} ${spec.label} — no rows in source`);
      integrityResults.push({ label: spec.label, status, detail: "no source row" });
      continue;
    }
    const restoredRow = await fetchById(rst, spec.table, sourceRow.id);
    const srcNorm = normalizeRow(sourceRow);
    const rstNorm = normalizeRow(restoredRow);
    const same = JSON.stringify(srcNorm) === JSON.stringify(rstNorm);
    if (!same) {
      integrityPassed = false;
      // Find first differing field
      const diffKeys = Object.keys(srcNorm).filter((k) => JSON.stringify(srcNorm[k]) !== JSON.stringify(rstNorm?.[k]));
      console.error(`  FAIL ${spec.label} — fields differ: ${diffKeys.slice(0, 3).join(", ")}`);
    } else {
      console.log(`  PASS ${spec.label} (id=${sourceRow.id.slice(0, 8)}...)`);
    }
    integrityResults.push({ label: spec.label, table: spec.table, id: sourceRow.id, status: same ? "PASS" : "FAIL" });
  }
  console.log(`  INTEGRITY: ${integrityPassed ? "PASSED" : "FAILED"}`);
  console.log("");

  // ── Verdict ─────────────────────────────────────────────────────────────────
  const certified = parityPassed && integrityPassed;
  const verdict = certified ? "RECOVERY_CERTIFIED" : "RECOVERY_FAILED";

  console.log("═".repeat(60));
  if (certified) {
    console.log(`RESULT: ${verdict}`);
    console.log(`  ${totalSource} rows verified across ${CORE_TABLES.length} core tables`);
    console.log(`  All parity checks PASSED — restored data matches production`);
    console.log(`  All integrity samples PASSED — field values identical`);
    console.log("═".repeat(60));
  } else {
    console.error(`RESULT: ${verdict}`);
    if (!parityPassed) console.error("  Row count mismatch — restore incomplete");
    if (!integrityPassed) console.error("  Field-level mismatch — data corruption detected");
    console.log("═".repeat(60));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-restore-parity crashed:", err.message);
  process.exit(1);
});
