"use server";

import { saveOperatorRun } from "@/app/actions/operator/escalation";
import {
  isOperatorDraftWorkflow,
  type OperatorDraftWorkflow,
} from "@/lib/operator/workflows/drafts";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type OperatorDraftActionResult =
  | { ok: true; state: "saved" | "completed" | "abandoned" }
  | { ok: false; message: string };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanSteps(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > 32_000) return null;
    const decoded = JSON.parse(encoded) as unknown;
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function saveOperatorDraft(input: {
  runId: string;
  workflow: OperatorDraftWorkflow;
  steps: Record<string, unknown>;
}): Promise<OperatorDraftActionResult> {
  const auth = await resolveStaffContext("manager", { branchScoped: true });
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Draft storage is unavailable." };
  if (!isUuid(input.runId) || !isOperatorDraftWorkflow(input.workflow)) {
    return { ok: false, message: "Draft could not be saved." };
  }

  const steps = cleanSteps(input.steps);
  if (!steps || steps.workflow !== input.workflow) return { ok: false, message: "Draft could not be saved." };

  const failures = typeof steps.draft_failures === "number" ? Math.max(0, Math.floor(steps.draft_failures)) : 0;
  const result = await saveOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profile.id,
    workflow: input.workflow,
    status: "in_progress",
    steps,
  });

  const observedFailures = result.ok ? failures : failures + 1;
  if (observedFailures >= 3) {
    console.error("[operator-draft] repeated save failures", {
      runId: input.runId,
      workflow: input.workflow,
      branchId: auth.branchId,
      operatorId: auth.profile.id,
      draftFailures: observedFailures,
      recovered: result.ok,
    });
  }

  return result;
}

export async function abandonOperatorDraft(input: {
  runId: string;
  workflow: OperatorDraftWorkflow;
}): Promise<OperatorDraftActionResult> {
  const auth = await resolveStaffContext("manager", { branchScoped: true });
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv() || !isUuid(input.runId) || !isOperatorDraftWorkflow(input.workflow)) {
    return { ok: false, message: "Old draft could not be closed." };
  }

  const supabase = createSupabaseServiceClient();
  const changed = await supabase
    .from("operator_workflow_runs")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", input.runId)
    .eq("branch_id", auth.branchId)
    .eq("operator_id", auth.profile.id)
    .eq("workflow", input.workflow)
    .eq("status", "in_progress")
    .select("status")
    .maybeSingle<{ status: "abandoned" }>();

  if (changed.error) {
    console.error("[operator-draft] abandon failed", { workflow: input.workflow, error: changed.error.message });
    return { ok: false, message: "Old draft could not be closed." };
  }
  if (!changed.data) {
    const current = await supabase
      .from("operator_workflow_runs")
      .select("status")
      .eq("id", input.runId)
      .eq("branch_id", auth.branchId)
      .eq("operator_id", auth.profile.id)
      .eq("workflow", input.workflow)
      .maybeSingle<{ status: "in_progress" | "completed" | "abandoned" }>();
    if (current.error) {
      console.error("[operator-draft] abandon reread failed", {
        workflow: input.workflow,
        error: current.error.message,
      });
      return { ok: false, message: "Old draft could not be closed." };
    }
    if (current.data?.status === "abandoned") return { ok: true, state: "abandoned" };
    if (current.data?.status === "completed") {
      return { ok: false, message: "This work was already completed." };
    }
    return { ok: false, message: "Old draft could not be closed." };
  }

  return { ok: true, state: "abandoned" };
}
