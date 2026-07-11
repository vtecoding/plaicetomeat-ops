// PTM-DR-001 / PTM-OBS-012 — backup freshness interpretation.
//
// Pure interpreter over the get_backup_freshness() RPC result. Fail-closed: any
// missing/failed signal maps to a non-HEALTHY state so /api/health can never
// report green while production has no recent verified backup.

import type { HealthState } from "@/lib/domain/health";

export type BackupFreshnessInput = {
  hasSuccess: boolean;
  isFresh: boolean;
  ageSeconds: number | null;
  lastSuccessAt: string | null;
};

export type BackupFreshness = {
  state: HealthState;
  detail: string;
  lastSuccessAt: string | null;
  ageSeconds: number | null;
};

/** Interpret the RPC row. `available=false` means the signal itself is missing. */
export function interpretBackupFreshness(
  input: BackupFreshnessInput | null,
  { available }: { available: boolean } = { available: true },
): BackupFreshness {
  if (!available || input === null) {
    return {
      state: "DEGRADED",
      detail: "backup freshness signal unavailable",
      lastSuccessAt: null,
      ageSeconds: null,
    };
  }

  if (!input.hasSuccess) {
    return {
      state: "DEGRADED",
      detail: "no successful production backup recorded",
      lastSuccessAt: null,
      ageSeconds: null,
    };
  }

  if (!input.isFresh) {
    const hrs = input.ageSeconds != null ? Math.floor(input.ageSeconds / 3600) : null;
    return {
      state: "DEGRADED",
      detail: hrs != null ? `latest verified backup is ${hrs}h old (stale)` : "latest verified backup is stale",
      lastSuccessAt: input.lastSuccessAt,
      ageSeconds: input.ageSeconds,
    };
  }

  const hrs = input.ageSeconds != null ? Math.floor(input.ageSeconds / 3600) : null;
  return {
    state: "HEALTHY",
    detail: hrs != null ? `verified backup ${hrs}h old` : "verified backup is fresh",
    lastSuccessAt: input.lastSuccessAt,
    ageSeconds: input.ageSeconds,
  };
}
