// V13.2 disaster recovery framework verification.
//
// LOCAL mode proves the framework with local test data and always prints the
// provenance warning. PRODUCTION mode requires STRICT=1 plus separate source and
// restored Supabase credentials; otherwise it fails closed.

import { spawnSync } from "node:child_process";
import {
  BRANCH_A,
  checkFactory,
  collectIntegrity,
  collectParity,
  completeDrill,
  finalVerdict,
  hashJson,
  integrityStatus,
  newRunId,
  parityStatus,
  recordArtifact,
  recordDrill,
  serviceClient,
  sessionClient,
  totalRestoredRows,
  totalSourceRows,
} from "./disaster-recovery-lib.mjs";

const mode = (process.env.RECOVERY_ENVIRONMENT ?? "LOCAL").toUpperCase();
const drillType = mode === "PRODUCTION" ? "REAL" : "TEST";
const strict = process.env.STRICT === "1";
const { check, failures } = checkFactory();

function productionClient(prefix) {
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const key = process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`];
  if (!url || !key) return null;
  return serviceClient(url, key);
}

function runReport(drillId) {
  return spawnSync(process.execPath, ["scripts/disaster-recovery-certification.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, RECOVERY_DRILL_ID: drillId },
    encoding: "utf8",
  });
}

async function schemaExists(client) {
  const { error } = await client.from("recovery_drills").select("id", { count: "exact", head: true });
  return !error;
}

async function main() {
  console.log(`disaster-recovery verification (run ${newRunId()})`);
  if (mode === "PRODUCTION") {
    console.log("REAL PRODUCTION RECOVERY DRILL");
    if (!strict) {
      console.error("RESULT: PRODUCTION recovery verification requires STRICT=1");
      process.exit(1);
    }
  } else {
    console.log("LOCAL TEST ONLY");
    console.log("NOT PRODUCTION CERTIFICATION");
  }

  const localService = serviceClient();
  const manager = await sessionClient("manager@ptm.test");
  const sourceClient = mode === "PRODUCTION" ? productionClient("SOURCE") : localService;
  const restoredClient = mode === "PRODUCTION" ? productionClient("RESTORED") : localService;

  if (!sourceClient || !restoredClient) {
    console.error("RESULT: PRODUCTION mode requires SOURCE_* and RESTORED_* Supabase credentials");
    process.exit(1);
  }

  check("schema exists", await schemaExists(localService), "recovery_drills table missing");

  const parity = await collectParity(sourceClient, restoredClient);
  const parityResult = parityStatus(parity);
  const integrity = await collectIntegrity(sourceClient, restoredClient, { requireSamples: mode === "PRODUCTION" });
  const integrityResult = integrityStatus(integrity);
  const verdict = finalVerdict(parityResult, integrityResult);
  const sourceRows = totalSourceRows(parity);
  const restoredRows = totalRestoredRows(parity);

  const drill = await recordDrill(manager, {
    branchId: BRANCH_A,
    environment: mode,
    drillType,
    sourceRowCount: sourceRows,
    notes: mode === "PRODUCTION" ? "V13.2 real production recovery drill" : "V13.2 LOCAL TEST ONLY - not production certification",
  });
  check("record_recovery_drill works", !drill.error && !!drill.data, drill.error?.message);
  if (drill.error || !drill.data) {
    console.error("RESULT: could not start recovery drill");
    process.exit(1);
  }

  const backupMetadata = {
    environment: mode,
    drill_type: drillType,
    backup_size_bytes: Math.max(1, JSON.stringify(parity).length),
    source_row_count: sourceRows,
    created_at: new Date().toISOString(),
    provenance: mode === "PRODUCTION" ? "REAL PRODUCTION RECOVERY DRILL" : "LOCAL TEST DATA ONLY - NOT VALID FOR LAUNCH CERTIFICATION",
  };
  const backup = await recordArtifact(manager, drill.data, {
    artifactType: "BACKUP",
    artifactName: mode === "PRODUCTION" ? "production-backup-evidence.json" : "local-test-backup-evidence.json",
    artifactChecksum: hashJson(backupMetadata),
    artifactMetadata: backupMetadata,
  });
  check("backup artifact recorded", !backup.error && !!backup.data, backup.error?.message);

  const parityMetadata = { results: parity, status: parityResult, checked_at: new Date().toISOString() };
  const parityArtifact = await recordArtifact(manager, drill.data, {
    artifactType: "PARITY",
    artifactName: "row-count-parity.json",
    artifactChecksum: hashJson(parityMetadata),
    artifactMetadata: parityMetadata,
  });
  check("parity artifact recorded", !parityArtifact.error && !!parityArtifact.data, parityArtifact.error?.message);

  const integrityMetadata = { results: integrity, status: integrityResult, checked_at: new Date().toISOString() };
  const integrityArtifact = await recordArtifact(manager, drill.data, {
    artifactType: "INTEGRITY",
    artifactName: "sample-integrity.json",
    artifactChecksum: hashJson(integrityMetadata),
    artifactMetadata: integrityMetadata,
  });
  check("integrity artifact recorded", !integrityArtifact.error && !!integrityArtifact.data, integrityArtifact.error?.message);

  check("parity logic works", parityResult === (sourceRows === restoredRows ? "PARITY_PASSED" : "PARITY_FAILED"), `status=${parityResult}`);
  check("sample integrity logic works", ["INTEGRITY_PASSED", "INTEGRITY_FAILED"].includes(integrityResult), `status=${integrityResult}`);

  const completed = await completeDrill(manager, drill.data, {
    restoredRowCount: restoredRows,
    parityStatus: parityResult,
    integrityStatus: integrityResult,
    overallVerdict: verdict,
    notes: verdict,
  });
  check("complete_recovery_drill works", !completed.error && !!completed.data, completed.error?.message);

  const direct = await manager.from("recovery_artifacts").insert({
    recovery_drill_id: drill.data,
    artifact_type: "BACKUP",
    artifact_name: "forged.sql",
    artifact_checksum: "forged",
  });
  check("direct-write bypass blocked", !!direct.error, direct.error ? "" : "INSERTED!");

  const { count } = await localService
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", BRANCH_A)
    .in("event_type", ["recovery_drill_started", "recovery_artifact_recorded", "recovery_drill_completed"]);
  check("audit emitted", (count ?? 0) >= 3, `count=${count}`);

  const report = runReport(drill.data);
  check("certification generator works", report.status === 0, report.stderr || report.stdout);

  console.log("");
  if (failures() > 0) {
    console.error(`RESULT: ${failures()} disaster-recovery check(s) FAILED`);
    process.exit(1);
  }
  console.log(`RESULT: disaster-recovery verification PASSED (${verdict})`);
}

main().catch((err) => {
  console.error("verify-disaster-recovery crashed:", err);
  process.exit(1);
});
