import { describe, expect, it } from "vitest";

import { resolveBuildIdentity } from "./build-identity";

describe("resolveBuildIdentity", () => {
  it("prefers the explicitly injected PTM_BUILD_SHA", () => {
    const id = resolveBuildIdentity({
      PTM_BUILD_SHA: "d1a82e23a5a785732ead8fc4d6fc9dba9374bb55",
      VERCEL_GIT_COMMIT_SHA: "0000000000000000000000000000000000000000",
    });
    expect(id.known).toBe(true);
    expect(id.source).toBe("PTM_BUILD_SHA");
    expect(id.shortSha).toBe("d1a82e2");
  });

  it("falls back to VERCEL_GIT_COMMIT_SHA", () => {
    const id = resolveBuildIdentity({ VERCEL_GIT_COMMIT_SHA: "abc1234def" });
    expect(id.known).toBe(true);
    expect(id.source).toBe("VERCEL_GIT_COMMIT_SHA");
    expect(id.commitSha).toBe("abc1234def");
  });

  it("is UNKNOWN (fail-closed) when no immutable SHA is present", () => {
    const id = resolveBuildIdentity({});
    expect(id.known).toBe(false);
    expect(id.source).toBe("none");
    expect(id.commitSha).toBeNull();
  });

  it("rejects non-SHA junk values (fail-closed)", () => {
    expect(resolveBuildIdentity({ PTM_BUILD_SHA: "unknown" }).known).toBe(false);
    expect(resolveBuildIdentity({ PTM_BUILD_SHA: "   " }).known).toBe(false);
    expect(resolveBuildIdentity({ PTM_BUILD_SHA: "not a sha!" }).known).toBe(false);
  });
});
