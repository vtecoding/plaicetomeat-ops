// V18 Phase B database guard: storage-finalisation replay, actor/source binding,
// atomic evidence/audit/review writes, fault rollback and retryable deletion.
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const branchId = "00000000-0000-4000-8000-000000000001";
const actorSql = `(SELECT id FROM public.profiles WHERE email = 'operator@ptm.test' AND is_active LIMIT 1)`;
const otherActorSql = `(SELECT id FROM public.profiles WHERE email = 'manager@ptm.test' AND is_active LIMIT 1)`;
const ids = Object.fromEntries([
  "certificate", "delivery", "failureRun", "failureRow", "auditFault", "alertFault",
  "deleteFault", "concurrent",
].map((name) => [name, randomUUID()]));
const suffix = ids.certificate.slice(0, 8).replaceAll("-", "");

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-tA"];
}

function runPsql(sql, label, expectFailure = false) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (expectFailure) {
    if ((result.status ?? 0) === 0) throw new Error(`${label} unexpectedly succeeded:\n${output}`);
    return output;
  }
  if ((result.status ?? 1) !== 0) throw new Error(`${label} failed:\n${output}`);
  return output;
}

function runPsqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output: `${stdout}${stderr}` }));
    child.stdin.end(sql);
  });
}

function finaliseCall({ id, type, file, sha, actor = actorSql }) {
  return `SELECT public.finalize_operator_evidence_upload_v18(
    '${id}', '${branchId}', ${actor}, 'operator-evidence',
    '${branchId}/operations/operator_workflow_run/${id}',
    '${file}', 'image/jpeg', 120, '${type}',
    'operator_workflow_run', '${id}', 'V18 evidence guard', '${sha}'
  );`;
}

const staticBattery = `
BEGIN;

DO $$
DECLARE
  v_result jsonb;
  v_count integer;
BEGIN
  IF has_function_privilege('authenticated',
       'public.finalize_operator_evidence_upload_v18(uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid,text,text)',
       'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.finalize_operator_evidence_upload_v18(uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid,text,text)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'upload finaliser ACL is not service-only';
  END IF;
  IF has_function_privilege('authenticated',
       'public.request_operator_evidence_delete_v18(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.request_operator_evidence_delete_v18(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'delete saga ACL is not service-only';
  END IF;

  v_result := public.finalize_operator_evidence_upload_v18(
    '${ids.certificate}', '${branchId}', ${actorSql}, 'operator-evidence',
    '${branchId}/operations/operator_workflow_run/${ids.certificate}',
    'certificate.jpg', 'image/jpeg', 120, 'certificate',
    'operator_workflow_run', '${ids.certificate}', 'Certificate', repeat('a', 64)
  );
  IF coalesce((v_result->>'created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'certificate upload was not created: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.operator_workflow_runs
    WHERE id = '${ids.certificate}' AND branch_id = '${branchId}'
      AND operator_id = ${actorSql} AND workflow = 'certificate' AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'upload did not reserve a missing best-effort draft';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
  WHERE target_id = '${ids.certificate}' AND target_type = 'operator_evidence'
    AND event_type = 'evidence_uploaded';
  IF v_count <> 1 THEN RAISE EXCEPTION 'upload audit cardinality %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.owner_alerts
  WHERE kind = 'operator_evidence_review' AND entity_ref = '${ids.certificate}'
    AND resolved_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'generic review fallback cardinality %', v_count; END IF;

  v_result := public.finalize_operator_evidence_upload_v18(
    '${ids.certificate}', '${branchId}', ${actorSql}, 'operator-evidence',
    '${branchId}/operations/operator_workflow_run/${ids.certificate}',
    'certificate.jpg', 'image/jpeg', 120, 'certificate',
    'operator_workflow_run', '${ids.certificate}', 'Certificate', repeat('a', 64)
  );
  IF coalesce((v_result->>'replayed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'exact upload replay was not recognised';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
  WHERE target_id = '${ids.certificate}' AND target_type = 'operator_evidence'
    AND event_type = 'evidence_uploaded';
  IF v_count <> 1 THEN RAISE EXCEPTION 'replay duplicated upload audit'; END IF;

  BEGIN
    PERFORM public.finalize_operator_evidence_upload_v18(
      '${ids.certificate}', '${branchId}', ${actorSql}, 'operator-evidence',
      '${branchId}/operations/operator_workflow_run/${ids.certificate}',
      'certificate.jpg', 'image/jpeg', 120, 'certificate',
      'operator_workflow_run', '${ids.certificate}', 'Certificate', repeat('b', 64)
    );
    RAISE EXCEPTION 'changed bytes were accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  BEGIN
    PERFORM public.finalize_operator_evidence_upload_v18(
      '${ids.certificate}', '${branchId}', ${otherActorSql}, 'operator-evidence',
      '${branchId}/operations/operator_workflow_run/${ids.certificate}',
      'certificate.jpg', 'image/jpeg', 120, 'certificate',
      'operator_workflow_run', '${ids.certificate}', 'Certificate', repeat('a', 64)
    );
    RAISE EXCEPTION 'same-branch operator hijack was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM public.request_operator_evidence_delete_v18(
      '${ids.certificate}', '${branchId}', ${actorSql}
    );
    RAISE EXCEPTION 'compliance evidence deletion was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  v_result := public.record_operator_evidence_failure_v18(
    '${ids.failureRow}', '${branchId}', ${actorSql}, 'waste.bmp', 'image/bmp', 50,
    'waste_photo', 'operator_workflow_run', '${ids.failureRun}', 'Waste',
    'unsupported_file_type'
  );
  IF coalesce((v_result->>'created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'failed upload row was not created';
  END IF;
  PERFORM public.record_operator_evidence_failure_v18(
    '${ids.failureRow}', '${branchId}', ${actorSql}, 'waste.bmp', 'image/bmp', 50,
    'waste_photo', 'operator_workflow_run', '${ids.failureRun}', 'Waste',
    'unsupported_file_type'
  );
  SELECT count(*) INTO v_count FROM public.audit_logs
  WHERE target_id = '${ids.failureRow}' AND event_type = 'evidence_upload_failed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'failed upload audit cardinality %', v_count; END IF;
END
$$;

CREATE FUNCTION public.fail_atomic_evidence_audit_${suffix}()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.target_id = '${ids.auditFault}' AND NEW.event_type = 'evidence_uploaded' THEN
    RAISE EXCEPTION 'injected evidence audit failure';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER fail_atomic_evidence_audit_${suffix}
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.fail_atomic_evidence_audit_${suffix}();

DO $$
BEGIN
  BEGIN
    ${finaliseCall({ id: ids.auditFault, type: "delivery_note", file: "audit-fault.jpg", sha: "c".repeat(64) }).replace("SELECT ", "PERFORM ")}
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%injected evidence audit failure%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.operator_evidence WHERE id = '${ids.auditFault}')
     OR EXISTS (SELECT 1 FROM public.operator_workflow_runs WHERE id = '${ids.auditFault}') THEN
    RAISE EXCEPTION 'audit fault left partial evidence or draft';
  END IF;
END
$$;
DROP TRIGGER fail_atomic_evidence_audit_${suffix} ON public.audit_logs;
DROP FUNCTION public.fail_atomic_evidence_audit_${suffix}();

DO $$
BEGIN
  ${finaliseCall({ id: ids.auditFault, type: "delivery_note", file: "audit-fault.jpg", sha: "c".repeat(64) }).replace("SELECT ", "PERFORM ")}
  IF (SELECT count(*) FROM public.audit_logs
      WHERE target_id = '${ids.auditFault}' AND event_type = 'evidence_uploaded') <> 1 THEN
    RAISE EXCEPTION 'retry after audit fault did not converge';
  END IF;
END
$$;

CREATE FUNCTION public.fail_atomic_evidence_alert_${suffix}()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.kind = 'operator_evidence_review' AND NEW.entity_ref = '${ids.alertFault}' THEN
    RAISE EXCEPTION 'injected evidence alert failure';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER fail_atomic_evidence_alert_${suffix}
BEFORE INSERT ON public.owner_alerts
FOR EACH ROW EXECUTE FUNCTION public.fail_atomic_evidence_alert_${suffix}();

DO $$
BEGIN
  BEGIN
    ${finaliseCall({ id: ids.alertFault, type: "other", file: "alert-fault.jpg", sha: "d".repeat(64) }).replace("SELECT ", "PERFORM ")}
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%injected evidence alert failure%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.operator_evidence WHERE id = '${ids.alertFault}')
     OR EXISTS (SELECT 1 FROM public.audit_logs WHERE target_id = '${ids.alertFault}')
     OR EXISTS (SELECT 1 FROM public.operator_workflow_runs WHERE id = '${ids.alertFault}') THEN
    RAISE EXCEPTION 'review-alert fault left partial state';
  END IF;
END
$$;
DROP TRIGGER fail_atomic_evidence_alert_${suffix} ON public.owner_alerts;
DROP FUNCTION public.fail_atomic_evidence_alert_${suffix}();

DO $$
BEGIN
  ${finaliseCall({ id: ids.alertFault, type: "other", file: "alert-fault.jpg", sha: "d".repeat(64) }).replace("SELECT ", "PERFORM ")}
  IF (SELECT count(*) FROM public.owner_alerts
      WHERE kind = 'operator_evidence_review' AND entity_ref = '${ids.alertFault}') <> 1 THEN
    RAISE EXCEPTION 'retry after review-alert fault did not converge';
  END IF;
END
$$;

DO $$
BEGIN
  ${finaliseCall({ id: ids.deleteFault, type: "delivery_note", file: "delete-fault.jpg", sha: "e".repeat(64) }).replace("SELECT ", "PERFORM ")}
  PERFORM public.request_operator_evidence_delete_v18(
    '${ids.deleteFault}', '${branchId}', ${actorSql}
  );
END
$$;
CREATE FUNCTION public.fail_atomic_evidence_delete_${suffix}()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.id = '${ids.deleteFault}' AND NEW.status = 'deleted' THEN
    RAISE EXCEPTION 'injected evidence delete finalise failure';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER fail_atomic_evidence_delete_${suffix}
BEFORE UPDATE ON public.operator_evidence
FOR EACH ROW EXECUTE FUNCTION public.fail_atomic_evidence_delete_${suffix}();

DO $$
BEGIN
  BEGIN
    PERFORM public.finalize_operator_evidence_delete_v18(
      '${ids.deleteFault}', '${branchId}', ${actorSql}
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%injected evidence delete finalise failure%' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.operator_evidence WHERE id = '${ids.deleteFault}') <> 'delete_pending'
     OR (SELECT count(*) FROM public.audit_logs
         WHERE target_id = '${ids.deleteFault}' AND event_type = 'evidence_deleted'
           AND metadata->>'transition' = 'finalized') <> 0 THEN
    RAISE EXCEPTION 'delete finalise fault falsely claimed deleted proof';
  END IF;
END
$$;
DROP TRIGGER fail_atomic_evidence_delete_${suffix} ON public.operator_evidence;
DROP FUNCTION public.fail_atomic_evidence_delete_${suffix}();

DO $$
BEGIN
  PERFORM public.finalize_operator_evidence_delete_v18(
    '${ids.deleteFault}', '${branchId}', ${actorSql}
  );
  IF (SELECT status FROM public.operator_evidence WHERE id = '${ids.deleteFault}') <> 'deleted'
     OR (SELECT count(*) FROM public.audit_logs
         WHERE target_id = '${ids.deleteFault}' AND event_type = 'evidence_deleted') <> 2 THEN
    RAISE EXCEPTION 'delete retry did not converge with request+final audit';
  END IF;
END
$$;

ROLLBACK;
`;

runPsql(staticBattery, "atomic evidence transactional battery");

// Two independent sessions prove that the evidence/run locks converge an exact
// simultaneous retry to one row and one audit fact.
const concurrentSql = finaliseCall({
  id: ids.concurrent,
  type: "delivery_note",
  file: "concurrent.jpg",
  sha: "f".repeat(64),
  actor: otherActorSql,
});
const raced = await Promise.all([runPsqlAsync(concurrentSql), runPsqlAsync(concurrentSql)]);
for (const [index, result] of raced.entries()) {
  if ((result.status ?? 1) !== 0) throw new Error(`concurrent evidence caller ${index + 1} failed:\n${result.output}`);
}
const createdCount = raced.filter((result) => /"created"\s*:\s*true/i.test(result.output)).length;
const replayedCount = raced.filter((result) => /"replayed"\s*:\s*true/i.test(result.output)).length;
if (createdCount !== 1 || replayedCount !== 1) {
  throw new Error(`concurrent replay did not produce one create + one replay:\n${raced.map((item) => item.output).join("\n")}`);
}

const cardinality = runPsql(`
SELECT
  (SELECT count(*) FROM public.operator_evidence WHERE id = '${ids.concurrent}') || ':' ||
  (SELECT count(*) FROM public.audit_logs
   WHERE target_id = '${ids.concurrent}' AND target_type = 'operator_evidence'
     AND event_type = 'evidence_uploaded');
`, "concurrent evidence cardinality").trim();
if (cardinality !== "1:1") throw new Error(`concurrent evidence cardinality was ${cardinality}`);

const changed = runPsql(finaliseCall({
  id: ids.concurrent,
  type: "delivery_note",
  file: "concurrent.jpg",
  sha: "0".repeat(64),
  actor: otherActorSql,
}), "changed concurrent evidence", true);
if (!/different upload|23505|duplicate/i.test(changed)) {
  throw new Error(`changed concurrent evidence returned the wrong refusal:\n${changed}`);
}

runPsql(`
SELECT public.request_operator_evidence_delete_v18(
  '${ids.concurrent}', '${branchId}', ${otherActorSql}
);
SELECT public.finalize_operator_evidence_delete_v18(
  '${ids.concurrent}', '${branchId}', ${otherActorSql}
);
UPDATE public.operator_workflow_runs
SET status = 'abandoned', updated_at = now()
WHERE id = '${ids.concurrent}' AND status = 'in_progress';
`, "concurrent evidence cleanup");

console.log("Atomic evidence verification passed (service ACL, 22 transactional/replay/fault/actor checks, concurrent convergence). ");
