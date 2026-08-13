export function deploymentUrlFromOutput(output) {
  const urls = String(output).match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/g) ?? [];
  return urls.at(-1) ?? null;
}

export function validateDeploymentHealth(report, { expectedSha, applicationGeneration }) {
  const errors = [];
  const observedSha = String(report?.build?.commit ?? "");
  if (!observedSha || !(expectedSha.startsWith(observedSha) || observedSha.startsWith(expectedSha))) {
    errors.push(`deployment SHA ${observedSha || "unknown"} does not match ${expectedSha.slice(0, 12)}`);
  }
  if (Number(report?.compatibility?.applicationGeneration) !== applicationGeneration) {
    errors.push(`application generation is ${report?.compatibility?.applicationGeneration ?? "unknown"}, expected ${applicationGeneration}`);
  }
  if (report?.compatibility?.compatible !== true) errors.push("application/schema contract is incompatible");
  if (report?.state === "UNAVAILABLE" || report?.state === "CONFIGURATION_REQUIRED") {
    errors.push(`health state is ${report.state}`);
  }
  return errors;
}

export function validateReleaseCertificate(certificate, { expectedSha, applicationGeneration }) {
  const errors = [];
  if (certificate?.certificateVersion !== 1 || certificate?.certified !== true) errors.push("certificate is not a PTM v1 success record");
  if (certificate?.commitSha !== expectedSha) errors.push("certificate commit does not equal HEAD");
  if (certificate?.applicationGeneration !== applicationGeneration) errors.push("certificate application generation does not match this source");
  try {
    const deployment = new URL(certificate?.deploymentUrl);
    if (deployment.protocol !== "https:" || !deployment.hostname.endsWith(".vercel.app")) errors.push("certificate deployment URL is not a Vercel HTTPS URL");
  } catch {
    errors.push("certificate deployment URL is invalid");
  }
  return errors;
}

export function evaluatePromotionDecision({
  certified,
  appGeneration,
  dbContract,
  deploymentCommitMatches,
  controlSourceClean,
  lineageCertified,
}) {
  const compatible = Number.isInteger(appGeneration)
    && appGeneration >= Number(dbContract?.minSupportedAppGeneration)
    && appGeneration <= Number(dbContract?.maxSupportedAppGeneration);
  return {
    allowed: certified === true
      && compatible
      && deploymentCommitMatches === true
      && controlSourceClean === true
      && lineageCertified === true,
    compatible,
  };
}

export async function fetchDeploymentHealth(deploymentUrl, { attempts = 12, delayMs = 5000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/health", deploymentUrl), { redirect: "error" });
      const report = await response.json();
      if (response.ok) return report;
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError ?? new Error("deployment health was unavailable");
}
