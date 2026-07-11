// PTM-OBS-012 — deterministic migration parity.
//
// The old health check compared production against a hand-curated 11-row
// `expected_migrations` table, so it reported 11/11 HEALTHY while production was
// three security-critical migrations behind. This computes parity against the
// COMPLETE required migration set (mechanically derived from supabase/migrations
// by scripts/generate-migration-manifest.mjs) versus the versions the production
// ledger actually reports applied.
//
// Pure and unit-testable: no env, no I/O. Version-based (the applied ledger
// exposes versions, not per-file hashes); checksum parity is enforced separately
// at CI/release time where the repo files are available.

export type MigrationParity = {
  requiredHead: string;
  observedHead: string | null;
  requiredCount: number;
  appliedRequiredCount: number;
  missing: string[];
  parity: boolean;
};

export function computeMigrationParity(
  required: readonly string[],
  applied: readonly string[],
): MigrationParity {
  const appliedSet = new Set(applied.map((v) => String(v)));
  const requiredSorted = [...required].map(String).sort();

  const missing = requiredSorted.filter((v) => !appliedSet.has(v));
  const requiredHead = requiredSorted[requiredSorted.length - 1] ?? "";
  const observedHead =
    applied.length > 0 ? [...applied].map(String).sort().slice(-1)[0] : null;

  return {
    requiredHead,
    observedHead,
    requiredCount: requiredSorted.length,
    appliedRequiredCount: requiredSorted.length - missing.length,
    missing,
    parity: missing.length === 0 && requiredSorted.length > 0,
  };
}
