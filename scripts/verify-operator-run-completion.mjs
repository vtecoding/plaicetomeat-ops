import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const branchId = "00000000-0000-4000-8000-000000000001";
const foreignBranchId = "00000000-0000-4000-8000-0000000000b2";
const operatorClaim = `(SELECT id::text FROM public.profiles WHERE email = 'operator@ptm.test' AND is_active LIMIT 1)`;
const names = [
  "product",
  "supplier",
  "wasteBatch",
  "legacyDeliveryBatch",
  "foreignDeliveryBatch",
  "corruptDeliveryBatch",
  "deliveryRun",
  "deliveryEvidence",
  "missingDeliveryRun",
  "missingEvidence",
  "crossDeliveryRun",
  "crossEvidence",
  "deletedDeliveryRun",
  "deletedEvidence",
  "wrongUploaderRun",
  "wrongUploaderEvidence",
  "wrongTypeRun",
  "wrongTypeEvidence",
  "wrongSourceRun",
  "wrongSourceEvidence",
  "blankPathRun",
  "blankPathEvidence",
  "failedEvidenceRun",
  "failedEvidence",
  "nullUploaderRun",
  "nullUploaderEvidence",
  "nullSourceRun",
  "nullSourceEvidence",
  "nullCertificateUploaderRun",
  "nullCertificateUploaderEvidence",
  "nullCertificateSourceRun",
  "nullCertificateSourceEvidence",
  "unknownDeliveryRun",
  "deliveryFaultRun",
  "abandonedDeliveryRun",
  "legacyDeliveryRun",
  "legacyDeliveryMissingRun",
  "legacyDeliveryForeignRun",
  "legacyDeliveryCorruptRun",
  "legacyOwnerRun",
  "legacyOwnerAlert",
  "legacyOwnerForeignRun",
  "legacyOwnerForeignAlert",
  "partialDeliveryRun",
  "partialDeliveryEvidence",
  "scalarDeliveryRun",
  "wasteRun",
  "wasteEvidence",
  "wasteConflictRun",
  "wasteFaultRun",
  "noWasteRun",
  "legacyWasteRun",
  "legacyWasteMissingRun",
  "legacyWasteMissingTarget",
  "legacyWasteForeignRun",
  "legacyWasteCorruptRun",
  "legacyReviewWasteRun",
  "partialWasteRun",
  "ambiguousWasteRun",
  "scalarWasteRun",
  "partialWasteEvidence",
  "foreignWasteBatch",
  "foreignWasteEvent",
  "legacyNoWasteRun",
  "abandonedWasteRun",
  "foreignRun",
];
const ids = Object.fromEntries(names.map((name) => [name, randomUUID()]));
const runNames = names.filter((name) => name.endsWith("Run"));
const evidenceNames = names.filter((name) => name.endsWith("Evidence"));
const suffix = ids.product.slice(0, 8);
const faultFunction = `fail_v18_operator_completion_${suffix}`;
const faultTrigger = `fail_v18_operator_completion_${suffix}`;

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-tA"];
}

function runPsql(sql, label) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
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
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function assert(condition, message, details = "") {
  if (!condition) throw new Error(`${message}${details ? `\n${details}` : ""}`);
}

function lastUuid(output, label) {
  const matches = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) ?? [];
  assert(matches.length > 0, `${label} did not return a UUID`, output);
  return matches.at(-1);
}

function expectPsqlFailure(sql, pattern, label) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert((result.status ?? 0) !== 0, `${label} unexpectedly succeeded`, output);
  assert(pattern.test(output), `${label} returned the wrong refusal`, output);
}

function claimed(sql) {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, true);
SET LOCAL ROLE authenticated;
${sql}
COMMIT;
`;
}

function deliveryCall({ runId, evidenceId = null, productId = ids.product, quantity = 1, quantitySql = null }) {
  const steps = JSON.stringify({
    productId,
    supplierId: ids.supplier,
    quantity,
    expiryChoice: "tomorrow",
    storageChoice: "fridge",
    noteEvidenceId: evidenceId,
  });
  return `SELECT public.record_operator_delivery_v18(
    '${runId}', '${branchId}', ${productId ? `'${productId}'::uuid` : "NULL::uuid"},
    '${ids.supplier}', ${quantitySql ?? quantity}, 'tomorrow', 'fridge',
    ${evidenceId ? `'${evidenceId}'::uuid` : "NULL::uuid"},
    $steps$${steps}$steps$::jsonb
  );`;
}

function wasteCall({ runId, quantity, quantitySql = null, reason = "expired", evidenceId = null }) {
  const steps = JSON.stringify({
    productId: ids.product,
    quantity,
    reason,
    photoEvidenceId: evidenceId,
  });
  return `SELECT public.record_operator_waste_v18(
    '${runId}', '${branchId}', '${ids.product}', ${quantitySql ?? quantity}, '${reason}',
    ${evidenceId ? `'${evidenceId}'::uuid` : "NULL::uuid"},
    $steps$${steps}$steps$::jsonb
  );`;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForSleepingSession(applicationName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = runPsql(
      `SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = '${applicationName}' AND wait_event = 'PgSleep'
      );`,
      `wait for ${applicationName}`,
    ).trim();
    if (ready === "t") return;
    await sleep(50);
  }
  throw new Error(`${applicationName} never reached the post-completion readiness barrier`);
}
let primaryError = null;

try {
  runPsql(
    `
DO $$
BEGIN
  IF ${operatorClaim} IS NULL THEN
    RAISE EXCEPTION 'Seeded operator@ptm.test is required; run pnpm seed:dev first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = '${foreignBranchId}') THEN
    RAISE EXCEPTION 'Seeded second branch is required; run pnpm seed:dev first.';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.record_operator_waste_v18(uuid,uuid,uuid,numeric,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.record_operator_delivery_v18(uuid,uuid,uuid,uuid,numeric,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.link_operator_evidence_v18(uuid,uuid,uuid,text,uuid,text,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.complete_operator_owner_check_v18(uuid,uuid,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.complete_operator_no_waste_v18(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.complete_operator_certificate_v18(uuid,uuid,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'intended authenticated completion RPC grant is missing';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.record_operator_waste_v18(uuid,uuid,uuid,numeric,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.record_operator_delivery_v18(uuid,uuid,uuid,uuid,numeric,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.link_operator_evidence_v18(uuid,uuid,uuid,text,uuid,text,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.complete_operator_owner_check_v18(uuid,uuid,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.complete_operator_no_waste_v18(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.complete_operator_certificate_v18(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.prepare_operator_run_v18(uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.finalize_operator_run_v18(uuid,uuid,text,text,jsonb,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.ensure_operator_completion_audit_v18(uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.ensure_operator_run_alert_v18(uuid,uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.enforce_operator_run_terminal_v18()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'operator completion privilege surface is too broad';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN (
      'public.record_operator_waste_v18(uuid,uuid,uuid,numeric,text,uuid,jsonb)'::regprocedure,
      'public.record_operator_delivery_v18(uuid,uuid,uuid,uuid,numeric,text,text,uuid,jsonb)'::regprocedure,
      'public.link_operator_evidence_v18(uuid,uuid,uuid,text,uuid,text,boolean)'::regprocedure,
      'public.complete_operator_owner_check_v18(uuid,uuid,text,text,text,jsonb)'::regprocedure,
      'public.complete_operator_no_waste_v18(uuid,uuid)'::regprocedure,
      'public.complete_operator_certificate_v18(uuid,uuid,uuid,text)'::regprocedure,
      'public.prepare_operator_run_v18(uuid,uuid,text,text)'::regprocedure,
      'public.finalize_operator_run_v18(uuid,uuid,text,text,jsonb,text,jsonb)'::regprocedure,
      'public.ensure_operator_completion_audit_v18(uuid,uuid,text,text)'::regprocedure,
      'public.ensure_operator_run_alert_v18(uuid,uuid,text,text,jsonb)'::regprocedure,
      'public.enforce_operator_run_terminal_v18()'::regprocedure
    )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute an operator completion function';
  END IF;
END;
$$;

INSERT INTO public.products(
  id, branch_id, name, slug, unit_type, inventory_policy,
  price_per_unit, is_available, stock_status
) VALUES (
  '${ids.product}', '${branchId}', 'Run completion ${suffix}', 'run-completion-${suffix}',
  'kg', 'kg_batch', 9.5, true, 'in_stock'
);

INSERT INTO public.suppliers(id, branch_id, name, active)
VALUES ('${ids.supplier}', '${branchId}', 'Run supplier ${suffix}', true);

INSERT INTO public.inventory_batches(
  id, product_id, supplier_id, branch_id, received_date, expiry_date,
  received_weight_kg, remaining_weight_kg, invoice_cost, cost_per_kg, status,
  storage_location, intake_idempotency_key, created_by
) VALUES
  (
    '${ids.wasteBatch}', '${ids.product}', '${ids.supplier}', '${branchId}',
    current_date, current_date, 20, 20, 80, 4, 'active',
    'Fridge', NULL, (${operatorClaim})::uuid
  ),
  (
    '${ids.legacyDeliveryBatch}', '${ids.product}', '${ids.supplier}', '${branchId}',
    current_date, current_date + 1, 1, 1, 0, 0, 'active', 'Fridge',
    'operator-delivery:${ids.legacyDeliveryRun}:${ids.product}:1:' || (current_date + 1)::text,
    (${operatorClaim})::uuid
  ),
  (
    '${ids.foreignDeliveryBatch}', '${ids.product}', '${ids.supplier}', '${foreignBranchId}',
    current_date, current_date + 1, 1, 1, 0, 0, 'active', 'Fridge',
    'operator-delivery:${ids.legacyDeliveryForeignRun}:${ids.product}:1:' || (current_date + 1)::text,
    (${operatorClaim})::uuid
  ),
  (
    '${ids.corruptDeliveryBatch}', '${ids.product}', '${ids.supplier}', '${branchId}',
    current_date, current_date + 1, 2, 2, 0, 0, 'active', 'Fridge',
    'operator-delivery:${ids.legacyDeliveryCorruptRun}:${ids.product}:2:' || (current_date + 1)::text,
    (${operatorClaim})::uuid
  ),
  (
    '${ids.partialDeliveryRun}', '${ids.product}', '${ids.supplier}', '${branchId}',
    current_date, current_date + 1, 1, 1, 0, 0, 'active', 'Fridge',
    'operator-delivery:${ids.partialDeliveryRun}:${ids.product}:1:' || (current_date + 1)::text,
    (${operatorClaim})::uuid
  ),
  (
    '${ids.foreignWasteBatch}', '${ids.product}', '${ids.supplier}', '${foreignBranchId}',
    current_date, current_date + 30, 2, 1.5, 8, 4, 'active',
    'Fridge', NULL, (${operatorClaim})::uuid
  );

INSERT INTO public.inventory_waste_events(
  id, batch_id, product_id, waste_kg, reason, created_by
) VALUES (
  '${ids.foreignWasteEvent}', '${ids.foreignWasteBatch}', '${ids.product}',
  0.5, 'expired', (${operatorClaim})::uuid
);

INSERT INTO public.owner_alerts(
  id, branch_id, severity, kind, summary, entity_ref, created_by
) VALUES
  (
    '${ids.legacyOwnerAlert}', '${branchId}', 'warning', 'operator_stock_help_needed',
    'Operator was not sure what happened with stock.', '${ids.legacyOwnerRun}',
    (${operatorClaim})::uuid
  ),
  (
    '${ids.legacyOwnerForeignAlert}', '${foreignBranchId}', 'warning', 'operator_stock_help_needed',
    'Operator was not sure what happened with stock.', '${ids.legacyOwnerForeignRun}',
    (${operatorClaim})::uuid
  );

INSERT INTO public.operator_workflow_runs(
  id, branch_id, operator_id, workflow, status, steps, result_ref, updated_at
)
VALUES
  ('${ids.deliveryFaultRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'in_progress', '{}'::jsonb, NULL, now()),
  ('${ids.abandonedDeliveryRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'abandoned', '{}'::jsonb, NULL, now()),
  (
    '${ids.legacyDeliveryRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'supplierId', '${ids.supplier}', 'quantity', 1,
      'expiryChoice', 'tomorrow', 'storageChoice', 'fridge', 'noteEvidenceId', NULL,
      'productName', 'Run completion ${suffix}', 'supplierName', 'Run supplier ${suffix}',
      'batchId', '${ids.legacyDeliveryBatch}'
    ),
    'inventory_batch:${ids.legacyDeliveryBatch}', now()
  ),
  (
    '${ids.legacyDeliveryMissingRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'supplierId', '${ids.supplier}', 'quantity', 1,
      'expiryChoice', 'tomorrow', 'storageChoice', 'fridge', 'noteEvidenceId', NULL,
      'batchId', '${ids.missingEvidence}'
    ), 'inventory_batch:${ids.missingEvidence}', now()
  ),
  (
    '${ids.legacyDeliveryForeignRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'supplierId', '${ids.supplier}', 'quantity', 1,
      'expiryChoice', 'tomorrow', 'storageChoice', 'fridge', 'noteEvidenceId', NULL,
      'batchId', '${ids.foreignDeliveryBatch}'
    ), 'inventory_batch:${ids.foreignDeliveryBatch}', now()
  ),
  (
    '${ids.legacyDeliveryCorruptRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'supplierId', '${ids.supplier}', 'quantity', 1,
      'expiryChoice', 'tomorrow', 'storageChoice', 'fridge', 'noteEvidenceId', NULL,
      'batchId', '${ids.corruptDeliveryBatch}'
    ), 'inventory_batch:${ids.corruptDeliveryBatch}', now()
  ),
  (
    '${ids.partialDeliveryRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'in_progress',
    jsonb_build_object(
      '_completionCutover', 'pre_202607142300',
      'productId', '${ids.product}', 'supplierId', '${ids.supplier}', 'quantity', 1,
      'expiryChoice', 'tomorrow', 'storageChoice', 'fridge',
      'noteEvidenceId', '${ids.partialDeliveryEvidence}'
    ), NULL, now()
  ),
  (
    '${ids.legacyOwnerRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'completed',
    jsonb_build_object('askedForHelp', true, 'ownerAlertId', '${ids.legacyOwnerAlert}'),
    'owner_alert:${ids.legacyOwnerAlert}', now()
  ),
  (
    '${ids.legacyOwnerForeignRun}', '${branchId}', (${operatorClaim})::uuid, 'delivery', 'completed',
    jsonb_build_object('askedForHelp', true, 'ownerAlertId', '${ids.legacyOwnerForeignAlert}'),
    'owner_alert:${ids.legacyOwnerForeignAlert}', now()
  ),
  ('${ids.wasteFaultRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'in_progress', '{}'::jsonb, NULL, now()),
  ('${ids.abandonedWasteRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'abandoned', '{}'::jsonb, NULL, now()),
  (
    '${ids.legacyWasteMissingRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'quantity', 0.5, 'reason', 'expired',
      'photoEvidenceId', NULL, 'batchId', '${ids.wasteBatch}',
      'wasteId', '${ids.legacyWasteMissingTarget}'
    ), 'waste:${ids.legacyWasteMissingTarget}', now()
  ),
  (
    '${ids.legacyWasteForeignRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'quantity', 0.5, 'reason', 'expired',
      'photoEvidenceId', NULL, 'batchId', '${ids.foreignWasteBatch}',
      'wasteId', '${ids.foreignWasteEvent}'
    ), 'waste:${ids.foreignWasteEvent}', now()
  ),
  (
    '${ids.legacyWasteCorruptRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'completed',
    jsonb_build_object(
      'productId', '${ids.product}', 'quantity', 0.5, 'reason', 'expired',
      'photoEvidenceId', NULL, 'batchId', '${ids.wasteBatch}',
      'wasteId', '${ids.legacyWasteMissingTarget}'
    ), 'waste:${ids.foreignWasteEvent}', now()
  ),
  (
    '${ids.partialWasteRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'in_progress',
    jsonb_build_object(
      '_completionCutover', 'pre_202607142300',
      'productId', '${ids.product}', 'quantity', 0.4, 'reason', 'expired',
      'photoEvidenceId', '${ids.partialWasteEvidence}'
    ), NULL, now()
  ),
  (
    '${ids.ambiguousWasteRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'in_progress',
    jsonb_build_object(
      '_completionCutover', 'pre_202607142300',
      'productId', '${ids.product}', 'quantity', 0.4, 'reason', 'expired',
      'photoEvidenceId', NULL
    ), NULL, now()
  ),
  (
    '${ids.legacyNoWasteRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'completed',
    jsonb_build_object('waste', 'none'), 'no_waste', now()
  );

INSERT INTO public.operator_evidence(
  id, branch_id, bucket, object_path, file_name, content_type, size_bytes,
  evidence_type, source_type, source_id, source_ref, status, review_required, uploaded_by
) VALUES
  (
    '${ids.deliveryEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.deliveryEvidence}.jpg',
    'delivery.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.deliveryRun}', 'Delivery note', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.crossEvidence}', '${foreignBranchId}', 'operator-evidence', '${foreignBranchId}/test/${ids.crossEvidence}.jpg',
    'cross.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.crossDeliveryRun}', 'Cross-branch note', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.deletedEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.deletedEvidence}.jpg',
    'deleted.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.deletedDeliveryRun}', 'Deleted note', 'deleted', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.wrongUploaderEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.wrongUploaderEvidence}.jpg',
    'wrong-uploader.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.wrongUploaderRun}', 'Wrong uploader', 'uploaded', false,
    (SELECT id FROM public.profiles WHERE id <> (${operatorClaim})::uuid ORDER BY id LIMIT 1)
  ),
  (
    '${ids.wrongTypeEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.wrongTypeEvidence}.jpg',
    'wrong-type.jpg', 'image/jpeg', 100, 'waste_photo', 'operator_workflow_run',
    '${ids.wrongTypeRun}', 'Wrong type', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.wrongSourceEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.wrongSourceEvidence}.jpg',
    'wrong-source.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.missingEvidence}', 'Wrong source run', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.blankPathEvidence}', '${branchId}', 'operator-evidence', NULL,
    'blank-path.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.blankPathRun}', 'Blank path', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.failedEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.failedEvidence}.jpg',
    'failed.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.failedEvidenceRun}', 'Failed upload', 'failed', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.nullUploaderEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.nullUploaderEvidence}.jpg',
    'null-uploader.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    '${ids.nullUploaderRun}', 'Null uploader', 'uploaded', false, NULL
  ),
  (
    '${ids.nullSourceEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.nullSourceEvidence}.jpg',
    'null-source.jpg', 'image/jpeg', 100, 'delivery_note', 'operator_workflow_run',
    NULL, 'Null source', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.nullCertificateUploaderEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.nullCertificateUploaderEvidence}.jpg',
    'null-certificate-uploader.jpg', 'image/jpeg', 100, 'certificate', 'operator_workflow_run',
    '${ids.nullCertificateUploaderRun}', 'Null certificate uploader', 'uploaded', false, NULL
  ),
  (
    '${ids.nullCertificateSourceEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.nullCertificateSourceEvidence}.jpg',
    'null-certificate-source.jpg', 'image/jpeg', 100, 'certificate', 'operator_workflow_run',
    NULL, 'Null certificate source', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.partialWasteEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.partialWasteEvidence}.jpg',
    'partial-waste.jpg', 'image/jpeg', 100, 'waste_photo', 'operator_workflow_run',
    '${ids.partialWasteRun}', 'Partial waste', 'uploaded', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.partialDeliveryEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.partialDeliveryEvidence}.jpg',
    'partial-delivery.jpg', 'image/jpeg', 100, 'delivery_note', 'inventory_batch',
    '${ids.partialDeliveryRun}', 'Run completion ${suffix}', 'linked', false, (${operatorClaim})::uuid
  ),
  (
    '${ids.wasteEvidence}', '${branchId}', 'operator-evidence', '${branchId}/test/${ids.wasteEvidence}.jpg',
    'waste.jpg', 'image/jpeg', 100, 'waste_photo', 'operator_workflow_run',
    '${ids.wasteRun}', 'Waste photo', 'uploaded', false, (${operatorClaim})::uuid
  );

CREATE OR REPLACE FUNCTION public.${faultFunction}()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'injected operator completion failure';
END;
$$;
CREATE TRIGGER ${faultTrigger}
BEFORE UPDATE ON public.operator_workflow_runs
FOR EACH ROW
WHEN (
  NEW.status = 'completed'
  AND NEW.id IN ('${ids.deliveryFaultRun}'::uuid, '${ids.wasteFaultRun}'::uuid)
)
EXECUTE FUNCTION public.${faultFunction}();
`,
    "operator completion fixture setup",
  );

  const deliveryWinner = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, true);
SET LOCAL ROLE authenticated;
SET LOCAL application_name = 'verify-v18-delivery-${suffix}';
${deliveryCall({ runId: ids.deliveryRun, evidenceId: ids.deliveryEvidence })}
SELECT pg_sleep(3);
COMMIT;
`);
  await waitForSleepingSession(`verify-v18-delivery-${suffix}`);
  const deliveryReplay = runPsqlAsync(claimed(deliveryCall({ runId: ids.deliveryRun, evidenceId: ids.deliveryEvidence })));
  const [deliveryFirst, deliverySecond] = await Promise.all([deliveryWinner, deliveryReplay]);
  assert(deliveryFirst.status === 0, "first delivery connection failed", `${deliveryFirst.stdout}${deliveryFirst.stderr}`);
  assert(deliverySecond.status === 0, "second delivery connection failed", `${deliverySecond.stdout}${deliverySecond.stderr}`);
  assert(/"replayed"\s*:\s*false/i.test(deliveryFirst.stdout), "first delivery was not the creator", deliveryFirst.stdout);
  assert(/"replayed"\s*:\s*true/i.test(deliverySecond.stdout), "second delivery did not replay", deliverySecond.stdout);
  assert(/"needs_owner"\s*:\s*true/i.test(deliveryFirst.stdout), "delivery suppressed its owner job before the exact link", deliveryFirst.stdout);
  const openBeforeLink = runPsql(
    `SELECT count(*) FROM public.owner_alerts
     WHERE kind = 'operator_delivery_check_needed'
       AND entity_ref = '${ids.deliveryRun}' AND resolved_at IS NULL;`,
    "delivery pre-link owner job",
  ).trim();
  assert(openBeforeLink === "1", "delivery did not keep exactly one owner job before link", openBeforeLink);
  const deliveryScaleReplay = runPsql(
    claimed(deliveryCall({
      runId: ids.deliveryRun,
      evidenceId: ids.deliveryEvidence,
      quantity: 1,
      quantitySql: "1.000",
    })),
    "equivalent-scale delivery replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(deliveryScaleReplay), "equivalent delivery scale was rejected", deliveryScaleReplay);

  expectPsqlFailure(
    claimed(deliveryCall({ runId: ids.deliveryRun, evidenceId: ids.deliveryEvidence, quantity: 1.25 })),
    /different answers/i,
    "changed delivery replay",
  );

  const deliveryBatch = runPsql(
    `SELECT id FROM public.inventory_batches WHERE intake_idempotency_key = 'operator-delivery:${ids.deliveryRun}';`,
    "read atomic delivery batch",
  ).trim();
  assert(/^[0-9a-f-]{36}$/i.test(deliveryBatch), "atomic delivery did not return one durable batch", deliveryBatch);

  const firstLink = runPsql(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.deliveryEvidence}', '${branchId}', '${ids.deliveryRun}',
      'inventory_batch', '${deliveryBatch}', 'Run completion ${suffix}', false
    );`),
    "first delivery evidence link",
  );
  const replayLink = runPsql(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.deliveryEvidence}', '${branchId}', '${ids.deliveryRun}',
      'inventory_batch', '${deliveryBatch}', 'Run completion ${suffix}', false
    );`),
    "replayed delivery evidence link",
  );
  assert(/"replayed"\s*:\s*false/i.test(firstLink), "first evidence link did not mutate", firstLink);
  assert(/"replayed"\s*:\s*true/i.test(replayLink), "evidence replay was not idempotent", replayLink);
  assert(/"needs_owner"\s*:\s*false/i.test(firstLink), "successful exact link did not resolve the delivery job", firstLink);
  assert(/"needs_owner"\s*:\s*false/i.test(replayLink), "exact link replay reopened the delivery job", replayLink);

  const legacyDelivery = runPsql(
    claimed(deliveryCall({ runId: ids.legacyDeliveryRun })),
    "legacy completed delivery replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(legacyDelivery), "legacy delivery did not replay", legacyDelivery);
  expectPsqlFailure(
    claimed(deliveryCall({ runId: ids.legacyDeliveryRun, quantity: 1.1 })),
    /different answers/i,
    "changed legacy delivery replay",
  );
  for (const [runId, label] of [
    [ids.legacyDeliveryMissingRun, "missing"],
    [ids.legacyDeliveryForeignRun, "foreign"],
    [ids.legacyDeliveryCorruptRun, "corrupt"],
  ]) {
    expectPsqlFailure(
      claimed(deliveryCall({ runId })),
      /missing|foreign|corrupt|different answers/i,
      `${label} legacy delivery target`,
    );
  }
  const legacyOwnerReplay = runPsql(
    claimed(`SELECT public.complete_operator_owner_check_v18(
      '${ids.legacyOwnerRun}', '${branchId}', 'delivery',
      'operator_stock_help_needed', 'Operator was not sure what happened with stock.',
      jsonb_build_object('askedForHelp', true)
    );`),
    "legacy owner-alert replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(legacyOwnerReplay), "valid legacy owner target did not replay", legacyOwnerReplay);
  expectPsqlFailure(
    claimed(`SELECT public.complete_operator_owner_check_v18(
      '${ids.legacyOwnerForeignRun}', '${branchId}', 'delivery',
      'operator_stock_help_needed', 'Operator was not sure what happened with stock.',
      jsonb_build_object('askedForHelp', true)
    );`),
    /missing|foreign/i,
    "foreign legacy owner target",
  );

  const recoveredDelivery = runPsql(
    claimed(deliveryCall({ runId: ids.partialDeliveryRun, evidenceId: ids.partialDeliveryEvidence })),
    "pre-cutover delivery fact recovery",
  );
  assert(/"adopted_legacy_batch"\s*:\s*true/i.test(recoveredDelivery), "old delivery fact was not adopted", recoveredDelivery);
  assert(recoveredDelivery.includes(ids.partialDeliveryRun), "recovered delivery returned a duplicate batch", recoveredDelivery);
  const repairedExactLink = runPsql(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.partialDeliveryEvidence}', '${branchId}', '${ids.partialDeliveryRun}',
      'inventory_batch', '${ids.partialDeliveryRun}', 'Run completion ${suffix}', false
    );`),
    "pre-cutover exact evidence audit repair",
  );
  assert(/"replayed"\s*:\s*true/i.test(repairedExactLink), "exact evidence edge was not replayed", repairedExactLink);
  assert(/"needs_owner"\s*:\s*false/i.test(repairedExactLink), "exact repaired link did not resolve the transient job", repairedExactLink);

  const invalidDeliveries = [
    { runId: ids.missingDeliveryRun, evidenceId: ids.missingEvidence, label: "missing" },
    { runId: ids.crossDeliveryRun, evidenceId: ids.crossEvidence, label: "cross-branch" },
    { runId: ids.deletedDeliveryRun, evidenceId: ids.deletedEvidence, label: "deleted" },
    { runId: ids.wrongUploaderRun, evidenceId: ids.wrongUploaderEvidence, label: "wrong-uploader" },
    { runId: ids.wrongTypeRun, evidenceId: ids.wrongTypeEvidence, label: "wrong-type" },
    { runId: ids.wrongSourceRun, evidenceId: ids.wrongSourceEvidence, label: "wrong-source-run" },
    { runId: ids.blankPathRun, evidenceId: ids.blankPathEvidence, label: "blank-path" },
    { runId: ids.failedEvidenceRun, evidenceId: ids.failedEvidence, label: "failed-status" },
    { runId: ids.nullUploaderRun, evidenceId: ids.nullUploaderEvidence, label: "null-uploader" },
    { runId: ids.nullSourceRun, evidenceId: ids.nullSourceEvidence, label: "null-source" },
  ];
  for (const entry of invalidDeliveries) {
    const output = runPsql(
      claimed(deliveryCall({ runId: entry.runId, evidenceId: entry.evidenceId })),
      `${entry.label} evidence delivery`,
    );
    assert(/"needs_owner"\s*:\s*true/i.test(output), `${entry.label} evidence suppressed owner review`, output);
  }
  for (const [runId, evidenceId, label] of [
    [ids.nullCertificateUploaderRun, ids.nullCertificateUploaderEvidence, "null certificate uploader"],
    [ids.nullCertificateSourceRun, ids.nullCertificateSourceEvidence, "null certificate source"],
  ]) {
    expectPsqlFailure(
      claimed(`SELECT public.complete_operator_certificate_v18(
        '${runId}', '${branchId}', '${evidenceId}', 'halal'
      );`),
      /not available/i,
      label,
    );
  }

  const wrongSourceBatch = runPsql(
    `SELECT id FROM public.inventory_batches
     WHERE intake_idempotency_key = 'operator-delivery:${ids.wrongSourceRun}';`,
    "wrong-source delivery batch",
  ).trim();
  expectPsqlFailure(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.wrongSourceEvidence}', '${branchId}', '${ids.wrongSourceRun}',
      'inventory_batch', '${wrongSourceBatch}', 'Wrong source', false
    );`),
    /does not authorise|different work|belongs/i,
    "wrong-source evidence link",
  );
  assert(runPsql(
    `SELECT count(*) FROM public.owner_alerts
     WHERE kind = 'operator_delivery_check_needed'
       AND entity_ref = '${ids.wrongSourceRun}' AND resolved_at IS NULL;`,
    "failed-link owner job",
  ).trim() === "1", "failed evidence link removed the delivery owner job");

  const wrongCompletedTarget = runPsql(
    `SELECT id FROM public.inventory_batches
     WHERE intake_idempotency_key = 'operator-delivery:${ids.missingDeliveryRun}';`,
    "completed-run wrong target fixture",
  ).trim();
  expectPsqlFailure(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.deliveryEvidence}', '${branchId}', '${ids.deliveryRun}',
      'inventory_batch', '${wrongCompletedTarget}', 'Wrong target', false
    );`),
    /does not authorise/i,
    "completed run wrong evidence target",
  );

  expectPsqlFailure(
    claimed(`SELECT public.record_operator_delivery_v18(
      '${ids.scalarDeliveryRun}', '${branchId}', '${ids.product}', '${ids.supplier}',
      1, 'tomorrow', 'fridge', NULL,
      jsonb_build_object(
        'productId', '${ids.product}', 'supplierId', '${ids.supplier}', 'quantity', 2,
        'expiryChoice', 'tomorrow', 'storageChoice', 'fridge', 'noteEvidenceId', NULL
      )
    );`),
    /do not match/i,
    "delivery scalar-step mismatch",
  );

  expectPsqlFailure(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.deliveryEvidence}', '${branchId}', '${ids.missingDeliveryRun}',
      'inventory_batch',
      (SELECT id FROM public.inventory_batches WHERE intake_idempotency_key = 'operator-delivery:${ids.missingDeliveryRun}'),
      'Hijacked target', true
    );`),
    /does not authorise|already linked|different work/i,
    "same-branch evidence hijack",
  );

  const unknownFirst = runPsql(
    claimed(deliveryCall({ runId: ids.unknownDeliveryRun, productId: null })),
    "unknown-product owner completion",
  );
  const unknownReplay = runPsql(
    claimed(deliveryCall({ runId: ids.unknownDeliveryRun, productId: null })),
    "unknown-product owner replay",
  );
  assert(/"outcome"\s*:\s*"owner_check"/i.test(unknownFirst), "unknown product did not become owner work", unknownFirst);
  assert(/"replayed"\s*:\s*true/i.test(unknownReplay), "owner work did not replay", unknownReplay);

  expectPsqlFailure(
    claimed(deliveryCall({ runId: ids.deliveryFaultRun })),
    /injected operator completion failure/i,
    "delivery completion fault",
  );
  expectPsqlFailure(
    claimed(deliveryCall({ runId: ids.abandonedDeliveryRun })),
    /replaced|newer run/i,
    "abandoned delivery",
  );

  const wasteWinner = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, true);
SET LOCAL ROLE authenticated;
SET LOCAL application_name = 'verify-v18-waste-${suffix}';
${wasteCall({ runId: ids.wasteRun, quantity: 0.5, evidenceId: ids.wasteEvidence })}
SELECT pg_sleep(3);
COMMIT;
`);
  await waitForSleepingSession(`verify-v18-waste-${suffix}`);
  const wasteReplay = runPsqlAsync(claimed(wasteCall({ runId: ids.wasteRun, quantity: 0.5, evidenceId: ids.wasteEvidence })));
  const [wasteFirst, wasteSecond] = await Promise.all([wasteWinner, wasteReplay]);
  assert(wasteFirst.status === 0, "first waste connection failed", `${wasteFirst.stdout}${wasteFirst.stderr}`);
  assert(wasteSecond.status === 0, "second waste connection failed", `${wasteSecond.stdout}${wasteSecond.stderr}`);
  assert(/"replayed"\s*:\s*false/i.test(wasteFirst.stdout), "first waste call was not the creator", wasteFirst.stdout);
  assert(/"replayed"\s*:\s*true/i.test(wasteSecond.stdout), "second waste call did not replay", wasteSecond.stdout);
  const wasteScaleReplay = runPsql(
    claimed(wasteCall({
      runId: ids.wasteRun,
      quantity: 0.5,
      quantitySql: "0.500",
      evidenceId: ids.wasteEvidence,
    })),
    "equivalent-scale waste replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(wasteScaleReplay), "equivalent waste scale was rejected", wasteScaleReplay);

  expectPsqlFailure(
    claimed(wasteCall({ runId: ids.wasteRun, quantity: 0.6, evidenceId: ids.wasteEvidence })),
    /different answers/i,
    "changed waste replay",
  );

  const wasteId = runPsql(
    `SELECT replace(result_ref, 'waste:', '') FROM public.operator_workflow_runs WHERE id = '${ids.wasteRun}';`,
    "read atomic waste event",
  ).trim();
  assert(/^[0-9a-f-]{36}$/i.test(wasteId), "atomic waste did not return one durable event", wasteId);
  runPsql(
    `INSERT INTO public.operator_workflow_runs(
      id, branch_id, operator_id, workflow, status, steps, result_ref, updated_at
    ) VALUES (
      '${ids.legacyWasteRun}', '${branchId}', (${operatorClaim})::uuid, 'waste', 'completed',
      jsonb_build_object(
        'productId', '${ids.product}', 'quantity', 0.5, 'reason', 'expired',
        'photoEvidenceId', NULL, 'productName', 'Run completion ${suffix}',
        'batchId', '${ids.wasteBatch}', 'wasteId', '${wasteId}'
      ),
      'waste:${wasteId}', now()
    );`,
    "legacy waste fixture",
  );
  const legacyWaste = runPsql(
    claimed(wasteCall({ runId: ids.legacyWasteRun, quantity: 0.5 })),
    "legacy completed waste replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(legacyWaste), "legacy waste did not replay", legacyWaste);
  expectPsqlFailure(
    claimed(wasteCall({ runId: ids.legacyWasteRun, quantity: 0.6 })),
    /different answers/i,
    "changed legacy waste replay",
  );
  for (const [runId, label] of [
    [ids.legacyWasteMissingRun, "missing"],
    [ids.legacyWasteForeignRun, "foreign"],
    [ids.legacyWasteCorruptRun, "corrupt"],
  ]) {
    expectPsqlFailure(
      claimed(wasteCall({ runId, quantity: 0.5 })),
      /missing|foreign|corrupt|different answers/i,
      `${label} legacy waste target`,
    );
  }
  const firstWasteLink = runPsql(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.wasteEvidence}', '${branchId}', '${ids.wasteRun}',
      'waste_event', '${wasteId}', 'Run completion ${suffix}', false
    );`),
    "first waste evidence link",
  );
  const replayWasteLink = runPsql(
    claimed(`SELECT public.link_operator_evidence_v18(
      '${ids.wasteEvidence}', '${branchId}', '${ids.wasteRun}',
      'waste_event', '${wasteId}', 'Run completion ${suffix}', false
    );`),
    "replayed waste evidence link",
  );
  assert(/"replayed"\s*:\s*false/i.test(firstWasteLink), "first waste evidence link did not mutate", firstWasteLink);
  assert(/"replayed"\s*:\s*true/i.test(replayWasteLink), "waste evidence replay was not idempotent", replayWasteLink);

  const legacyReviewWasteId = lastUuid(runPsql(
    claimed(`SELECT public.admin_record_inventory_waste('${ids.wasteBatch}', 0.3, 'review');`),
    "legacy review-waste fact",
  ), "legacy review-waste fact");
  runPsql(
    `INSERT INTO public.operator_workflow_runs(
       id, branch_id, operator_id, workflow, status, steps, result_ref, updated_at
     ) VALUES (
       '${ids.legacyReviewWasteRun}', '${branchId}', (${operatorClaim})::uuid,
       'waste', 'completed',
       jsonb_build_object(
         'productId', '${ids.product}', 'quantity', 0.3, 'reason', 'review',
         'photoEvidenceId', NULL, 'productName', 'Run completion ${suffix}',
         'batchId', '${ids.wasteBatch}', 'wasteId', '${legacyReviewWasteId}'
       ), 'waste:${legacyReviewWasteId}', now()
     );`,
    "legacy review-waste run",
  );
  const healedReviewWaste = runPsql(
    claimed(wasteCall({ runId: ids.legacyReviewWasteRun, quantity: 0.3, reason: "review" })),
    "legacy review-waste replay repair",
  );
  assert(/"replayed"\s*:\s*true/i.test(healedReviewWaste), "legacy review waste did not replay", healedReviewWaste);
  assert(runPsql(
    `SELECT count(*) FROM public.owner_alerts
     WHERE kind = 'operator_waste_reason_check'
       AND entity_ref = '${ids.legacyReviewWasteRun}' AND resolved_at IS NULL;`,
    "legacy review-waste job repair",
  ).trim() === "1", "legacy review waste did not heal its reason-check job");

  const partialWasteId = lastUuid(runPsql(
    claimed(`SELECT public.admin_record_inventory_waste('${ids.wasteBatch}', 0.4, 'expired');`),
    "pre-cutover waste fact",
  ), "pre-cutover waste fact");
  runPsql(
    `UPDATE public.operator_evidence
     SET source_type = 'waste_event', source_id = '${partialWasteId}',
         source_ref = 'Run completion ${suffix}', status = 'linked',
         review_required = false, linked_at = now()
     WHERE id = '${ids.partialWasteEvidence}';
     INSERT INTO public.audit_logs(
       event_type, target_type, target_id, branch_id, actor_id, metadata
     ) VALUES (
       'evidence_linked', 'operator_evidence', '${ids.partialWasteEvidence}',
       '${branchId}', (${operatorClaim})::uuid,
       jsonb_build_object('source_type', 'waste_event', 'source_id', '${partialWasteId}')
     );`,
    "pre-cutover waste link graph",
  );
  const recoveredWaste = runPsql(
    claimed(wasteCall({
      runId: ids.partialWasteRun,
      quantity: 0.4,
      evidenceId: ids.partialWasteEvidence,
    })),
    "pre-cutover waste recovery",
  );
  assert(recoveredWaste.includes(partialWasteId), "strict pre-cutover waste graph was not adopted", recoveredWaste);

  const wasteCountBeforeAmbiguous = Number(runPsql(
    `SELECT count(*) FROM public.inventory_waste_events WHERE batch_id = '${ids.wasteBatch}';`,
    "ambiguous cutover waste count before",
  ).trim());
  const ambiguousWaste = runPsql(
    claimed(wasteCall({ runId: ids.ambiguousWasteRun, quantity: 0.4 })),
    "ambiguous pre-cutover waste fail-safe",
  );
  assert(/"owner_alert_kind"\s*:\s*"operator_waste_recovery_needed"/i.test(ambiguousWaste), "ambiguous cutover waste did not become owner review", ambiguousWaste);
  const wasteCountAfterAmbiguous = Number(runPsql(
    `SELECT count(*) FROM public.inventory_waste_events WHERE batch_id = '${ids.wasteBatch}';`,
    "ambiguous cutover waste count after",
  ).trim());
  assert(wasteCountAfterAmbiguous === wasteCountBeforeAmbiguous, "ambiguous cutover waste changed inventory");

  expectPsqlFailure(
    claimed(`SELECT public.record_operator_waste_v18(
      '${ids.scalarWasteRun}', '${branchId}', '${ids.product}', 0.2, 'expired', NULL,
      jsonb_build_object(
        'productId', '${ids.product}', 'quantity', 0.3,
        'reason', 'expired', 'photoEvidenceId', NULL
      )
    );`),
    /do not match/i,
    "waste scalar-step mismatch",
  );

  const conflictWinner = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, true);
SET LOCAL ROLE authenticated;
SET LOCAL application_name = 'verify-v18-waste-conflict-${suffix}';
${wasteCall({ runId: ids.wasteConflictRun, quantity: 0.2 })}
SELECT pg_sleep(3);
COMMIT;
`);
  await waitForSleepingSession(`verify-v18-waste-conflict-${suffix}`);
  const conflictLoser = runPsqlAsync(claimed(wasteCall({ runId: ids.wasteConflictRun, quantity: 0.3 })));
  const [conflictFirst, conflictSecond] = await Promise.all([conflictWinner, conflictLoser]);
  assert(conflictFirst.status === 0, "winning conflicting waste call failed", `${conflictFirst.stdout}${conflictFirst.stderr}`);
  assert((conflictSecond.status ?? 0) !== 0, "changed concurrent waste payload unexpectedly replayed", conflictSecond.stdout);
  assert(/different answers/i.test(`${conflictSecond.stdout}${conflictSecond.stderr}`), "changed concurrent waste refusal was unclear", `${conflictSecond.stdout}${conflictSecond.stderr}`);

  expectPsqlFailure(
    claimed(wasteCall({ runId: ids.wasteFaultRun, quantity: 0.4 })),
    /injected operator completion failure/i,
    "waste completion fault",
  );
  expectPsqlFailure(
    claimed(wasteCall({ runId: ids.abandonedWasteRun, quantity: 0.4 })),
    /replaced|newer run/i,
    "abandoned waste",
  );

  const noWasteFirst = runPsql(
    claimed(`SELECT public.complete_operator_no_waste_v18('${ids.noWasteRun}', '${branchId}');`),
    "first no-waste completion",
  );
  const noWasteReplay = runPsql(
    claimed(`SELECT public.complete_operator_no_waste_v18('${ids.noWasteRun}', '${branchId}');`),
    "replayed no-waste completion",
  );
  assert(/"replayed"\s*:\s*false/i.test(noWasteFirst), "no-waste run did not complete", noWasteFirst);
  assert(/"replayed"\s*:\s*true/i.test(noWasteReplay), "no-waste run did not replay", noWasteReplay);
  const legacyNoWaste = runPsql(
    claimed(`SELECT public.complete_operator_no_waste_v18('${ids.legacyNoWasteRun}', '${branchId}');`),
    "legacy no-waste replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(legacyNoWaste), "legacy no-waste run did not replay", legacyNoWaste);
  expectPsqlFailure(
    claimed(wasteCall({ runId: ids.noWasteRun, quantity: 0.1 })),
    /different answers/i,
    "no-waste changed to waste",
  );
  expectPsqlFailure(
    claimed(`SELECT public.complete_operator_no_waste_v18('${ids.foreignRun}', '${foreignBranchId}');`),
    /not authorised/i,
    "cross-branch run completion",
  );

  runPsql(
    `
DO $$
DECLARE
  v_delivery_batch uuid := (
    SELECT id FROM public.inventory_batches
    WHERE intake_idempotency_key = 'operator-delivery:${ids.deliveryRun}'
  );
BEGIN
  IF (SELECT count(*) FROM public.inventory_batches
      WHERE intake_idempotency_key = 'operator-delivery:${ids.deliveryRun}') <> 1
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_delivery_cost_pending'
           AND entity_ref = v_delivery_batch::text || ':cost') <> 1
     OR EXISTS (
       SELECT 1 FROM public.owner_alerts
       WHERE kind = 'operator_delivery_check_needed'
         AND entity_ref = '${ids.deliveryRun}'
         AND resolved_at IS NULL
     )
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'ops_session_completed' AND target_id = '${ids.deliveryRun}') <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'evidence_linked' AND target_id = '${ids.deliveryEvidence}') <> 1 THEN
    RAISE EXCEPTION 'delivery replay/link facts were not exactly-once';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id IN (
         '${ids.missingDeliveryRun}'::uuid, '${ids.crossDeliveryRun}'::uuid,
         '${ids.deletedDeliveryRun}'::uuid, '${ids.wrongUploaderRun}'::uuid,
         '${ids.wrongTypeRun}'::uuid, '${ids.wrongSourceRun}'::uuid,
         '${ids.blankPathRun}'::uuid, '${ids.failedEvidenceRun}'::uuid,
         '${ids.nullUploaderRun}'::uuid, '${ids.nullSourceRun}'::uuid
       )
         AND coalesce((completion_receipt->>'needs_owner')::boolean, false) = false
     )
     OR EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id IN (
         '${ids.missingDeliveryRun}'::uuid, '${ids.crossDeliveryRun}'::uuid,
         '${ids.deletedDeliveryRun}'::uuid, '${ids.wrongUploaderRun}'::uuid,
         '${ids.wrongTypeRun}'::uuid, '${ids.wrongSourceRun}'::uuid,
         '${ids.blankPathRun}'::uuid, '${ids.failedEvidenceRun}'::uuid,
         '${ids.nullUploaderRun}'::uuid, '${ids.nullSourceRun}'::uuid
       )
         AND steps->>'noteEvidenceId' IS NOT NULL
     )
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_delivery_check_needed'
           AND entity_ref IN (
             '${ids.missingDeliveryRun}', '${ids.crossDeliveryRun}', '${ids.deletedDeliveryRun}',
             '${ids.wrongUploaderRun}', '${ids.wrongTypeRun}', '${ids.wrongSourceRun}',
             '${ids.blankPathRun}', '${ids.failedEvidenceRun}',
             '${ids.nullUploaderRun}', '${ids.nullSourceRun}'
           ) AND resolved_at IS NULL) <> 10 THEN
    RAISE EXCEPTION 'invalid evidence suppressed a delivery owner job';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.inventory_batches
       WHERE intake_idempotency_key = 'operator-delivery:${ids.deliveryFaultRun}'
     )
     OR EXISTS (
       SELECT 1 FROM public.inventory_batches
       WHERE intake_idempotency_key = 'operator-delivery:${ids.abandonedDeliveryRun}'
     )
     OR EXISTS (
       SELECT 1 FROM public.inventory_batches
       WHERE intake_idempotency_key = 'operator-delivery:${ids.legacyDeliveryRun}'
     )
     OR EXISTS (
       SELECT 1 FROM public.owner_alerts WHERE entity_ref = '${ids.deliveryFaultRun}'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id = '${ids.deliveryFaultRun}' AND status = 'in_progress'
         AND completion_fingerprint IS NULL AND result_ref IS NULL
     ) THEN
    RAISE EXCEPTION 'delivery completion fault left a partial business graph';
  END IF;

  IF (SELECT count(*) FROM public.owner_alerts
      WHERE kind = 'operator_delivery_unknown_product'
        AND entity_ref = '${ids.unknownDeliveryRun}') <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'inventory_reconciliation_issue'
           AND target_id = (
             SELECT id FROM public.owner_alerts
             WHERE kind = 'operator_delivery_unknown_product'
               AND entity_ref = '${ids.unknownDeliveryRun}'
           )) <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'ops_session_completed'
           AND target_id = '${ids.unknownDeliveryRun}') <> 1 THEN
    RAISE EXCEPTION 'owner-check completion did not commit exactly one alert and audit';
  END IF;

  IF (SELECT count(*) FROM public.inventory_waste_events
      WHERE batch_id = '${ids.wasteBatch}') <> 4
     OR (SELECT count(*) FROM public.inventory_movements
         WHERE batch_id = '${ids.wasteBatch}' AND source_event = 'WASTE_RECORDED') <> 4
     OR (SELECT remaining_weight_kg FROM public.inventory_batches
         WHERE id = '${ids.wasteBatch}') <> 18.6
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'ops_session_completed' AND target_id = '${ids.wasteRun}') <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'evidence_linked' AND target_id = '${ids.wasteEvidence}') <> 1 THEN
    RAISE EXCEPTION 'waste replay/concurrency facts were not exactly-once';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id = '${ids.wasteFaultRun}' AND status = 'in_progress'
         AND completion_fingerprint IS NULL AND result_ref IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id IN ('${ids.abandonedWasteRun}'::uuid, '${ids.abandonedDeliveryRun}'::uuid)
         AND status <> 'abandoned'
     )
     OR EXISTS (
       SELECT 1 FROM public.operator_workflow_runs WHERE id = '${ids.foreignRun}'
     ) THEN
    RAISE EXCEPTION 'terminal or branch run fence was bypassed';
  END IF;

  IF (SELECT count(*) FROM public.audit_logs
      WHERE event_type = 'ops_session_completed' AND target_id = '${ids.noWasteRun}') <> 1
     OR (SELECT source_type FROM public.operator_evidence WHERE id = '${ids.deliveryEvidence}') IS DISTINCT FROM 'inventory_batch'
     OR (SELECT source_id FROM public.operator_evidence WHERE id = '${ids.deliveryEvidence}') IS DISTINCT FROM v_delivery_batch THEN
    RAISE EXCEPTION 'run replay or evidence provenance was not preserved';
  END IF;

  IF (SELECT count(*) FROM public.inventory_batches
      WHERE intake_idempotency_key LIKE 'operator-delivery:${ids.partialDeliveryRun}:%') <> 1
     OR (SELECT result_ref FROM public.operator_workflow_runs
         WHERE id = '${ids.partialDeliveryRun}') IS DISTINCT FROM
        'inventory_batch:${ids.partialDeliveryRun}'
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'evidence_linked'
           AND target_id = '${ids.partialDeliveryEvidence}'
           AND metadata->>'source_id' = '${ids.partialDeliveryRun}') <> 1
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_delivery_cost_pending'
           AND entity_ref IN (
             '${ids.legacyDeliveryBatch}:cost', '${ids.partialDeliveryRun}:cost'
           ) AND resolved_at IS NULL) <> 2
     OR (SELECT count(*) FROM public.audit_logs
         WHERE event_type = 'ops_session_completed'
           AND target_id IN (
             '${ids.legacyDeliveryRun}'::uuid, '${ids.legacyWasteRun}'::uuid,
             '${ids.legacyNoWasteRun}'::uuid, '${ids.legacyOwnerRun}'::uuid,
             '${ids.legacyReviewWasteRun}'::uuid
           )) <> 5
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_waste_recovery_needed'
           AND entity_ref = '${ids.ambiguousWasteRun}'
           AND resolved_at IS NULL) <> 1
     OR EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id IN ('${ids.scalarDeliveryRun}'::uuid, '${ids.scalarWasteRun}'::uuid)
     ) THEN
    RAISE EXCEPTION 'legacy repair, cutover recovery, or scalar coherence invariant failed';
  END IF;
END;
$$;
`,
    "operator completion integrity assertions",
  );

  console.log("V18 operator run completion two-connection battery passed");
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  let cleanupError = null;
  try {
    runPsql(
      `
BEGIN;
DROP TRIGGER IF EXISTS ${faultTrigger} ON public.operator_workflow_runs;
DROP FUNCTION IF EXISTS public.${faultFunction}();

SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE cleanup_operator_batches ON COMMIT DROP AS
SELECT id FROM public.inventory_batches
WHERE product_id = '${ids.product}';
CREATE TEMP TABLE cleanup_operator_waste ON COMMIT DROP AS
SELECT id FROM public.inventory_waste_events
WHERE batch_id IN (SELECT id FROM cleanup_operator_batches);
CREATE TEMP TABLE cleanup_operator_alerts ON COMMIT DROP AS
SELECT id FROM public.owner_alerts
WHERE branch_id IN ('${branchId}'::uuid, '${foreignBranchId}'::uuid)
  AND (
    entity_ref IN (${runNames.map((name) => `'${ids[name]}'`).join(", ")})
    OR entity_ref IN (SELECT id::text || ':cost' FROM cleanup_operator_batches)
  );
CREATE TEMP TABLE cleanup_operator_targets ON COMMIT DROP AS
SELECT id FROM cleanup_operator_batches
UNION SELECT id FROM cleanup_operator_waste
UNION SELECT id FROM cleanup_operator_alerts
UNION SELECT id FROM public.operator_evidence
  WHERE id IN (
    ${evidenceNames.map((name) => `'${ids[name]}'`).join(", ")}
  )
UNION SELECT id FROM public.operator_workflow_runs
  WHERE id IN (${runNames.map((name) => `'${ids[name]}'::uuid`).join(", ")});

DELETE FROM public.alert_dispatches WHERE alert_id IN (SELECT id FROM cleanup_operator_alerts);
DELETE FROM public.audit_events WHERE entity_id IN (SELECT id FROM cleanup_operator_targets);
DELETE FROM public.audit_logs WHERE target_id IN (SELECT id FROM cleanup_operator_targets);
DELETE FROM public.owner_alerts WHERE id IN (SELECT id FROM cleanup_operator_alerts);
DELETE FROM public.inventory_movements WHERE batch_id IN (SELECT id FROM cleanup_operator_batches);
DELETE FROM public.inventory_waste_events WHERE id IN (SELECT id FROM cleanup_operator_waste);
DELETE FROM public.operator_evidence WHERE id IN (
  ${evidenceNames.map((name) => `'${ids[name]}'`).join(", ")}
);
DELETE FROM public.operator_workflow_runs
WHERE id IN (${runNames.map((name) => `'${ids[name]}'::uuid`).join(", ")});
DELETE FROM public.inventory_batches WHERE id IN (SELECT id FROM cleanup_operator_batches);
DELETE FROM public.suppliers WHERE id = '${ids.supplier}';
DELETE FROM public.products WHERE id = '${ids.product}';
COMMIT;
`,
      "operator completion fixture cleanup",
    );
  } catch (error) {
    cleanupError = error;
  }
  if (cleanupError) {
    if (primaryError) {
      console.error(`V18 operator completion cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    } else {
      throw cleanupError;
    }
  }
}
