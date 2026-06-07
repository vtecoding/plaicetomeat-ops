import "server-only";

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { buildMigrationHealth } from "@/lib/domain/operations-intelligence";
import { allowDemoFallback } from "@/lib/server/runtime-truth";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type ReleaseGateResults = Record<string, "PASS" | "FAIL" | "PENDING">;

export type ReleaseLedgerEntry = {
  id: string;
  version: string;
  commitSha: string;
  deployedAt: string;
  migrationApplied: string | null;
  deployer: string | null;
  releaseNotes: string | null;
  gateResults: ReleaseGateResults;
  verification: {
    id: string;
    status: "pending" | "passed" | "failed";
    verifierName: string | null;
    verifiedAt: string | null;
    items: Array<{
      id: string;
      label: string;
      status: "pending" | "passed" | "failed";
      notes: string | null;
    }>;
  } | null;
  certification: {
    hostedSmokeResult: string;
    releaseReportResult: string;
    verifiedBy: string | null;
    verifiedAt: string | null;
  } | null;
};

type ReleaseRow = {
  id: string;
  version: string;
  commit_sha: string;
  deployed_at: string;
  migration_applied: string | null;
  deployer: string | null;
  release_notes: string | null;
  gate_results: ReleaseGateResults | null;
  release_verifications?: VerificationRow[] | VerificationRow | null;
  release_certifications?: CertificationRow[] | CertificationRow | null;
};

type VerificationRow = {
  id: string;
  status: "pending" | "passed" | "failed";
  verifier_name: string | null;
  verified_at: string | null;
  release_verification_items?: VerificationItemRow[] | VerificationItemRow | null;
};

type VerificationItemRow = {
  id: string;
  label: string;
  status: "pending" | "passed" | "failed";
  notes: string | null;
  sort_order: number | null;
};

type CertificationRow = {
  hosted_smoke_result: string;
  release_report_result: string;
  verified_by: string | null;
  verified_at: string | null;
};

type MigrationHealthRow = {
  expected_version: string;
  migration_name: string;
  applied: boolean;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function getReleaseGovernance() {
  const expected = getExpectedMigrationVersions();

  if (!hasSupabaseServiceEnv()) {
    return {
      releases: allowDemoFallback() ? [fallbackV3Release()] : [],
      migrationHealth: buildMigrationHealth({ expected, applied: [] }),
      configured: false,
    };
  }

  const supabase = createSupabaseServiceClient();
  const [{ data: releaseRows }, { data: migrationRows, error: migrationError }] = await Promise.all([
    supabase
      .from("release_deployments")
      .select(
        `
        id, version, commit_sha, deployed_at, migration_applied, deployer, release_notes, gate_results,
        release_verifications(
          id, status, verifier_name, verified_at,
          release_verification_items(id, label, status, notes, sort_order)
        ),
        release_certifications(hosted_smoke_result, release_report_result, verified_by, verified_at)
      `,
      )
      .order("deployed_at", { ascending: false })
      .limit(20),
    supabase.rpc("get_migration_health"),
  ]);

  const migrationHealth =
    migrationError || !migrationRows
      ? buildMigrationHealth({ expected, applied: [] })
      : buildMigrationHealth({
          expected: (migrationRows as MigrationHealthRow[]).map((row) => row.expected_version),
          applied: (migrationRows as MigrationHealthRow[]).filter((row) => row.applied).map((row) => row.expected_version),
        });

  const releases = ((releaseRows ?? []) as ReleaseRow[]).map(mapReleaseRow);

  return {
    releases: releases.length > 0 ? releases : allowDemoFallback() ? [fallbackV3Release()] : [],
    migrationHealth,
    configured: true,
  };
}

export function getExpectedMigrationVersions() {
  try {
    return readdirSync(join(process.cwd(), "supabase", "migrations"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.split("_")[0])
      .sort();
  } catch {
    return [
      "202605290001",
      "202605300001",
      "202605300002",
      "202605300003",
      "202605300004",
      "202605310001",
      "202605310002",
      "202605310003",
      "202606011430",
      "202606011900",
    ];
  }
}

function mapReleaseRow(row: ReleaseRow): ReleaseLedgerEntry {
  const verification = first(row.release_verifications);
  const certification = first(row.release_certifications);
  const items = verification
    ? (Array.isArray(verification.release_verification_items)
        ? verification.release_verification_items
        : verification.release_verification_items
          ? [verification.release_verification_items]
          : []
      )
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((item) => ({
          id: item.id,
          label: item.label,
          status: item.status,
          notes: item.notes,
        }))
    : [];

  return {
    id: row.id,
    version: row.version,
    commitSha: row.commit_sha,
    deployedAt: row.deployed_at,
    migrationApplied: row.migration_applied,
    deployer: row.deployer,
    releaseNotes: row.release_notes,
    gateResults: row.gate_results ?? {},
    verification: verification
      ? {
          id: verification.id,
          status: verification.status,
          verifierName: verification.verifier_name,
          verifiedAt: verification.verified_at,
          items,
        }
      : null,
    certification: certification
      ? {
          hostedSmokeResult: certification.hosted_smoke_result,
          releaseReportResult: certification.release_report_result,
          verifiedBy: certification.verified_by,
          verifiedAt: certification.verified_at,
        }
      : null,
  };
}

function fallbackV3Release(): ReleaseLedgerEntry {
  return {
    id: "fallback-v3",
    version: "V3",
    commitSha: "a8f32d1",
    deployedAt: "2026-06-01T18:44:00.000Z",
    migrationApplied: "202606011430_v3_operational_system.sql",
    deployer: "Production release",
    releaseNotes: "V3 operational foundations: audit, compliance inventory, waste recording, settings governance.",
    gateResults: {
      Typecheck: "PASS",
      Lint: "PASS",
      Unit: "PASS",
      Build: "PASS",
      "Hosted Smoke": "PASS",
    },
    verification: null,
    certification: null,
  };
}
