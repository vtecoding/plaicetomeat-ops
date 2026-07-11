import { NextResponse } from "next/server";

import { interpretBackupFreshness } from "@/lib/domain/backup-freshness";
import { resolveBuildIdentity } from "@/lib/domain/build-identity";
import { type HealthCheck, isServing, worstState } from "@/lib/domain/health";
import { computeMigrationParity } from "@/lib/domain/migration-parity";
import { log } from "@/lib/server/observability/log";
import { getMetricsSnapshot } from "@/lib/server/observability/metrics";
import {
  REQUIRED_MIGRATION_HEAD,
  REQUIRED_MIGRATION_VERSIONS,
  MIGRATION_MANIFEST_CHECKSUM,
} from "@/lib/server/migration-manifest.generated";
import { configuredCanonicalBranchId, isProductionRuntime } from "@/lib/server/runtime-truth";
import { createSupabasePublicClient, hasSupabasePublicEnv, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// V12.8 + Phase-1 remediation — runtime health. No secrets are exposed: the
// response carries states and generic, non-secret detail only; full DB error
// detail goes to the log, not the body.
//
// PTM-OBS-012: migration parity is computed against the COMPLETE required set
//   (migration-manifest.generated.ts), not a hand-curated table, using the
//   anon-granted get_applied_migration_versions() ledger reader.
// PTM-REL-009: exposes the immutable build commit SHA and refuses HEALTHY when
//   the deployed commit is unknown.
// PTM-DR-001: exposes backup freshness and degrades when the latest verified
//   production backup is missing or stale.
export const dynamic = "force-dynamic";

const BACKUP_MAX_AGE_HOURS = 48;

export async function GET() {
  const checks: HealthCheck[] = [];

  // App: this process is serving the request.
  checks.push({ name: "app", state: "HEALTHY" });

  // Build identity — must be known and reconcilable to a commit. The literal
  // process.env.X reads let Next.js inline the build-time PTM_BUILD_SHA (see
  // next.config.ts); VERCEL_GIT_COMMIT_SHA resolves at runtime on Vercel.
  const build = resolveBuildIdentity({
    PTM_BUILD_SHA: process.env.PTM_BUILD_SHA,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  checks.push({
    name: "build_identity",
    state: build.known ? "HEALTHY" : "DEGRADED",
    detail: build.known ? `commit ${build.shortSha}` : "deployed commit SHA unknown",
  });

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

  // Database connectivity + deterministic migration parity + backup freshness.
  const db = await checkDatabase();
  checks.push(db.database, db.migrations, db.backup);

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
      build: {
        commit: build.shortSha,
        known: build.known,
      },
      migration: {
        requiredHead: REQUIRED_MIGRATION_HEAD,
        observedHead: db.parity?.observedHead ?? null,
        requiredCount: REQUIRED_MIGRATION_VERSIONS.length,
        appliedRequiredCount: db.parity?.appliedRequiredCount ?? null,
        parity: db.parity?.parity ?? false,
        manifestChecksum: MIGRATION_MANIFEST_CHECKSUM.slice(0, 12),
      },
      backup: {
        lastSuccessAt: db.backupInfo?.lastSuccessAt ?? null,
        ageSeconds: db.backupInfo?.ageSeconds ?? null,
        maxAgeHours: BACKUP_MAX_AGE_HOURS,
        state: db.backup.state,
      },
      metrics: getMetricsSnapshot(),
      asOf: new Date().toISOString(),
    },
    { status: serving ? 200 : 503 },
  );
}

type DbResult = {
  database: HealthCheck;
  migrations: HealthCheck;
  backup: HealthCheck;
  parity: ReturnType<typeof computeMigrationParity> | null;
  backupInfo: { lastSuccessAt: string | null; ageSeconds: number | null } | null;
};

async function checkDatabase(): Promise<DbResult> {
  const unavailableParity = null;
  if (!hasSupabasePublicEnv()) {
    return {
      database: { name: "database", state: "CONFIGURATION_REQUIRED", detail: "Supabase env not configured" },
      migrations: { name: "migration_parity", state: "CONFIGURATION_REQUIRED", detail: "Supabase env not configured" },
      backup: { name: "backup_freshness", state: "CONFIGURATION_REQUIRED", detail: "Supabase env not configured" },
      parity: unavailableParity,
      backupInfo: null,
    };
  }

  const supabase = createSupabasePublicClient();

  // ── Migration parity (deterministic, full required set) ──────────────────
  let migrations: HealthCheck;
  let parity: ReturnType<typeof computeMigrationParity> | null = null;
  let database: HealthCheck;
  try {
    const { data, error } = await supabase.rpc("get_applied_migration_versions");
    if (error) {
      log("SYSTEM", "error", "health migration probe failed", { error: error.message });
      database = { name: "database", state: "UNAVAILABLE", detail: "database query failed" };
      migrations = { name: "migration_parity", state: "UNAVAILABLE", detail: "could not read applied migrations" };
    } else {
      database = { name: "database", state: "HEALTHY" };
      const applied = ((data ?? []) as Array<{ version: string }>).map((r) => String(r.version));
      parity = computeMigrationParity(REQUIRED_MIGRATION_VERSIONS, applied);
      migrations = {
        name: "migration_parity",
        state: parity.parity ? "HEALTHY" : "DEGRADED",
        detail: parity.parity
          ? `${parity.appliedRequiredCount}/${parity.requiredCount} required migrations applied (head ${parity.requiredHead})`
          : `behind: ${parity.appliedRequiredCount}/${parity.requiredCount} applied; missing ${parity.missing.length} (observed head ${parity.observedHead ?? "none"})`,
      };
    }
  } catch (error) {
    log("SYSTEM", "error", "health migration probe crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    database = { name: "database", state: "UNAVAILABLE", detail: "database unreachable" };
    migrations = { name: "migration_parity", state: "UNAVAILABLE", detail: "database unreachable" };
    return { database, migrations, backup: { name: "backup_freshness", state: "UNAVAILABLE", detail: "database unreachable" }, parity, backupInfo: null };
  }

  // ── Backup freshness ─────────────────────────────────────────────────────
  let backup: HealthCheck;
  let backupInfo: DbResult["backupInfo"] = null;
  try {
    const { data, error } = await supabase.rpc("get_backup_freshness", { p_max_age_hours: BACKUP_MAX_AGE_HOURS });
    if (error) {
      // Signal missing (e.g. RPC not yet deployed) → fail closed to DEGRADED.
      log("SYSTEM", "warn", "health backup freshness probe failed", { error: error.message });
      const f = interpretBackupFreshness(null, { available: false });
      backup = { name: "backup_freshness", state: f.state, detail: f.detail };
    } else {
      const row = (Array.isArray(data) ? data[0] : data) as
        | { last_success_at: string | null; age_seconds: number | null; is_fresh: boolean; has_success: boolean }
        | undefined;
      const f = interpretBackupFreshness(
        row
          ? {
              hasSuccess: !!row.has_success,
              isFresh: !!row.is_fresh,
              ageSeconds: row.age_seconds != null ? Number(row.age_seconds) : null,
              lastSuccessAt: row.last_success_at,
            }
          : null,
        { available: !!row },
      );
      backup = { name: "backup_freshness", state: f.state, detail: f.detail };
      backupInfo = { lastSuccessAt: f.lastSuccessAt, ageSeconds: f.ageSeconds };
    }
  } catch (error) {
    log("SYSTEM", "warn", "health backup freshness probe crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const f = interpretBackupFreshness(null, { available: false });
    backup = { name: "backup_freshness", state: f.state, detail: f.detail };
  }

  return { database, migrations, backup, parity, backupInfo };
}
