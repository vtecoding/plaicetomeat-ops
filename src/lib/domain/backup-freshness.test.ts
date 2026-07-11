import { describe, expect, it } from "vitest";

import { interpretBackupFreshness } from "./backup-freshness";

describe("interpretBackupFreshness", () => {
  it("is HEALTHY when a recent successful backup exists", () => {
    const f = interpretBackupFreshness({
      hasSuccess: true,
      isFresh: true,
      ageSeconds: 3600,
      lastSuccessAt: "2026-07-11T00:00:00Z",
    });
    expect(f.state).toBe("HEALTHY");
    expect(f.lastSuccessAt).toBe("2026-07-11T00:00:00Z");
  });

  it("DEGRADES when the latest backup is stale", () => {
    const f = interpretBackupFreshness({
      hasSuccess: true,
      isFresh: false,
      ageSeconds: 60 * 60 * 72,
      lastSuccessAt: "2026-07-08T00:00:00Z",
    });
    expect(f.state).toBe("DEGRADED");
    expect(f.detail).toContain("stale");
  });

  it("DEGRADES when no successful backup has ever been recorded (PTM-DR-001 today)", () => {
    const f = interpretBackupFreshness({
      hasSuccess: false,
      isFresh: false,
      ageSeconds: null,
      lastSuccessAt: null,
    });
    expect(f.state).toBe("DEGRADED");
    expect(f.detail).toContain("no successful");
  });

  it("DEGRADES (fail-closed) when the freshness signal is unavailable", () => {
    expect(interpretBackupFreshness(null, { available: false }).state).toBe("DEGRADED");
    expect(interpretBackupFreshness(null).state).toBe("DEGRADED");
  });
});
