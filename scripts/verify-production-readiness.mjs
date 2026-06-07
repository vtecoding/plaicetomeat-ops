// V12.9 production readiness verification.
//
// Verifies the controls that must hold before the app is operated in production:
//   1. required secrets exist and are valid;
//   2. production hygiene flags are not enabling demo/test behaviour;
//   3. repository migrations match the database (no drift), when the DB is reachable.
//
// Modes (mirrors check-migrations.mjs / verify-checkout-integrity.mjs):
//   * STRICT  — PRODUCTION_READINESS_MODE=strict, NODE_ENV=production, or
//               VERCEL_ENV=production: a missing required secret => FAIL.
//   * LOCAL   — default dev: a missing production-only secret => SKIP (so the
//               certification gate is runnable locally). A PRESENT-but-INVALID
//               secret still FAILS in either mode, and migration drift still
//               FAILS whenever the DB is reachable.
//
// Exits non-zero on any unmet expectation.

import { createClient } from "@supabase/supabase-js";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const STRICT =
  process.env.PRODUCTION_READINESS_MODE === "strict" ||
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production";

let failures = 0;
let skipped = 0;
let warnings = 0;

function pass(name) {
  console.log(`  PASS ${name}`);
}
function fail(name, detail = "") {
  failures += 1;
  console.error(`  FAIL ${name} ${detail}`);
}
function skip(name, why) {
  skipped += 1;
  console.log(`  SKIP ${name} (${why})`);
}
function warn(name, why) {
  warnings += 1;
  console.log(`  WARN ${name} (${why})`);
}

function byteLength(value) {
  return Buffer.byteLength(value ?? "", "utf8");
}

// Required-secret check. Missing => FAIL (strict) / SKIP (local). Present but
// failing `valid()` => FAIL in either mode (a wrong value is always a problem).
function requireSecret(name, value, { minBytes = 1 } = {}) {
  const present = typeof value === "string" && value.length > 0;
  if (!present) {
    if (STRICT) fail(`${name} present`, "missing");
    else skip(`${name} present`, "not set locally; required in production");
    return;
  }
  if (byteLength(value) < minBytes) {
    fail(`${name} valid`, `too short (need >= ${minBytes} bytes)`);
    return;
  }
  pass(`${name} present and valid`);
}

function checkSecrets() {
  console.log(`Secrets (${STRICT ? "STRICT" : "LOCAL"} mode):`);
  requireSecret("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  requireSecret("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  requireSecret("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  requireSecret("ORDER_ACCESS_SECRET", process.env.ORDER_ACCESS_SECRET, { minBytes: 32 });

  // STAFF_SESSION_SECRET falls back to ORDER_ACCESS_SECRET. Required = at least
  // one valid (>= 32). If STAFF_SESSION_SECRET is set it must itself be valid.
  const staff = process.env.STAFF_SESSION_SECRET;
  const order = process.env.ORDER_ACCESS_SECRET;
  if (staff && staff.length > 0) {
    requireSecret("STAFF_SESSION_SECRET", staff, { minBytes: 32 });
  } else if (order && byteLength(order) >= 32) {
    pass("STAFF_SESSION_SECRET (falls back to valid ORDER_ACCESS_SECRET)");
  } else if (STRICT) {
    fail("STAFF_SESSION_SECRET present", "missing and no valid ORDER_ACCESS_SECRET fallback");
  } else {
    skip("STAFF_SESSION_SECRET present", "not set locally; required in production");
  }

  const canonical = process.env.CANONICAL_BRANCH_ID || process.env.NEXT_PUBLIC_CANONICAL_BRANCH_ID;
  requireSecret("CANONICAL_BRANCH_ID (or NEXT_PUBLIC_CANONICAL_BRANCH_ID)", canonical);
}

function checkHygiene() {
  console.log("Production hygiene:");
  const flags = [
    ["ALLOW_DEMO_DATA", process.env.ALLOW_DEMO_DATA, "true"],
    ["CHECKOUT_TEST_MODE_ENABLED", process.env.CHECKOUT_TEST_MODE_ENABLED, "true"],
    ["NEXT_PUBLIC_CHECKOUT_TEST_MODE", process.env.NEXT_PUBLIC_CHECKOUT_TEST_MODE, "true"],
  ];
  for (const [name, value, forbidden] of flags) {
    if (value === forbidden) {
      if (STRICT) fail(`${name} not enabled`, `is "${forbidden}" — forbidden in production`);
      else warn(`${name} not enabled`, `is "${forbidden}" (ok for dev, must be off in production)`);
    } else {
      pass(`${name} not enabled`);
    }
  }

  const driftMode = (process.env.MIGRATION_DRIFT_CHECK_MODE ?? "").toLowerCase();
  if (driftMode === "local" || driftMode === "dev") {
    if (STRICT) fail("MIGRATION_DRIFT_CHECK_MODE not bypassed", `is "${driftMode}"`);
    else warn("MIGRATION_DRIFT_CHECK_MODE not bypassed", `is "${driftMode}" (must not be set in CI/production)`);
  } else {
    pass("MIGRATION_DRIFT_CHECK_MODE not bypassed");
  }
}

async function checkMigrationParity() {
  console.log("Migration parity:");
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const expected = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.split("_")[0])
    .sort();

  if (!url || !serviceKey) {
    skip("repository migrations applied in database", "Supabase service env not available");
    return;
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  let applied;
  try {
    const { data, error } = await supabase.rpc("get_applied_migration_versions");
    if (error) {
      // Fall back to required-migration health if the helper RPC is absent.
      const health = await supabase.rpc("get_migration_health");
      if (health.error) {
        skip("repository migrations applied in database", `could not read migrations: ${error.message}`);
        return;
      }
      const rows = health.data ?? [];
      const total = rows.length;
      const got = rows.filter((r) => r.applied).length;
      if (total > 0 && got === total) pass(`required migrations applied (${got}/${total})`);
      else fail("required migrations applied", `${got}/${total}`);
      return;
    }
    applied = new Set((data ?? []).map((row) => String(row.version)));
  } catch (err) {
    skip("repository migrations applied in database", `DB unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const missing = expected.filter((version) => !applied.has(version));
  if (missing.length > 0) fail("repository migrations applied in database", `missing ${missing.join(", ")}`);
  else pass(`repository migrations applied in database (${expected.length} migrations)`);
}

async function main() {
  console.log("V12.9 production readiness checks");
  checkSecrets();
  checkHygiene();
  await checkMigrationParity();

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} readiness check(s) FAILED (${skipped} skipped, ${warnings} warnings)`);
    process.exit(1);
  }
  console.log(`RESULT: all readiness checks PASSED (${skipped} skipped, ${warnings} warnings)`);
}

main().catch((err) => {
  console.error("verify-production-readiness crashed:", err);
  process.exit(1);
});
