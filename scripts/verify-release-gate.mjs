#!/usr/bin/env node
// Fail-closed release gate. Compatibility is an explicit generation range;
// migration counts remain evidence and a named security floor.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { fetchDeploymentHealth, validateDeploymentHealth } from "./lib/release-artifact.mjs";

const MODE = (process.env.RELEASE_GATE_MODE ?? "release").toLowerCase();
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MANIFEST_FILE = join(process.cwd(), "src", "lib", "server", "migration-manifest.generated.ts");
const contractConfig = JSON.parse(readFileSync(join(process.cwd(), "config", "release-contract.json"), "utf8"));
const APP_GENERATION = Number(contractConfig.applicationGeneration);
const LEGACY_HEAD = String(contractConfig.legacyMigrationHead);
const BACKUP_MAX_AGE_HOURS = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 48);
const REQUIRED_SECURITY_MIGRATIONS = ["202606290900", "202607101200", "202607110900", "202608130900"];

let failures = 0;
let skips = 0;
const line = (value = "") => console.log(value);
function pass(name, detail = "") { line(`  PASS  ${name}${detail ? `  ::  ${detail}` : ""}`); }
function fail(name, detail = "") { failures += 1; line(`  FAIL  ${name}${detail ? `  ::  ${detail}` : ""}`); }
function skip(name, detail = "") { skips += 1; line(`  SKIP  ${name}${detail ? `  ::  ${detail}` : ""}`); }

function deriveManifest() {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  const entries = files.map((file) => ({
    file,
    version: file.slice(0, file.indexOf("_")),
    checksum: createHash("sha256")
      .update(readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/\r\n/g, "\n"))
      .digest("hex"),
  }));
  const manifestChecksum = createHash("sha256")
    .update(entries.map((entry) => `${entry.version}:${entry.file}:${entry.checksum}`).join("\n"))
    .digest("hex");
  return { versions: entries.map((entry) => entry.version), head: entries.at(-1)?.version ?? "", manifestChecksum };
}

function committedManifestChecksum() {
  const source = readFileSync(MANIFEST_FILE, "utf8");
  return source.match(/MIGRATION_MANIFEST_CHECKSUM = "([0-9a-f]{64})"/)?.[1] ?? null;
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function missingRpc(message) {
  const normalized = String(message).toLowerCase();
  return normalized.includes("schema cache") || normalized.includes("could not find the function") || normalized.includes("not find the function");
}

function evaluateCompatibility(contract) {
  return Number.isInteger(APP_GENERATION)
    && APP_GENERATION >= Number(contract.min_supported_app_generation)
    && APP_GENERATION <= Number(contract.max_supported_app_generation);
}

const derived = deriveManifest();
const committedChecksum = committedManifestChecksum();
line(`\nPTM release gate (${MODE})`);
if (committedChecksum === derived.manifestChecksum) {
  pass("migration manifest matches supabase/migrations", `${derived.versions.length} migrations at ${derived.head}`);
} else {
  fail("migration manifest matches supabase/migrations", "run gen:migration-manifest and commit the result");
}

const head = git(["rev-parse", "HEAD"]);
const changes = git(["status", "--porcelain"]);
const releaseSha = (process.env.EXPECTED_RELEASE_SHA || process.env.PTM_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
if (changes === null) {
  if (MODE === "local") skip("release artifact is a clean commit", "git unavailable");
  else fail("release artifact is a clean commit", "git unavailable");
} else if (changes) {
  if (MODE === "local") skip("release artifact is a clean commit", "working changes present");
  else fail("release artifact is a clean commit", "commit the exact artifact before staging");
} else {
  pass("release artifact is a clean commit", head?.slice(0, 12) ?? "clean");
}

if (!releaseSha) {
  if (MODE === "local") skip("build identity reconciled to release commit", "no expected SHA");
  else fail("build identity reconciled to release commit", "EXPECTED_RELEASE_SHA is required");
} else if (head && (releaseSha === head || releaseSha.startsWith(head) || head.startsWith(releaseSha))) {
  pass("build identity reconciled to release commit", releaseSha.slice(0, 12));
} else {
  fail("build identity reconciled to release commit", `build=${releaseSha.slice(0, 12)} head=${String(head).slice(0, 12)}`);
}

const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
async function rpc(name, body) {
  const response = await fetch(`${dbUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function readMigrationVersions() {
  try {
    return (await rpc("get_application_schema_versions_v1")).map((row) => String(row.version));
  } catch (error) {
    if (!missingRpc(error.message)) throw error;
    return (await rpc("get_applied_migration_versions")).map((row) => String(row.version));
  }
}

async function readSchemaContract(applied) {
  try {
    const rows = await rpc("get_application_schema_contract_v1");
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (!missingRpc(error.message)) throw error;
    const expectedLegacy = derived.versions.filter((version) => version <= LEGACY_HEAD);
    const actual = [...new Set(applied)].sort();
    if (actual.length !== expectedLegacy.length || actual.some((version, index) => version !== expectedLegacy[index])) return null;
    return {
      db_generation: Number(contractConfig.legacyDatabaseGeneration),
      min_supported_app_generation: Number(contractConfig.previousApplicationGeneration),
      max_supported_app_generation: APP_GENERATION,
      migration_head: LEGACY_HEAD,
      source: "certified_legacy_baseline",
    };
  }
}

async function validateExactDeployment() {
  const deploymentUrl = process.env.EXPECTED_DEPLOYMENT_URL?.trim();
  if (!deploymentUrl) {
    if (MODE === "promotion") fail("exact staged deployment certified", "EXPECTED_DEPLOYMENT_URL is required in promotion mode");
    else skip("exact staged deployment certified", "runs after staging");
    return;
  }
  try {
    const report = await fetchDeploymentHealth(deploymentUrl, { attempts: 1, delayMs: 0 });
    const observedSha = String(report?.build?.commit ?? "");
    const healthErrors = validateDeploymentHealth(report, {
      expectedSha: releaseSha,
      applicationGeneration: APP_GENERATION,
    });
    if (healthErrors.length === 0) {
      pass("exact staged deployment certified", `${new URL(deploymentUrl).host} sha=${observedSha} app=${APP_GENERATION}`);
    } else {
      fail("exact staged deployment certified", healthErrors.join("; "));
    }
  } catch (error) {
    fail("exact staged deployment certified", error.message);
  }
}

async function productionChecks() {
  if (!dbUrl || !dbKey) {
    for (const name of [
      "application/schema generation compatible",
      "candidate migrations applied",
      "required security-lock migrations applied",
      "recent verified backup exists",
    ]) {
      if (MODE === "local") skip(name, "production credentials unavailable");
      else fail(name, "production credentials unavailable");
    }
    await validateExactDeployment();
    return;
  }

  try {
    const versions = await readMigrationVersions();
    const applied = new Set(versions);
    const missing = derived.versions.filter((version) => !applied.has(version));
    const unexpected = versions.filter((version) => !derived.versions.includes(version)).sort();
    if (missing.length === 0) pass("candidate migrations applied", `${derived.versions.length} required; ${unexpected.length} later`);
    else fail("candidate migrations applied", `missing=[${missing.join(", ")}]`);

    const contract = await readSchemaContract(versions);
    if (contract && evaluateCompatibility(contract)) {
      pass(
        "application/schema generation compatible",
        `app=${APP_GENERATION} db=${contract.db_generation} range=${contract.min_supported_app_generation}-${contract.max_supported_app_generation}`,
      );
    } else {
      fail("application/schema generation compatible", contract ? `app=${APP_GENERATION} outside ${contract.min_supported_app_generation}-${contract.max_supported_app_generation}` : "no valid contract");
    }

    const missingSecurity = REQUIRED_SECURITY_MIGRATIONS.filter((version) => !applied.has(version));
    if (missingSecurity.length === 0) pass("required security-lock migrations applied", REQUIRED_SECURITY_MIGRATIONS.join(", "));
    else fail("required security-lock migrations applied", `missing=[${missingSecurity.join(", ")}]`);
  } catch (error) {
    fail("candidate migrations applied", error.message);
    fail("application/schema generation compatible", "contract probe failed");
    fail("required security-lock migrations applied", "migration probe failed");
  }

  try {
    const rows = await rpc("get_backup_freshness", { p_max_age_hours: BACKUP_MAX_AGE_HOURS });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row?.has_success && row?.is_fresh) pass("recent verified backup exists", `age ${Math.floor(Number(row.age_seconds ?? 0) / 3600)}h`);
    else fail("recent verified backup exists", row ? `has_success=${row.has_success} is_fresh=${row.is_fresh}` : "no row");
  } catch (error) {
    fail("recent verified backup exists", error.message);
  }

  await validateExactDeployment();
}

await productionChecks();
line();
line(`Release gate (${MODE}): ${failures} failed, ${skips} skipped.`);
if (failures > 0) {
  line("PROMOTION BLOCKED");
  process.exitCode = 1;
} else {
  line(MODE === "promotion" ? "EXACT-ARTIFACT PROMOTION ALLOWED" : "STAGING ALLOWED");
}
