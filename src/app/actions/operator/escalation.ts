import { revalidatePath } from "next/cache";

import { emitAuditLog, type AuditEventType } from "@/lib/server/audit";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type AlertSeverity = "warning" | "critical";
type WorkflowName = "certificate" | "delivery" | "serve" | "waste";

export type OperatorRunSaveResult =
  | { ok: true; state: "saved" | "completed" }
  | { ok: false; message: string };

export type OperatorActionResult =
  | { ok: true; message: string; id?: string; needsOwner?: boolean }
  | { ok: false; message: string };

export function isUuid(value: string | null | undefined) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function simpleText(value: string | null | undefined, limit = 120) {
  return value?.replace(/[^\w .,:;()/-]/g, "").trim().slice(0, limit) || null;
}

export function revalidateOperatorOps() {
  revalidatePath("/operator");
  revalidatePath("/operator/stock");
  revalidatePath("/operator/waste");
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/purchasing");
}

export async function saveOperatorRun(input: {
  runId: string;
  branchId: string;
  profileId: string;
  workflow: WorkflowName;
  status: "in_progress" | "completed";
  steps: Record<string, unknown>;
  resultRef?: string | null;
}): Promise<OperatorRunSaveResult> {
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Draft storage is unavailable." };
  if (!isUuid(input.runId)) return { ok: false, message: "Invalid workflow run." };

  const supabase = createSupabaseServiceClient();
  const payload = {
    branch_id: input.branchId,
    operator_id: input.profileId,
    workflow: input.workflow,
    status: input.status,
    steps: input.steps,
    result_ref: input.resultRef ?? null,
    updated_at: new Date().toISOString(),
  };

  // Never let a late draft write from another device turn a completed run back
  // into in_progress. Updates carry a status predicate, so a completion racing a
  // draft always wins regardless of which request read the row first.
  const existing = await supabase
    .from("operator_workflow_runs")
    .select("status")
    .eq("id", input.runId)
    .eq("branch_id", input.branchId)
    .eq("operator_id", input.profileId)
    .eq("workflow", input.workflow)
    .maybeSingle<{ status: "in_progress" | "completed" | "abandoned" }>();

  if (existing.error) {
    console.error("[operator-draft] read failed", { workflow: input.workflow, error: existing.error.message });
    return { ok: false, message: "Draft did not save." };
  }

  if (existing.data) {
    if (existing.data.status === "completed") return { ok: true, state: "completed" };
    if (existing.data.status === "abandoned") {
      return { ok: false, message: "This draft was already replaced." };
    }

    let update = supabase
      .from("operator_workflow_runs")
      .update(payload)
      .eq("id", input.runId)
      .eq("branch_id", input.branchId)
      .eq("operator_id", input.profileId)
      .eq("workflow", input.workflow);
    update = update.eq("status", "in_progress");

    const changed = await update.select("status").maybeSingle<{ status: "in_progress" | "completed" }>();
    if (changed.error) {
      console.error("[operator-draft] update failed", { workflow: input.workflow, error: changed.error.message });
      return { ok: false, message: "Draft did not save." };
    }
    if (changed.data) return { ok: true, state: changed.data.status === "completed" ? "completed" : "saved" };

    // A concurrent completion may have won after our first read. Confirm that
    // outcome instead of reporting a false save failure.
    const raced = await supabase
      .from("operator_workflow_runs")
      .select("status")
      .eq("id", input.runId)
      .eq("branch_id", input.branchId)
      .eq("operator_id", input.profileId)
      .eq("workflow", input.workflow)
      .maybeSingle<{ status: string }>();
    if (raced.data?.status === "completed") return { ok: true, state: "completed" };
    return { ok: false, message: "Draft did not save." };
  }

  const inserted = await supabase
    .from("operator_workflow_runs")
    .insert({ id: input.runId, ...payload })
    .select("status")
    .maybeSingle<{ status: "in_progress" | "completed" }>();

  if (!inserted.error && inserted.data) {
    return { ok: true, state: inserted.data.status === "completed" ? "completed" : "saved" };
  }

  // If another request inserted the same run concurrently, accept it only when
  // it belongs to this exact operator/branch. A colliding id owned elsewhere
  // fails closed and can never recurse or disclose the other row.
  if (inserted.error?.code === "23505") {
    const raced = await supabase
      .from("operator_workflow_runs")
      .select("status")
      .eq("id", input.runId)
      .eq("branch_id", input.branchId)
      .eq("operator_id", input.profileId)
      .eq("workflow", input.workflow)
      .maybeSingle<{ status: "in_progress" | "completed" | "abandoned" }>();
    if (raced.data?.status === "completed") return { ok: true, state: "completed" };
    if (raced.data?.status === "in_progress") {
      const retry = await supabase
        .from("operator_workflow_runs")
        .update(payload)
        .eq("id", input.runId)
        .eq("branch_id", input.branchId)
        .eq("operator_id", input.profileId)
        .eq("workflow", input.workflow)
        .eq("status", "in_progress")
        .select("status")
        .maybeSingle<{ status: "in_progress" }>();
      if (retry.data) return { ok: true, state: "saved" };

      const completed = await supabase
        .from("operator_workflow_runs")
        .select("status")
        .eq("id", input.runId)
        .eq("branch_id", input.branchId)
        .eq("operator_id", input.profileId)
        .eq("workflow", input.workflow)
        .maybeSingle<{ status: string }>();
      if (completed.data?.status === "completed") return { ok: true, state: "completed" };
    }
  }
  console.error("[operator-draft] insert failed", { workflow: input.workflow, error: inserted.error?.message });
  return { ok: false, message: "Draft did not save." };
}

export async function readCompletedRun(input: {
  runId: string;
  branchId: string;
  profileId: string;
  workflow: WorkflowName;
}) {
  if (!hasSupabaseServiceEnv() || !isUuid(input.runId)) return null;

  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("operator_workflow_runs")
    .select("status,result_ref")
    .eq("id", input.runId)
    .eq("branch_id", input.branchId)
    .eq("operator_id", input.profileId)
    .eq("workflow", input.workflow)
    .maybeSingle<{ status: string | null; result_ref: string | null }>();

  return data?.status === "completed" ? data.result_ref : null;
}

export async function createOwnerAlert(input: {
  branchId: string;
  profileId: string;
  kind: string;
  summary: string;
  entityRef: string;
  severity?: AlertSeverity;
  eventType?: AuditEventType;
  metadata?: Record<string, unknown>;
}) {
  if (!hasSupabaseServiceEnv()) return null;

  const supabase = createSupabaseServiceClient();
  if (input.kind === "operator_delivery_cost_pending") {
    const { data: ensured, error: ensureError } = await supabase.rpc("ensure_delivery_cost_owner_alert_v18", {
      p_branch_id: input.branchId,
      p_summary: input.summary,
      p_entity_ref: input.entityRef,
      p_created_by: input.profileId,
    });
    const result = ensured as { id?: string; created?: boolean } | null;
    if (ensureError || !result?.id) return null;
    if (!result.created) return result.id;

    await emitAuditLog({
      eventType: input.eventType ?? "inventory_reconciliation_issue",
      targetType: "owner_alert",
      targetId: result.id,
      branchId: input.branchId,
      metadata: {
        kind: input.kind,
        summary: input.summary,
        operator_id: input.profileId,
        ...input.metadata,
      },
      systemReason: "operator_adapter",
    });
    return result.id;
  }

  const existing = await supabase
    .from("owner_alerts")
    .select("id")
    .eq("branch_id", input.branchId)
    .eq("kind", input.kind)
    .eq("entity_ref", input.entityRef)
    .is("resolved_at", null)
    .maybeSingle<{ id: string }>();

  if (existing.data?.id) return existing.data.id;

  const { data, error } = await supabase
    .from("owner_alerts")
    .insert({
      branch_id: input.branchId,
      severity: input.severity ?? "warning",
      kind: input.kind,
      summary: input.summary,
      entity_ref: input.entityRef,
      created_by: input.profileId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data?.id) {
    if (error?.code === "23505") {
      const { data: raced } = await supabase
        .from("owner_alerts")
        .select("id")
        .eq("branch_id", input.branchId)
        .eq("kind", input.kind)
        .eq("entity_ref", input.entityRef)
        .maybeSingle<{ id: string }>();
      return raced?.id ?? null;
    }
    return null;
  }

  await emitAuditLog({
    eventType: input.eventType ?? "inventory_reconciliation_issue",
    targetType: "owner_alert",
    targetId: data.id,
    branchId: input.branchId,
    metadata: {
      kind: input.kind,
      summary: input.summary,
      operator_id: input.profileId,
      ...input.metadata,
    },
    systemReason: "operator_adapter",
  });

  return data.id;
}

export async function auditOperatorRun(input: {
  runId: string;
  branchId: string;
  profileId: string;
  workflow: WorkflowName;
  metadata?: Record<string, unknown>;
}) {
  if (!isUuid(input.runId)) return;

  await emitAuditLog({
    eventType: "ops_session_completed",
    targetType: "operator_workflow_run",
    targetId: input.runId,
    branchId: input.branchId,
    metadata: {
      workflow: input.workflow,
      operator_id: input.profileId,
      ...input.metadata,
    },
    systemReason: "operator_adapter",
  });
}
