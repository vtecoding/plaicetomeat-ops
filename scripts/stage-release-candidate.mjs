#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  deploymentUrlFromOutput,
  fetchDeploymentHealth,
  validateDeploymentHealth,
} from "./lib/release-artifact.mjs";

const config = JSON.parse(readFileSync(join(process.cwd(), "config", "release-contract.json"), "utf8"));
const applicationGeneration = Number(config.applicationGeneration);
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const certificatePath = process.env.PTM_RELEASE_CERTIFICATE_PATH ?? join(process.cwd(), ".ptm", "release-certificate.json");

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if ((result.status ?? 1) !== 0) throw new Error(`${command} failed`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

run("node", ["scripts/verify-release-lineage.mjs", "--require-clean"]);
run("node", ["scripts/verify-vercel-control-plane.mjs"]);
run("node", ["scripts/verify-release-gate.mjs"], {
  RELEASE_GATE_MODE: "release",
  EXPECTED_RELEASE_SHA: commitSha,
});

const deployOutput = run("npx", [
  "vercel",
  "deploy",
  "--prod",
  "--skip-domain",
  "--yes",
  "--build-env",
  `PTM_BUILD_SHA=${commitSha}`,
  ...(process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : []),
]);
const deploymentUrl = deploymentUrlFromOutput(deployOutput);
if (!deploymentUrl) throw new Error("Vercel did not return an immutable deployment URL");

const report = await fetchDeploymentHealth(deploymentUrl);
const healthErrors = validateDeploymentHealth(report, { expectedSha: commitSha, applicationGeneration });
if (healthErrors.length > 0) throw new Error(`staged deployment failed certification: ${healthErrors.join("; ")}`);

run("corepack", ["pnpm", "playwright:hosted"], { HOSTED_BASE_URL: deploymentUrl });
run("node", ["scripts/verify-release-gate.mjs"], {
  RELEASE_GATE_MODE: "promotion",
  EXPECTED_RELEASE_SHA: commitSha,
  EXPECTED_DEPLOYMENT_URL: deploymentUrl,
});

const certificate = {
  certificateVersion: 1,
  certified: true,
  commitSha,
  applicationGeneration,
  deploymentUrl,
  dbContract: report.compatibility,
  certifiedAt: new Date().toISOString(),
};
mkdirSync(dirname(certificatePath), { recursive: true });
writeFileSync(certificatePath, `${JSON.stringify(certificate, null, 2)}\n`, { flag: "wx" });
console.log(`PTM_RELEASE_CERTIFICATE=${certificatePath}`);
console.log(`PTM_STAGED_DEPLOYMENT=${deploymentUrl}`);
