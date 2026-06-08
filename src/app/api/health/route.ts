import { NextResponse } from "next/server";

import { type HealthCheck, isServing, worstState } from "@/lib/domain/health";
import { log } from "@/lib/server/observability/log";
import { getMetricsSnapshot } from "@/lib/server/observability/metrics";
import { configuredCanonicalBranchId, isProductionRuntime } from "@/lib/server/runtime-truth";
import { createSupabasePublicClient, hasSupabasePublicEnv, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// V12.8 — runtime health. No secrets are exposed: the response carries states and
// generic, non-secret detail only; full DB error detail is sent to the log, not
// the body. Uses the anon (public) client and the DB-side get_migration_health()
// (granted to anon) so it needs no service-role capability and no filesystem.
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: HealthCheck[] = [];

  // App: this process is serving the request.
  checks.push({ name: "app", state: "HEALTHY" });

  // Configuration: required secrets present, and a canonical branch in production.
  const missing: string[] = [];
  if (!hasSupabasePublicEnv()) missing.push("NEXT_PUBLIC_SUPABASE_URL/ANON_KEY");
  if (!hasSupabaseServiceEnv()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (isProductionRuntime() && !configuredCanonicalBranchId()) missing.push("CANONICAL_BRANCH_ID");
  checks.push({
    name: "configuration",
    state: missing.length ? "CONFIGURATION_REQUIRED" : "HEALTHY",
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
  });

  // Database connectivity + migration parity.
  const { database, migrations } = await checkDatabase();
  checks.push(database, migrations);

  const state = worstState(checks.map((check) => check.state));
  const serving = isServing(state);

  if (!serving) {
    log("SYSTEM", "error", "health check not serving", {
      state,
      checks: checks.map((check) => ({ name: check.name, state: check.state })),
    });
  }

  return NextResponse.json(
    {
      state,
      checks,
      metrics: getMetricsSnapshot(),
      asOf: new Date().toISOString(),
    },
    { status: serving ? 200 : 503 },
  );
}

async function checkDatabase(): Promise<{ database: HealthCheck; migrations: HealthCheck }> {
  if (!hasSupabasePublicEnv()) {
    return {
      database: { name: "database", state: "CONFIGURATION_REQUIRED", detail: "Supabase env not configured" },
      migrations: { name: "migration_parity", state: "CONFIGURATION_REQUIRED", detail: "Supabase env not configured" },
    };
  }

  try {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.rpc("get_migration_health");

    if (error) {
      // Keep the public body generic; send the real reason to the log only.
      log("SYSTEM", "error", "health database probe failed", { error: error.message });
      return {
        database: { name: "database", state: "UNAVAILABLE", detail: "database query failed" },
        migrations: { name: "migration_parity", state: "UNAVAILABLE", detail: "could not read migration health" },
      };
    }

    const rows = (data ?? []) as Array<{ applied: boolean }>;
    const total = rows.length;
    const applied = rows.filter((row) => row.applied).length;
    const allApplied = total > 0 && applied === total;

    return {
      database: { name: "database", state: "HEALTHY" },
      migrations: {
        name: "migration_parity",
        state: allApplied ? "HEALTHY" : "DEGRADED",
        detail: `${applied}/${total} required migrations applied`,
      },
    };
  } catch (error) {
    log("SYSTEM", "error", "health database probe crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      database: { name: "database", state: "UNAVAILABLE", detail: "database unreachable" },
      migrations: { name: "migration_parity", state: "UNAVAILABLE", detail: "database unreachable" },
    };
  }
}
