#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fetchDeploymentHealth,
  validateDeploymentHealth,
  validateReleaseCertificate,
} from "./lib/release-artifact.mjs";

const config = JSON.parse(readFileSync(join(process.cwd(), "config", "release-contract.json"), "utf8"));
const applicationGeneration = Number(config.applicationGeneration);
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const certificatePath = process.argv[2] ?? process.env.PTM_RELEASE_CERTIFICATE_PATH ?? join(process.cwd(), ".ptm", "release-certificate.json");
const certificate = JSON.parse(readFileSync(certificatePath, "utf8"));
const certificateErrors = validateReleaseCertificate(certificate, { expectedSha: commitSha, applicationGeneration });
if (certificateErrors.length > 0) throw new Error(`promotion denied: ${certificateErrors.join("; ")}`);
const productionUrl = process.env.PTM_PRODUCTION_URL;
if (!productionUrl) throw new Error("promotion denied: PTM_PRODUCTION_URL is required for exact post-promotion verification");

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if ((result.status ?? 1) !== 0) throw new Error(`${command} failed`);
}

const report = await fetchDeploymentHealth(certificate.deploymentUrl, { attempts: 1, delayMs: 0 });
const healthErrors = validateDeploymentHealth(report, { expectedSha: commitSha, applicationGeneration });
if (healthErrors.length > 0) throw new Error(`promotion denied: ${healthErrors.join("; ")}`);

run("node", ["scripts/verify-release-lineage.mjs", "--require-clean"]);
run("node", ["scripts/verify-vercel-control-plane.mjs"]);
run("node", ["scripts/verify-release-gate.mjs"], {
  RELEASE_GATE_MODE: "promotion",
  EXPECTED_RELEASE_SHA: commitSha,
  EXPECTED_DEPLOYMENT_URL: certificate.deploymentUrl,
});
run("npx", [
  "vercel",
  "promote",
  certificate.deploymentUrl,
  "--yes",
  ...(process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : []),
]);
const productionReport = await fetchDeploymentHealth(productionUrl);
const productionErrors = validateDeploymentHealth(productionReport, { expectedSha: commitSha, applicationGeneration });
if (productionErrors.length > 0) throw new Error(`production alias verification failed: ${productionErrors.join("; ")}`);
console.log(`PROMOTED_EXACT_DEPLOYMENT=${certificate.deploymentUrl}`);
