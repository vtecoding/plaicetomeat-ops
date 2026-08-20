"use server";

import { revalidatePath } from "next/cache";

import { uploadOperatorEvidence } from "@/app/actions/operator/evidence";
import {
  isUuid,
  type OperatorActionResult,
} from "@/app/actions/operator/escalation";
import type { OperatorEvidenceType } from "@/lib/operator/evidence-types";
import { assertProductionMutationAllowed } from "@/lib/operator/execution-context";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const PAPER_TYPES = new Set(["halal", "supplier", "fridge", "other"]);

function valueFrom(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function paperLabel(kind: string) {
  if (kind === "halal") return "Halal paper";
  if (kind === "supplier") return "Supplier paper";
  if (kind === "fridge") return "Fridge paper";
  return "Other paper";
}

function evidenceType(kind: string): OperatorEvidenceType {
  if (kind === "halal") return "certificate";
  if (kind === "supplier") return "supplier_document";
  if (kind === "fridge") return "fridge_check";
  return "other";
}

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

export async function capturePaperPhoto(formData: FormData): Promise<OperatorActionResult> {
  assertProductionMutationAllowed(
    valueFrom(formData, "executionMode") === "live" ? { mode: "live" } : undefined,
    "operator-capture-certificate",
  );
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };

  const runId = valueFrom(formData, "runId");
  if (!isUuid(runId)) return { ok: false, message: "Go back and try again." };
  const safeRunId: string = runId ?? "";

  const rawKind = valueFrom(formData, "paperKind") ?? "other";
  const paperKind = PAPER_TYPES.has(rawKind) ? rawKind : "other";
  const label = paperLabel(paperKind);

  const service = createSupabaseServiceClient();
  const { data: existingRun } = await service
    .from("operator_workflow_runs")
    .select("branch_id,status,operator_id,workflow,steps,result_ref,completion_receipt")
    .eq("id", safeRunId)
    .maybeSingle<{
      branch_id: string;
      status: string;
      operator_id: string;
      workflow: string;
      steps: Record<string, unknown> | null;
      result_ref: string | null;
      completion_receipt: Record<string, unknown> | null;
    }>();
  if (existingRun && (existingRun.branch_id !== auth.branchId
      || existingRun.operator_id !== auth.profileId
      || existingRun.workflow !== "certificate")) {
    return { ok: false, message: "This paper run belongs to different work. Start fresh." };
  }
  if (existingRun?.status === "abandoned") {
    return { ok: false, message: "This paper run was replaced. Start fresh." };
  }
  if (existingRun?.status === "completed") {
    if (existingRun.steps?.paperKind !== paperKind) {
      return { ok: false, message: "This paper was already saved with different details." };
    }
    const replayId = String(
      existingRun.completion_receipt?.document_id
        ?? existingRun.result_ref?.replace(/^compliance_document:/, "")
        ?? safeRunId,
    );
    return { ok: true, message: "Saved. Owner will check it.", id: replayId, needsOwner: true };
  }

  const { data: existingEvidence } = await service
    .from("operator_evidence")
    .select("id,object_path,evidence_type")
    .eq("branch_id", auth.branchId)
    .eq("uploaded_by", auth.profileId)
    .eq("source_type", "operator_workflow_run")
    .eq("source_id", safeRunId)
    .eq("evidence_type", evidenceType(paperKind))
    .not("object_path", "is", null)
    .in("status", ["uploaded", "needs_owner_review"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; object_path: string; evidence_type: string }>();

  let evidenceId = existingEvidence?.id ?? null;
  if (!evidenceId) {
    const uploadData = new FormData();
    const file = formData.get("file");
    if (file) uploadData.set("file", file);
    uploadData.set("evidenceType", evidenceType(paperKind));
    uploadData.set("sourceType", "operator_workflow_run");
    uploadData.set("sourceId", safeRunId);
    uploadData.set("sourceRef", label);
    uploadData.set("operationId", safeRunId);
    uploadData.set("executionMode", "live");

    const upload = await uploadOperatorEvidence(uploadData);
    if (!upload.ok) {
      if (upload.code !== "evidence_row_conflict") return upload;
      // Another copy of the same request can finish the run after our initial
      // replay check but before this upload observes the deterministic evidence
      // row. Re-read the database fence before reporting a false failure.
      const { data: racedRun } = await service
        .from("operator_workflow_runs")
        .select("status,operator_id,workflow,steps,result_ref,completion_receipt")
        .eq("id", safeRunId)
        .eq("branch_id", auth.branchId)
        .maybeSingle<{
          status: string;
          operator_id: string;
          workflow: string;
          steps: Record<string, unknown> | null;
          result_ref: string | null;
          completion_receipt: Record<string, unknown> | null;
        }>();
      if (racedRun?.status === "completed") {
        if (racedRun.operator_id !== auth.profileId || racedRun.workflow !== "certificate"
            || racedRun.steps?.paperKind !== paperKind) {
          return { ok: false, message: "This paper was already saved with different details." };
        }
        const replayId = String(
          racedRun.completion_receipt?.document_id
            ?? racedRun.result_ref?.replace(/^compliance_document:/, "")
            ?? safeRunId,
        );
        return { ok: true, message: "Saved. Owner will check it.", id: replayId, needsOwner: true };
      }
      return upload;
    }
    evidenceId = upload.id;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_operator_certificate_v18", {
    p_run_id: safeRunId,
    p_branch_id: auth.branchId,
    p_evidence_id: evidenceId,
    p_paper_kind: paperKind,
  });
  if (error || !data) {
    return { ok: false, message: "Photo saved, but the paper did not finish. Try again." };
  }
  const receipt = data as { document_id?: string; id?: string };
  const documentId = receipt.document_id ?? receipt.id;
  if (!documentId) return { ok: false, message: "Photo saved, but the paper did not finish. Try again." };

  revalidatePath("/operator");
  revalidatePath("/operator/certificate");
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  revalidatePath("/admin/evidence");
  revalidatePath("/admin/compliance");

  return {
    ok: true,
    message: "Saved. Owner will check it.",
    id: documentId,
    needsOwner: true,
  };
}
