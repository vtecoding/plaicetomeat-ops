import { NextResponse } from "next/server";

import { interpretBackupFreshness } from "@/lib/domain/backup-freshness";
import { resolveBuildIdentity } from "@/lib/domain/build-identity";
import { type HealthCheck, isServing, worstState } from "@/lib/domain/health";
import { computeMigrationParity } from "@/lib/domain/migration-parity";
import {
  APP_GENERATION,
  LEGACY_MIGRATION_HEAD,
  evaluateSchemaCompatibility,
  inferCertifiedLegacyContract,
  parseSchemaContractRow,
  type ApplicationSchemaContract,
} from "@/lib/domain/schema-compatibility";
import {
  MIGRATION_MANIFEST_CHECKSUM,
  REQUIRED_MIGRATION_HEAD,
  REQUIRED_MIGRATION_VERSIONS,
} from "@/lib/server/migration-manifest.generated";
import { log } from "@/lib/server/observability/log";
import { getMetricsSnapshot } from "@/lib/server/observability/metrics";
import { configuredCanonicalBranchId, isProductionRuntime } from "@/lib/server/runtime-truth";
import { createSupabasePublicClient, hasSupabasePublicEnv, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// Runtime health exposes evidence; it is not authority to route production
// traffic. Promotion is separately bound to the exact staged deployment.
export const dynamic = "force-dynamic";

const BACKUP_MAX_AGE_HOURS = 48;

export async function GET() {
  const checks: HealthCheck[] = [{ name: "app", state: "HEALTHY" }];
  const build = resolveBuildIdentity({
    PTM_BUILD_SHA: process.env.PTM_BUILD_SHA,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  checks.push({
    name: "build_identity",
    state: build.known ? "HEALTHY" : "DEGRADED",
    detail: build.known ? `commit ${build.shortSha}` : "deployed commit SHA unknown",
  });

  const missing: string[] = [];
  if (!hasSupabasePublicEnv()) missing.push("NEXT_PUBLIC_SUPABASE_URL/ANON_KEY");
  if (!hasSupabaseServiceEnv()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (isProductionRuntime() && !configuredCanonicalBranchId()) missing.push("CANONICAL_BRANCH_ID");
  checks.push({
    name: "configuration",
    state: missing.length ? "CONFIGURATION_REQUIRED" : "HEALTHY",
    detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
  });

  const db = await checkDatabase();
  checks.push(db.database, db.compatibility, db.migrations, db.backup);
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
      build: { commit: build.shortSha, known: build.known },
      compatibility: {
        applicationGeneration: APP_GENERATION,
        compatible: db.schemaCompatibility?.compatible ?? false,
        source: db.contract?.source ?? null,
        dbGeneration: db.contract?.dbGeneration ?? null,
        minSupportedAppGeneration: db.contract?.minSupportedAppGeneration ?? null,
        maxSupportedAppGeneration: db.contract?.maxSupportedAppGeneration ?? null,
        migrationHead: db.contract?.migrationHead ?? null,
      },
      migration: {
        requiredHead: REQUIRED_MIGRATION_HEAD,
        observedHead: db.parity?.observedHead ?? null,
        requiredCount: REQUIRED_MIGRATION_VERSIONS.length,
        appliedCount: db.parity?.appliedCount ?? null,
        appliedRequiredCount: db.parity?.appliedRequiredCount ?? null,
        unexpectedCount: db.parity?.unexpected.length ?? null,
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
  compatibility: HealthCheck;
  migrations: HealthCheck;
  backup: HealthCheck;
  parity: ReturnType<typeof computeMigrationParity> | null;
  contract: ApplicationSchemaContract | null;
  schemaCompatibility: ReturnType<typeof evaluateSchemaCompatibility> | null;
  backupInfo: { lastSuccessAt: string | null; ageSeconds: number | null } | null;
};

async function checkDatabase(): Promise<DbResult> {
  if (!hasSupabasePublicEnv()) {
    const detail = "Supabase env not configured";
    return {
      database: { name: "database", state: "CONFIGURATION_REQUIRED", detail },
      compatibility: { name: "schema_compatibility", state: "CONFIGURATION_REQUIRED", detail },
      migrations: { name: "migration_parity", state: "CONFIGURATION_REQUIRED", detail },
      backup: { name: "backup_freshness", state: "CONFIGURATION_REQUIRED", detail },
      parity: null,
      contract: null,
      schemaCompatibility: null,
      backupInfo: null,
    };
  }

  const supabase = createSupabasePublicClient();
  let database: HealthCheck;
  let compatibility: HealthCheck;
  let migrations: HealthCheck;
  let parity: ReturnType<typeof computeMigrationParity> | null = null;
  let contract: ApplicationSchemaContract | null = null;
  let schemaCompatibility: ReturnType<typeof evaluateSchemaCompatibility> | null = null;

  try {
    let versionResult = await supabase.rpc("get_application_schema_versions_v1");
    if (versionResult.error && isMissingRpc(versionResult.error.message)) {
      versionResult = await supabase.rpc("get_applied_migration_versions");
    }

    if (versionResult.error) {
      log("SYSTEM", "error", "health migration probe failed", { error: versionResult.error.message });
      database = { name: "database", state: "UNAVAILABLE", detail: "database query failed" };
      compatibility = { name: "schema_compatibility", state: "UNAVAILABLE", detail: "could not establish schema contract" };
      migrations = { name: "migration_parity", state: "UNAVAILABLE", detail: "could not read applied migrations" };
    } else {
      database = { name: "database", state: "HEALTHY" };
      const applied = ((versionResult.data ?? []) as Array<{ version: string }>).map((row) => String(row.version));
      parity = computeMigrationParity(REQUIRED_MIGRATION_VERSIONS, applied);

      const contractResult = await supabase.rpc("get_application_schema_contract_v1");
      if (!contractResult.error) {
        const row = (contractResult.data as Array<Record<string, unknown>> | null)?.[0];
        contract = row ? parseSchemaContractRow(row) : null;
      } else if (isMissingRpc(contractResult.error.message)) {
        const legacyVersions = REQUIRED_MIGRATION_VERSIONS.filter((version) => version <= LEGACY_MIGRATION_HEAD);
        contract = inferCertifiedLegacyContract(applied, legacyVersions);
      }

      if (contract) schemaCompatibility = evaluateSchemaCompatibility(APP_GENERATION, contract);
      compatibility = schemaCompatibility?.compatible
        ? {
            name: "schema_compatibility",
            state: "HEALTHY",
            detail: `app generation ${APP_GENERATION} supported by DB ${contract?.minSupportedAppGeneration}-${contract?.maxSupportedAppGeneration}`,
          }
        : {
            name: "schema_compatibility",
            state: "UNAVAILABLE",
            detail: contract
              ? `app generation ${APP_GENERATION} outside DB ${contract.minSupportedAppGeneration}-${contract.maxSupportedAppGeneration}`
              : "database contract absent, malformed or not a certified legacy baseline",
          };

      migrations = {
        name: "migration_parity",
        state: parity.parity ? "HEALTHY" : contract?.source === "certified_legacy_baseline" ? "DEGRADED" : "UNAVAILABLE",
        detail: parity.parity
          ? `all ${parity.requiredCount} required migrations applied; ${parity.unexpected.length} later migration(s)`
          : `migration evidence missing ${parity.missing.length}; observed ${parity.observedHead ?? "none"}`,
      };
    }
  } catch (error) {
    log("SYSTEM", "error", "health migration probe crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    database = { name: "database", state: "UNAVAILABLE", detail: "database unreachable" };
    compatibility = { name: "schema_compatibility", state: "UNAVAILABLE", detail: "database unreachable" };
    migrations = { name: "migration_parity", state: "UNAVAILABLE", detail: "database unreachable" };
    return {
      database,
      compatibility,
      migrations,
      backup: { name: "backup_freshness", state: "UNAVAILABLE", detail: "database unreachable" },
      parity,
      contract,
      schemaCompatibility,
      backupInfo: null,
    };
  }

  let backup: HealthCheck;
  let backupInfo: DbResult["backupInfo"] = null;
  try {
    const { data, error } = await supabase.rpc("get_backup_freshness", { p_max_age_hours: BACKUP_MAX_AGE_HOURS });
    if (error) {
      log("SYSTEM", "warn", "health backup freshness probe failed", { error: error.message });
      const freshness = interpretBackupFreshness(null, { available: false });
      backup = { name: "backup_freshness", state: freshness.state, detail: freshness.detail };
    } else {
      const row = (Array.isArray(data) ? data[0] : data) as
        | { last_success_at: string | null; age_seconds: number | null; is_fresh: boolean; has_success: boolean }
        | undefined;
      const freshness = interpretBackupFreshness(
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
      backup = { name: "backup_freshness", state: freshness.state, detail: freshness.detail };
      backupInfo = { lastSuccessAt: freshness.lastSuccessAt, ageSeconds: freshness.ageSeconds };
    }
  } catch (error) {
    log("SYSTEM", "warn", "health backup freshness probe crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const freshness = interpretBackupFreshness(null, { available: false });
    backup = { name: "backup_freshness", state: freshness.state, detail: freshness.detail };
  }

  return { database, compatibility, migrations, backup, parity, contract, schemaCompatibility, backupInfo };
}

function isMissingRpc(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("schema cache") || normalized.includes("could not find the function") || normalized.includes("not find the function");
}
