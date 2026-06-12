import { revalidatePath } from "next/cache";

import { emitAuditLog, type AuditEventType } from "@/lib/server/audit";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type AlertSeverity = "warning" | "critical";
type WorkflowName = "certificate" | "delivery" | "serve" | "waste";

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
}) {
  if (!hasSupabaseServiceEnv() || !isUuid(input.runId)) return;

  const supabase = createSupabaseServiceClient();
  await supabase.from("operator_workflow_runs").upsert(
    {
      id: input.runId,
      branch_id: input.branchId,
      operator_id: input.profileId,
      workflow: input.workflow,
      status: input.status,
      steps: input.steps,
      result_ref: input.resultRef ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

export async function readCompletedRun(runId: string) {
  if (!hasSupabaseServiceEnv() || !isUuid(runId)) return null;

  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("operator_workflow_runs")
    .select("status,result_ref")
    .eq("id", runId)
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
  const existing = await supabase
    .from("owner_alerts")
    .select("id")
    .eq("branch_id", input.branchId)
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

  if (error || !data?.id) return null;

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
