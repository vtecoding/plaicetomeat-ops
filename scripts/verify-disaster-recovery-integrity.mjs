// Adversarial verification - V13.2 Disaster Recovery Certification.
//
// Proves the recovery evidence chain is manager-gated, provenance-sealed,
// direct-write resistant, fail-closed on parity/integrity claims, and audited.

import {
  BRANCH_A,
  BRANCH_B,
  anonClient,
  checkFactory,
  completeDrill,
  hashJson,
  newRunId,
  recordArtifact,
  recordDrill,
  serviceClient,
  sessionClient,
} from "./disaster-recovery-lib.mjs";

const service = serviceClient();
const anon = anonClient();
const { check, failures } = checkFactory();

async function reset() {
  const { data } = await service
    .from("recovery_drills")
    .select("id")
    .or("notes.ilike.V13.2 integrity%,notes.ilike.V13.2 mismatch%,notes.ilike.V13.2 happy%");
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length > 0) {
    await service.from("recovery_artifacts").delete().in("recovery_drill_id", ids);
    await service.from("recovery_drills").delete().in("id", ids);
  }
}

async function backupArtifact(manager, drillId, name = "local-test-backup.sql") {
  const metadata = { backup_size_bytes: 128, created_at: new Date().toISOString() };
  return recordArtifact(manager, drillId, {
    artifactType: "BACKUP",
    artifactName: name,
    artifactChecksum: hashJson(metadata),
    artifactMetadata: metadata,
  });
}

async function main() {
  console.log(`disaster-recovery-integrity adversarial checks (run ${newRunId()})`);
  console.log("LOCAL TEST ONLY");
  console.log("NOT PRODUCTION CERTIFICATION");

  const manager = await sessionClient("manager@ptm.test");
  const staff = await sessionClient("staff@ptm.test");
  await reset();

  {
    const r = await recordDrill(anon, { sourceRowCount: 1, notes: "V13.2 integrity anon" });
    check("anon record_recovery_drill DENIED", !!r.error, r.error ? "" : "CALLABLE!");
  }

  {
    const r = await recordDrill(staff, { sourceRowCount: 1, notes: "V13.2 integrity staff" });
    check("staff record_recovery_drill DENIED", !!r.error && /Not authorised/i.test(r.error.message), r.error?.message ?? "ALLOWED");
  }

  let drillId = null;
  {
    const r = await recordDrill(manager, { sourceRowCount: 10, notes: "V13.2 happy path" });
    drillId = r.data;
    check("manager can start LOCAL TEST drill", !r.error && !!drillId, r.error?.message);
  }

  {
    const r = await recordDrill(manager, { environment: "LOCAL", drillType: "REAL", sourceRowCount: 1, notes: "V13.2 integrity local real" });
    check("LOCAL drill cannot claim REAL", !!r.error && /LOCAL recovery drills are TEST/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  {
    const r = await recordDrill(manager, { environment: "PRODUCTION", drillType: "TEST", sourceRowCount: 1, notes: "V13.2 integrity prod test" });
    check("TEST drill cannot claim PRODUCTION", !!r.error && /PRODUCTION recovery drills must be REAL/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  {
    const r = await recordDrill(manager, { branchId: BRANCH_B, sourceRowCount: 1, notes: "V13.2 integrity cross branch" });
    check("manager cannot start drill for unmanaged branch", !!r.error && /Not authorised/i.test(r.error.message), r.error?.message ?? "ALLOWED");
  }

  {
    const r = await manager.from("recovery_drills").insert({
      branch_id: BRANCH_A,
      environment: "LOCAL",
      drill_type: "TEST",
      backup_created_at: new Date().toISOString(),
      source_row_count: 1,
    });
    check("direct recovery_drills INSERT DENIED", !!r.error, r.error ? "" : "INSERTED!");
  }

  {
    const r = await recordArtifact(manager, drillId, {
      artifactType: "BACKUP",
      artifactName: "fake-backup.sql",
      artifactChecksum: "",
      artifactMetadata: { backup_size_bytes: 100 },
    });
    check("fake artifact without checksum DENIED", !!r.error && /checksum/i.test(r.error.message), r.error?.message ?? "ACCEPTED");
  }

  {
    const r = await recordArtifact(staff, drillId, {
      artifactType: "BACKUP",
      artifactName: "staff-backup.sql",
      artifactChecksum: "abc",
      artifactMetadata: { backup_size_bytes: 100 },
    });
    check("staff artifact write DENIED", !!r.error && /Not authorised/i.test(r.error.message), r.error?.message ?? "ALLOWED");
  }

  {
    const r = await completeDrill(manager, drillId, {
      restoredRowCount: 10,
      parityStatus: "PARITY_PASSED",
      integrityStatus: "INTEGRITY_PASSED",
      overallVerdict: "RECOVERY_CERTIFIED",
    });
    check("fake completion without backup evidence DENIED", !!r.error && /without backup evidence/i.test(r.error.message), r.error?.message ?? "COMPLETED");
  }

  await backupArtifact(manager, drillId);

  {
    const r = await completeDrill(manager, drillId, {
      restoredRowCount: 9,
      parityStatus: "PARITY_PASSED",
      integrityStatus: "INTEGRITY_PASSED",
      overallVerdict: "RECOVERY_CERTIFIED",
    });
    check("fake parity pass with mismatch DENIED", !!r.error && /row-count mismatch/i.test(r.error.message), r.error?.message ?? "CERTIFIED");
  }

  let mismatchDrill = null;
  {
    const r = await recordDrill(manager, { sourceRowCount: 10, notes: "V13.2 mismatch parity" });
    mismatchDrill = r.data;
    await backupArtifact(manager, mismatchDrill, "mismatch-backup.sql");
    const complete = await completeDrill(manager, mismatchDrill, {
      restoredRowCount: 9,
      parityStatus: "PARITY_FAILED",
      integrityStatus: "INTEGRITY_PASSED",
      overallVerdict: "RECOVERY_FAILED",
      notes: "V13.2 mismatch parity completed",
    });
    check("parity mismatch records RECOVERY_FAILED", !complete.error && !!complete.data, complete.error?.message);
  }

  {
    const r = await recordDrill(manager, { sourceRowCount: 10, notes: "V13.2 mismatch integrity" });
    const integrityDrill = r.data;
    await backupArtifact(manager, integrityDrill, "integrity-backup.sql");
    const complete = await completeDrill(manager, integrityDrill, {
      restoredRowCount: 10,
      parityStatus: "PARITY_PASSED",
      integrityStatus: "INTEGRITY_FAILED",
      overallVerdict: "RECOVERY_FAILED",
      notes: "V13.2 mismatch integrity completed",
    });
    check("sample integrity mismatch records RECOVERY_FAILED", !complete.error && !!complete.data, complete.error?.message);
  }

  {
    const complete = await completeDrill(manager, drillId, {
      restoredRowCount: 10,
      parityStatus: "PARITY_PASSED",
      integrityStatus: "INTEGRITY_PASSED",
      overallVerdict: "RECOVERY_CERTIFIED",
      notes: "V13.2 happy completed",
    });
    check("manager can complete certified drill when checks pass", !complete.error && !!complete.data, complete.error?.message);
  }

  {
    const { count } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", BRANCH_A)
      .in("event_type", ["recovery_drill_started", "recovery_artifact_recorded", "recovery_drill_completed"]);
    check("recovery audit rows emitted", (count ?? 0) >= 3, `count=${count}`);
  }

  console.log("");
  if (failures() > 0) {
    console.error(`RESULT: ${failures()} disaster-recovery-integrity check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: all disaster-recovery-integrity checks PASSED");
}

main().catch((err) => {
  console.error("verify-disaster-recovery-integrity crashed:", err);
  process.exit(1);
});
