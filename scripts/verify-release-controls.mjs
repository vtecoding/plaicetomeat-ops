#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const stage = read("scripts/stage-release-candidate.mjs");
const promote = read("scripts/promote-certified-release.mjs");
const workflow = read(".github/workflows/production-release.yml");
const controlPlane = read("scripts/verify-vercel-control-plane.mjs");
const playwright = read("playwright.config.ts");
const releaseArtifact = read("scripts/lib/release-artifact.mjs");
const releaseGate = read("scripts/verify-release-gate.mjs");
const migration = read("supabase/migrations/202608130900_p0_truth_and_schema_compatibility.sql");
const runbook = read("docs/release-runbook.md");
const config = JSON.parse(read("config/release-contract.json"));

const failures = [];
if (!stage.includes('"--skip-domain"')) failures.push("staging does not suppress production domain assignment");
if (!stage.includes("verify-vercel-control-plane.mjs") || !promote.includes("verify-vercel-control-plane.mjs")) failures.push("stage/promote do not re-check the live Vercel authority boundary");
if (!controlPlane.includes("autoAssignCustomDomains !== false") || !controlPlane.includes('createDeployments !== "disabled"')) failures.push("live control-plane guard does not require both routing paths disabled");
if (!stage.includes("validateDeploymentHealth") || !stage.includes("verify-release-gate.mjs")) failures.push("staging does not certify the exact deployment");
if (!workflow.includes("VERCEL_AUTOMATION_BYPASS_SECRET") || !playwright.includes("x-vercel-protection-bypass") || !releaseArtifact.includes("x-vercel-protection-bypass")) failures.push("protected staged deployments are not authenticated during certification");
if (!workflow.includes("playwright install --with-deps chromium")) failures.push("production release does not provision the hosted certification browser");
if (!releaseGate.includes("fetchDeploymentHealth") || !releaseGate.includes("validateDeploymentHealth")) failures.push("promotion gate bypasses the shared protected-deployment health verifier");
if (!promote.includes("validateReleaseCertificate") || !promote.includes('"promote"')) failures.push("promotion is not certificate-bound");
if (workflow.indexOf("release:stage") < 0 || workflow.indexOf("release:promote") <= workflow.indexOf("release:stage")) failures.push("authoritative workflow does not stage before promote");
if (!workflow.includes("environment: production") || !workflow.includes("github.ref == 'refs/heads/main'")) failures.push("production workflow lacks protected main/environment boundary");
if (!migration.includes("VALUES (true, 19, 18, 19, '202608130900')")) failures.push("expand migration lacks generation 18-19 overlap");
if (migration.includes("REVOKE ALL ON FUNCTION public.get_applied_migration_versions()")) failures.push("expand migration prematurely retires generation 18");
if (config.applicationGeneration !== 19 || config.previousApplicationGeneration !== 18) failures.push("release generation config drifted");
if (/npx\s+vercel\s+(?:deploy\s+)?--prod|npx\s+vercel\s+(?:promote|rollback)/iu.test(runbook)) failures.push("runbook authorizes a manual Vercel production path");

if (failures.length > 0) {
  console.error(`release-controls: FAIL - ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("release-controls: PASS - expand overlap and exact-artifact stage/promote path are structurally enforced");
