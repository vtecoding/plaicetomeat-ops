import { describe, expect, it } from "vitest";
import type { HealthScore } from "@/lib/shop-intelligence/types";
import { findForbiddenTerms } from "./language";
import { buildShopStatus } from "./status";

function health(over: Partial<HealthScore> = {}): HealthScore {
  return {
    score: 81,
    band: "strong",
    categories: [],
    strong: ["Stock accuracy"],
    needsAttention: [],
    ...over,
  };
}

describe("buildShopStatus", () => {
  it("maps strong → Good", () => {
    expect(buildShopStatus(health()).band).toBe("good");
  });
  it("maps fair and needs_attention → Needs attention", () => {
    expect(buildShopStatus(health({ band: "fair" })).band).toBe("needs_attention");
    expect(buildShopStatus(health({ band: "needs_attention" })).band).toBe("needs_attention");
  });
  it("maps unknown → Unknown", () => {
    expect(buildShopStatus(health({ band: "unknown", score: null })).band).toBe("unknown");
  });

  it("never surfaces a numeric score", () => {
    const status = buildShopStatus(health({ needsAttention: ["Waste tracking"] }));
    const text = [status.headline, ...status.good, ...status.watch].join(" ");
    expect(text).not.toMatch(/\d/);
  });

  it("carries no jargon into the reasons", () => {
    const status = buildShopStatus(health({ strong: ["Buying decisions"], needsAttention: ["Cost coverage"] }));
    const text = [status.headline, ...status.good, ...status.watch].join(" ");
    expect(findForbiddenTerms(text)).toEqual([]);
  });
});
