import "server-only";

import {
  operatorDraftBusinessDate,
  type OperatorDraftRecord,
  type OperatorDraftWorkflow,
} from "@/lib/operator/workflows/drafts";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type DraftRow = {
  id: string;
  workflow: OperatorDraftWorkflow;
  steps: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export async function getLatestOperatorDraft(input: {
  branchId: string;
  operatorId: string;
  workflow: OperatorDraftWorkflow;
  now?: Date;
}): Promise<OperatorDraftRecord | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createSupabaseServiceClient();
  const branch = await supabase.from("branches").select("timezone").eq("id", input.branchId).maybeSingle<{ timezone: string | null }>();
  const timezone = branch.data?.timezone || "Europe/London";
  const today = operatorDraftBusinessDate(input.now ?? new Date(), timezone);

  // A bounded read is enough because completed/abandoned rows are excluded and
  // this UX table is tiny. Filtering by the branch-local creation day prevents a
  // stale run from yesterday being offered after midnight.
  const rows = await supabase
    .from("operator_workflow_runs")
    .select("id,workflow,steps,created_at,updated_at")
    .eq("branch_id", input.branchId)
    .eq("operator_id", input.operatorId)
    .eq("workflow", input.workflow)
    .eq("status", "in_progress")
    .order("updated_at", { ascending: false })
    .limit(20)
    .returns<DraftRow[]>();

  if (rows.error) {
    console.error("[operator-draft] resume read failed", { workflow: input.workflow, error: rows.error.message });
    return null;
  }

  const latest = (rows.data ?? []).find((row) => operatorDraftBusinessDate(new Date(row.created_at), timezone) === today && row.steps);
  if (!latest?.steps) return null;

  return {
    runId: latest.id,
    workflow: latest.workflow,
    steps: latest.steps,
    updatedAt: latest.updated_at,
  };
}
