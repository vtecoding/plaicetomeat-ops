#!/usr/bin/env node
// Live release-authority check. This runs before staging and again immediately
// before promotion so repository truth cannot silently diverge from Vercel.
const token = process.env.VERCEL_TOKEN;
const teamId = process.env.VERCEL_ORG_ID;
const projectId = process.env.VERCEL_PROJECT_ID;

if (!token || !teamId || !projectId) {
  console.error("vercel-control-plane: FAIL - VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID are required");
  process.exitCode = 1;
}

const headers = { Authorization: `Bearer ${token}` };
async function get(path) {
  const response = await fetch(`https://api.vercel.com${path}`, { headers });
  if (!response.ok) throw new Error(`Vercel API ${path} returned HTTP ${response.status}`);
  return response.json();
}

if (!process.exitCode) try {
  const [project, team] = await Promise.all([
    get(`/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(teamId)}`),
    get(`/v2/teams/${encodeURIComponent(teamId)}`),
  ]);

  const failures = [];
  if (project.autoAssignCustomDomains !== false) {
    failures.push("automatic production-domain assignment is enabled");
  }
  if (project.gitProviderOptions?.createDeployments !== "disabled") {
    failures.push("Vercel Git deployments are enabled; main can create a second production path");
  }

  const plan = String(team.billing?.plan ?? team.plan ?? "unknown").toLowerCase();
  if (plan === "hobby" || plan === "unknown") {
    failures.push(`team plan ${plan} cannot evidence restricted production RBAC`);
  }

  if (failures.length > 0) {
    console.error(`vercel-control-plane: FAIL - ${failures.join(" | ")}`);
    process.exitCode = 1;
  } else {
    console.log(`vercel-control-plane: PASS - domain auto-assignment off; Git deploys off; RBAC-capable plan ${plan}`);
  }
} catch (error) {
  console.error(`vercel-control-plane: FAIL - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
