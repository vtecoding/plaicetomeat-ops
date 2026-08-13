import { describe, expect, it } from "vitest";

import {
  APP_GENERATION,
  EXPAND_MIGRATION_HEAD,
  LEGACY_MIGRATION_HEAD,
  PREVIOUS_APP_GENERATION,
  evaluateSchemaCompatibility,
  inferCertifiedLegacyContract,
  parseSchemaContractRow,
  type ApplicationSchemaContract,
} from "./schema-compatibility";

const oldDb: ApplicationSchemaContract = {
  dbGeneration: 18,
  minSupportedAppGeneration: 18,
  maxSupportedAppGeneration: 19,
  migrationHead: LEGACY_MIGRATION_HEAD,
  source: "certified_legacy_baseline",
};
const expandedDb: ApplicationSchemaContract = {
  dbGeneration: 19,
  minSupportedAppGeneration: 18,
  maxSupportedAppGeneration: 19,
  migrationHead: EXPAND_MIGRATION_HEAD,
  source: "contract_v1",
};
const contractedDb: ApplicationSchemaContract = {
  ...expandedDb,
  minSupportedAppGeneration: 19,
};

describe("two-generation schema compatibility", () => {
  it.each([
    ["App N / DB old", PREVIOUS_APP_GENERATION, oldDb, true],
    ["App N / DB expanded", PREVIOUS_APP_GENERATION, expandedDb, true],
    ["App N / DB contracted", PREVIOUS_APP_GENERATION, contractedDb, false],
    ["App N+1 / DB old", APP_GENERATION, oldDb, true],
    ["App N+1 / DB expanded", APP_GENERATION, expandedDb, true],
    ["App N+1 / DB contracted", APP_GENERATION, contractedDb, true],
    ["App N-1 / DB old", PREVIOUS_APP_GENERATION - 1, oldDb, false],
    ["App N-1 / DB expanded", PREVIOUS_APP_GENERATION - 1, expandedDb, false],
    ["App N-1 / DB contracted", PREVIOUS_APP_GENERATION - 1, contractedDb, false],
  ])("enforces %s", (_name, app, db, expected) => {
    expect(evaluateSchemaCompatibility(app, db).compatible).toBe(expected);
  });

  it("infers only the exact certified pre-expand ledger", () => {
    const certified = ["202607151500", LEGACY_MIGRATION_HEAD];
    expect(inferCertifiedLegacyContract(certified, certified)).toEqual(oldDb);
    expect(inferCertifiedLegacyContract(certified.slice(0, -1), certified)).toBeNull();
    expect(inferCertifiedLegacyContract([...certified, "202608010000"], certified)).toBeNull();
  });

  it("rejects malformed database contracts", () => {
    expect(parseSchemaContractRow({
      db_generation: 19,
      min_supported_app_generation: 20,
      max_supported_app_generation: 19,
      migration_head: EXPAND_MIGRATION_HEAD,
    })).toBeNull();
  });
});
