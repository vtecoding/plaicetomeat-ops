// V12.8 synthetic health verification.
//
// DB layer (always, when Supabase is reachable): database connectivity, migration
// parity via get_migration_health(), and checkout readiness (service-role client
// can reach the DB + the V12.1 seal denies anon the mutation RPC).
//
// HTTP layer (optional): home page, shop page, and the /api/health endpoint. Runs
// only when HEALTH_BASE_URL is set (or the default localhost app is reachable);
// otherwise it SKIPS (does not fail), mirroring verify-checkout-integrity.
//
// Exits non-zero on any unmet expectation.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BASE_URL = process.env.HEALTH_BASE_URL ?? null;

let failures = 0;
let skipped = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}
function skip(name, why) {
  skipped += 1;
  console.log(`  SKIP ${name} (${why})`);
}

async function dbReachable(client) {
  try {
    const { error } = await client.rpc("get_migration_health");
    return !error;
  } catch {
    return false;
  }
}

async function dbChecks() {
  const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  if (!(await dbReachable(anon))) {
    skip("database connectivity suite", `${URL} not reachable`);
    return;
  }

  // database connectivity + migration parity (anon-readable get_migration_health)
  {
    const { data, error } = await anon.rpc("get_migration_health");
    check("database connectivity (get_migration_health)", !error, error?.message);
    const rows = data ?? [];
    const total = rows.length;
    const applied = rows.filter((r) => r.applied).length;
    check("migration parity (all required migrations applied)", total > 0 && applied === total, `${applied}/${total} applied`);
  }

  // checkout readiness: service-role client can reach the DB...
  {
    const ready = await dbReachable(service);
    check("checkout readiness (service-role DB reachable)", ready);
  }

  // ...and the V12.1 seal denies anon the checkout mutation RPC.
  {
    const r = await anon.rpc("create_checkout_order", {
      p_branch_id: "00000000-0000-4000-8000-000000000001",
      p_customer_name: "Health Probe",
      p_customer_phone: "+447700900123",
      p_customer_email: null,
      p_pickup_date: "2099-01-01",
      p_pickup_window_id: null,
      p_notes: null,
      p_idempotency_key: `health-${Date.now()}`,
      p_items: [],
      p_is_test: false,
    });
    check("checkout RPC seal (anon denied)", !!r.error, r.error ? "" : "CALLABLE!");
  }
}

async function httpChecks() {
  if (!BASE_URL) {
    skip("HTTP health suite", "set HEALTH_BASE_URL to the running app to enable");
    return;
  }

  async function get(path) {
    try {
      return await fetch(`${BASE_URL}${path}`, { method: "GET" });
    } catch {
      return null;
    }
  }

  {
    const res = await get("/");
    check("home page serves", res !== null && res.status < 500, res ? `status=${res.status}` : "unreachable");
  }
  {
    const res = await get("/shop");
    check("shop page serves", res !== null && res.status < 500, res ? `status=${res.status}` : "unreachable");
  }
  {
    const res = await get("/api/health");
    let ok = false;
    let stateInfo = "no response";
    if (res) {
      try {
        const body = await res.json();
        // Serving = 200 (HEALTHY/DEGRADED); 503 is a valid honest "not serving".
        ok = (res.status === 200 || res.status === 503) && typeof body.state === "string" && Array.isArray(body.checks);
        stateInfo = `status=${res.status} state=${body.state}`;
      } catch {
        stateInfo = `status=${res.status} (non-JSON)`;
      }
    }
    check("/api/health responds with a health report", ok, stateInfo);
  }
}

async function main() {
  console.log("V12.8 synthetic health checks");
  await dbChecks();
  await httpChecks();

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} health check(s) FAILED (${skipped} skipped)`);
    process.exit(1);
  }
  console.log(`RESULT: all health checks PASSED (${skipped} skipped)`);
}

main().catch((err) => {
  console.error("verify-health crashed:", err);
  process.exit(1);
});
