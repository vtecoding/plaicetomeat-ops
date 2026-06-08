// V13.3 disaster recovery certification report generator.
//
// The first line is intentionally one of the required provenance headers. Local
// test output can never visually resemble real launch certification.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { serviceClient } from "./disaster-recovery-lib.mjs";

const service = serviceClient();
const DRILL_ID = process.env.RECOVERY_DRILL_ID ?? null;
const STRICT = process.env.STRICT === "1";

function fmt(value) {
  return value === null || value === undefined ? "not recorded" : String(value);
}

function findArtifact(artifacts, type) {
  return artifacts.find((artifact) => artifact.artifact_type === type) ?? null;
}

function metadata(artifact) {
  return artifact?.artifact_metadata ?? {};
}

function tableRows(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return ["| No results recorded | - | - | - | FAIL |"];
  }
  return results.map((row) => `| ${row.table} | ${row.source} | ${row.restored} | ${row.variance} | ${row.status} |`);
}

function sampleRows(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return ["| No samples recorded | - | FAIL |"];
  }
  return results.map((row) => `| ${row.sample} | ${row.id ?? row.detail ?? "not available"} | ${row.status} |`);
}

async function latestDrill() {
  let query = service
    .from("recovery_drills")
    .select("id, branch_id, environment, drill_type, backup_created_at, restore_completed_at, source_row_count, restored_row_count, parity_status, integrity_status, overall_verdict, executed_by, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (DRILL_ID) query = query.eq("id", DRILL_ID);
  const { data, error } = await query;
  if (error) throw new Error(`could not read recovery_drills: ${error.message}`);
  const drill = data?.[0];
  if (!drill) throw new Error(DRILL_ID ? `recovery drill ${DRILL_ID} not found` : "no recovery drills found");
  return drill;
}

async function drillArtifacts(drillId) {
  const { data, error } = await service
    .from("recovery_artifacts")
    .select("artifact_type, artifact_name, artifact_checksum, artifact_metadata, created_at")
    .eq("recovery_drill_id", drillId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not read recovery_artifacts: ${error.message}`);
  return data ?? [];
}

async function operatorName(profileId) {
  if (!profileId) return "not recorded";
  const { data, error } = await service
    .from("profiles")
    .select("email, full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (error || !data) return profileId;
  return data.full_name ? `${data.full_name} <${data.email}>` : data.email;
}

async function main() {
  const drill = await latestDrill();
  const artifacts = await drillArtifacts(drill.id);
  const operator = await operatorName(drill.executed_by);

  if (drill.environment === "PRODUCTION" && drill.drill_type === "REAL" && !STRICT) {
    throw new Error("production recovery certification report requires STRICT=1");
  }

  const real = drill.environment === "PRODUCTION" && drill.drill_type === "REAL";
  const header = real
    ? "REAL PRODUCTION RECOVERY DRILL"
    : "LOCAL TEST DATA ONLY\nNOT VALID FOR LAUNCH CERTIFICATION";
  const backup = findArtifact(artifacts, "BACKUP");
  const parity = metadata(findArtifact(artifacts, "PARITY"));
  const integrity = metadata(findArtifact(artifacts, "INTEGRITY"));
  const backupMeta = metadata(backup);

  const lines = [];
  lines.push(header);
  lines.push("");
  lines.push("# Disaster Recovery Certification - V13.3");
  lines.push("");
  lines.push("## Recovery Summary");
  lines.push("");
  lines.push(`- environment: ${drill.environment}`);
  lines.push(`- drill type: ${drill.drill_type}`);
  lines.push(`- operator: ${operator}`);
  lines.push(`- timestamp: ${drill.created_at}`);
  lines.push(`- restore completed: ${fmt(drill.restore_completed_at)}`);
  lines.push("");
  lines.push("## Backup Evidence");
  lines.push("");
  lines.push(`- artifact: ${fmt(backup?.artifact_name)}`);
  lines.push(`- backup size: ${fmt(backupMeta.backup_size_bytes)} bytes`);
  lines.push(`- checksum: ${fmt(backup?.artifact_checksum)}`);
  lines.push(`- timestamp: ${fmt(backupMeta.created_at ?? backup?.created_at)}`);
  lines.push("");
  lines.push("## Parity Results");
  lines.push("");
  lines.push("| Table | Source | Restored | Variance | Status |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  lines.push(...tableRows(parity.results));
  lines.push("");
  lines.push("## Integrity Results");
  lines.push("");
  lines.push("| Sample | Identifier | Status |");
  lines.push("| --- | --- | --- |");
  lines.push(...sampleRows(integrity.results));
  lines.push("");
  lines.push("## Final Verdict");
  lines.push("");
  lines.push(drill.overall_verdict === "RECOVERY_CERTIFIED" ? "RECOVERY CERTIFIED" : "RECOVERY FAILED");
  lines.push("");

  const reportsDir = resolve(process.cwd(), "docs", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const outPath = resolve(reportsDir, "disaster-recovery-certification.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`Verdict: ${drill.overall_verdict}`);
}

main().catch((err) => {
  console.error("disaster-recovery-certification crashed:", err);
  process.exit(1);
});
