import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluatePromotionDecision,
  fetchDeploymentHealth,
  validateDeploymentHealth,
  validateReleaseCertificate,
} from "../../../scripts/lib/release-artifact.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
const healthy = {
  state: "HEALTHY",
  build: { commit: sha.slice(0, 12) },
  compatibility: { applicationGeneration: 19, compatible: true },
};

describe("exact release artifact boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts only the staged deployment that reports the certified SHA and generation", () => {
    expect(validateDeploymentHealth(healthy, { expectedSha: sha, applicationGeneration: 19 })).toEqual([]);
    expect(validateDeploymentHealth({ ...healthy, build: { commit: "ffffffffffff" } }, { expectedSha: sha, applicationGeneration: 19 })).toContainEqual(expect.stringContaining("does not match"));
    expect(validateDeploymentHealth({ ...healthy, compatibility: { applicationGeneration: 18, compatible: true } }, { expectedSha: sha, applicationGeneration: 19 })).toContainEqual(expect.stringContaining("generation"));
  });

  it("denies uncertified, different-commit and non-Vercel certificates", () => {
    const certificate = {
      certificateVersion: 1,
      certified: true,
      commitSha: sha,
      applicationGeneration: 19,
      deploymentUrl: "https://ptm-abc.vercel.app",
    };
    expect(validateReleaseCertificate(certificate, { expectedSha: sha, applicationGeneration: 19 })).toEqual([]);
    expect(validateReleaseCertificate({ ...certificate, certified: false }, { expectedSha: sha, applicationGeneration: 19 })).not.toEqual([]);
    expect(validateReleaseCertificate({ ...certificate, commitSha: "f".repeat(40) }, { expectedSha: sha, applicationGeneration: 19 })).not.toEqual([]);
    expect(validateReleaseCertificate({ ...certificate, deploymentUrl: "https://example.com" }, { expectedSha: sha, applicationGeneration: 19 })).not.toEqual([]);
  });

  it.each([
    ["certified N+1 + expanded DB", 19, { minSupportedAppGeneration: 18, maxSupportedAppGeneration: 19 }, true, true],
    ["certified N + expanded DB", 18, { minSupportedAppGeneration: 18, maxSupportedAppGeneration: 19 }, true, true],
    ["certified N + contracted DB", 18, { minSupportedAppGeneration: 19, maxSupportedAppGeneration: 19 }, true, false],
    ["uncertified N+1", 19, { minSupportedAppGeneration: 18, maxSupportedAppGeneration: 19 }, false, false],
  ])("enforces promotion case: %s", (_name, appGeneration, dbContract, certified, allowed) => {
    expect(evaluatePromotionDecision({
      certified,
      appGeneration,
      dbContract,
      deploymentCommitMatches: true,
      controlSourceClean: true,
      lineageCertified: true,
    }).allowed).toBe(allowed);
  });

  it("denies a different commit, dirty control source and pre-lineage artifact", () => {
    const base = {
      certified: true,
      appGeneration: 19,
      dbContract: { minSupportedAppGeneration: 18, maxSupportedAppGeneration: 19 },
      deploymentCommitMatches: true,
      controlSourceClean: true,
      lineageCertified: true,
    };
    expect(evaluatePromotionDecision({ ...base, deploymentCommitMatches: false }).allowed).toBe(false);
    expect(evaluatePromotionDecision({ ...base, controlSourceClean: false }).allowed).toBe(false);
    expect(evaluatePromotionDecision({ ...base, lineageCertified: false }).allowed).toBe(false);
  });

  it("uses the Vercel automation bypass cookie for protected candidate health", async () => {
    const deploymentUrl = "https://ptm-abc.vercel.app";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 307,
        headers: {
          location: `${deploymentUrl}/api/health`,
          "set-cookie": "_vercel_jwt=verification-cookie; Path=/; Secure; HttpOnly",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(healthy), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "automation-secret");
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDeploymentHealth(deploymentUrl, { attempts: 1, delayMs: 0 })).resolves.toEqual(healthy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-vercel-protection-bypass": "automation-secret",
      "x-vercel-set-bypass-cookie": "true",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      cookie: "_vercel_jwt=verification-cookie",
      "x-vercel-protection-bypass": "automation-secret",
    });
  });
});
