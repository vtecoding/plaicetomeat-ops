"use server";

import { revalidatePath } from "next/cache";

import { linkOperatorEvidence, uploadOperatorEvidence } from "@/app/actions/operator/evidence";
import {
  auditOperatorRun,
  createOwnerAlert,
  isUuid,
  saveOperatorRun,
  simpleText,
  type OperatorActionResult,
} from "@/app/actions/operator/escalation";
import type { OperatorEvidenceType } from "@/lib/operator/evidence-types";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

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
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };

  const runId = valueFrom(formData, "runId");
  if (!isUuid(runId)) return { ok: false, message: "Go back and try again." };
  const safeRunId: string = runId ?? "";

  const rawKind = valueFrom(formData, "paperKind") ?? "other";
  const paperKind = PAPER_TYPES.has(rawKind) ? rawKind : "other";
  const label = paperLabel(paperKind);

  const uploadData = new FormData();
  const file = formData.get("file");
  if (file) uploadData.set("file", file);
  uploadData.set("evidenceType", evidenceType(paperKind));
  uploadData.set("sourceType", "operator_workflow_run");
  uploadData.set("sourceId", safeRunId);
  uploadData.set("sourceRef", label);

  const upload = await uploadOperatorEvidence(uploadData);
  if (!upload.ok) return upload;

  const supabase = createSupabaseServiceClient();
  const { data: doc, error } = await supabase
    .from("compliance_documents")
    .insert({
      branch_id: auth.branchId,
      document_url: `operator_evidence:${upload.id}`,
      doc_type: simpleText(paperKind, 40),
      status: "needs_owner_review",
      uploaded_by: auth.profileId,
    })
    .select("id")
    .single<{ id: string }>();

  if (doc?.id) {
    await linkOperatorEvidence({
      evidenceId: upload.id,
      sourceType: "compliance_document",
      sourceId: doc.id,
      sourceRef: label,
      reviewRequired: true,
    });

    await createOwnerAlert({
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_document_review",
      summary: `${label} was saved for owner review.`,
      entityRef: doc.id,
      metadata: { documentId: doc.id, evidenceId: upload.id, paperKind },
    });
  }

  await saveOperatorRun({
    runId: safeRunId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "certificate",
    status: "completed",
    steps: { paperKind, evidenceId: upload.id, documentId: doc?.id ?? null, documentSaved: !error },
    resultRef: doc?.id ? `compliance_document:${doc.id}` : `operator_evidence:${upload.id}`,
  });
  await auditOperatorRun({
    runId: safeRunId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "certificate",
    metadata: { paperKind, evidenceId: upload.id, documentId: doc?.id ?? null },
  });

  revalidatePath("/operator");
  revalidatePath("/operator/certificate");
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  revalidatePath("/admin/evidence");
  revalidatePath("/admin/compliance");

  return {
    ok: true,
    message: doc?.id ? "Saved. Owner will check it." : "Photo saved. Owner will check it.",
    id: doc?.id ?? upload.id,
    needsOwner: true,
  };
}
