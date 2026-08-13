import releaseContract from "../../../config/release-contract.json";

export const APP_GENERATION = releaseContract.applicationGeneration;
export const PREVIOUS_APP_GENERATION = releaseContract.previousApplicationGeneration;
export const LEGACY_DB_GENERATION = releaseContract.legacyDatabaseGeneration;
export const LEGACY_MIGRATION_HEAD = releaseContract.legacyMigrationHead;
export const EXPAND_DB_GENERATION = releaseContract.expandDatabaseGeneration;
export const EXPAND_MIGRATION_HEAD = releaseContract.expandMigrationHead;

export type ApplicationSchemaContract = {
  dbGeneration: number;
  minSupportedAppGeneration: number;
  maxSupportedAppGeneration: number;
  migrationHead: string;
  source: "contract_v1" | "certified_legacy_baseline";
};

export type SchemaCompatibility = {
  applicationGeneration: number;
  compatible: boolean;
  contract: ApplicationSchemaContract;
};

export function evaluateSchemaCompatibility(
  applicationGeneration: number,
  contract: ApplicationSchemaContract,
): SchemaCompatibility {
  return {
    applicationGeneration,
    compatible:
      Number.isInteger(applicationGeneration) &&
      applicationGeneration >= contract.minSupportedAppGeneration &&
      applicationGeneration <= contract.maxSupportedAppGeneration,
    contract,
  };
}

/**
 * App generation 19 deliberately supports the last certified pre-expand schema.
 * The fallback is exact: a partial, older or unknown ledger is never inferred to
 * be compatible merely because the new contract RPC is absent.
 */
export function inferCertifiedLegacyContract(
  appliedVersions: readonly string[],
  certifiedLegacyVersions: readonly string[],
): ApplicationSchemaContract | null {
  const applied = [...new Set(appliedVersions.map(String))].sort();
  const certified = [...new Set(certifiedLegacyVersions.map(String))].sort();
  if (
    certified.length === 0 ||
    certified.at(-1) !== LEGACY_MIGRATION_HEAD ||
    applied.length !== certified.length ||
    applied.some((version, index) => version !== certified[index])
  ) {
    return null;
  }

  return {
    dbGeneration: LEGACY_DB_GENERATION,
    minSupportedAppGeneration: PREVIOUS_APP_GENERATION,
    maxSupportedAppGeneration: APP_GENERATION,
    migrationHead: LEGACY_MIGRATION_HEAD,
    source: "certified_legacy_baseline",
  };
}

export function parseSchemaContractRow(row: Record<string, unknown>): ApplicationSchemaContract | null {
  const dbGeneration = Number(row.db_generation);
  const minSupportedAppGeneration = Number(row.min_supported_app_generation);
  const maxSupportedAppGeneration = Number(row.max_supported_app_generation);
  const migrationHead = String(row.migration_head ?? "");

  if (
    !Number.isInteger(dbGeneration) ||
    !Number.isInteger(minSupportedAppGeneration) ||
    !Number.isInteger(maxSupportedAppGeneration) ||
    minSupportedAppGeneration > maxSupportedAppGeneration ||
    !/^\d{12}$/.test(migrationHead)
  ) {
    return null;
  }

  return {
    dbGeneration,
    minSupportedAppGeneration,
    maxSupportedAppGeneration,
    migrationHead,
    source: "contract_v1",
  };
}
