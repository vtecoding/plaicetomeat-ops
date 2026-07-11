// PTM-REL-009 — safe build identity.
//
// Pure resolver over an env-like bag so it is unit-testable without a real
// process env. The commit SHA is injected at build time (see next.config.ts);
// this never reads or exposes any secret. `known` is false when no immutable
// commit identifier is available — the health endpoint treats that as a reason
// to refuse HEALTHY (fail-closed), because an unreconcilable deploy violates
// release-identity discipline (spec §40).

export type BuildIdentity = {
  commitSha: string | null;
  shortSha: string | null;
  known: boolean;
  source: "PTM_BUILD_SHA" | "VERCEL_GIT_COMMIT_SHA" | "none";
};

type EnvBag = Record<string, string | undefined>;

const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function resolveBuildIdentity(env: EnvBag): BuildIdentity {
  const candidates: Array<{ source: BuildIdentity["source"]; value: string | undefined }> = [
    { source: "PTM_BUILD_SHA", value: env.PTM_BUILD_SHA },
    { source: "VERCEL_GIT_COMMIT_SHA", value: env.VERCEL_GIT_COMMIT_SHA },
  ];

  for (const { source, value } of candidates) {
    const trimmed = value?.trim();
    if (trimmed && SHA_RE.test(trimmed)) {
      return {
        commitSha: trimmed,
        shortSha: trimmed.slice(0, 7),
        known: true,
        source,
      };
    }
  }

  return { commitSha: null, shortSha: null, known: false, source: "none" };
}
