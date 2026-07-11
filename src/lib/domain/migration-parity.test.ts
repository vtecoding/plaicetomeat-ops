import { describe, expect, it } from "vitest";

import { computeMigrationParity } from "./migration-parity";
import { REQUIRED_MIGRATION_VERSIONS, REQUIRED_MIGRATION_HEAD } from "@/lib/server/migration-manifest.generated";

describe("computeMigrationParity", () => {
  it("reports parity when every required version is applied", () => {
    const required = ["202606300900", "202606301000", "202607011300"];
    const result = computeMigrationParity(required, [...required, "202600000000"]);
    expect(result.parity).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.requiredHead).toBe("202607011300");
    expect(result.appliedRequiredCount).toBe(3);
  });

  it("detects the exact PTM-REL-002 production drift (3 behind)", () => {
    const required = [
      "202606300900",
      "202606301000",
      "202607011300",
      "202607101200",
    ];
    // Production ledger observed in the audit: head 202606300900, missing the last 3.
    const applied = ["202606300900"];
    const result = computeMigrationParity(required, applied);
    expect(result.parity).toBe(false);
    expect(result.missing).toEqual(["202606301000", "202607011300", "202607101200"]);
    expect(result.observedHead).toBe("202606300900");
    expect(result.appliedRequiredCount).toBe(1);
  });

  it("is not fooled by extra applied versions beyond the required head", () => {
    const required = ["202606300900", "202606301000"];
    const applied = ["202606300900", "202606301000", "209900000000"];
    expect(computeMigrationParity(required, applied).parity).toBe(true);
  });

  it("never reports parity against an empty required set", () => {
    expect(computeMigrationParity([], ["x"]).parity).toBe(false);
  });

  it("holds parity for the real generated manifest against itself", () => {
    const result = computeMigrationParity(REQUIRED_MIGRATION_VERSIONS, REQUIRED_MIGRATION_VERSIONS);
    expect(result.parity).toBe(true);
    expect(result.requiredHead).toBe(REQUIRED_MIGRATION_HEAD);
    expect(result.missing).toEqual([]);
  });

  it("fails parity if the deployed ledger is missing the newest manifest migration", () => {
    const behind = REQUIRED_MIGRATION_VERSIONS.slice(0, -1);
    const result = computeMigrationParity(REQUIRED_MIGRATION_VERSIONS, behind);
    expect(result.parity).toBe(false);
    expect(result.missing).toEqual([REQUIRED_MIGRATION_HEAD]);
  });
});
