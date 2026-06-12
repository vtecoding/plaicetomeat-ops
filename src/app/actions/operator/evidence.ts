"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { createOwnerAlert, isUuid, simpleText } from "@/app/actions/operator/escalation";
import { emitAuditLog } from "@/lib/server/audit";
import type {
  OperatorEvidenceSourceType,
  OperatorEvidenceType,
  OperatorEvidenceUploadResult,
} from "@/lib/operator/evidence-types";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const BUCKET = "operator-evidence";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const EVIDENCE_TYPES = new Set(["delivery_note", "supplier_document", "certificate", "fridge_check", "waste_photo", "other"]);
const SOURCE_TYPES = new Set([
  "operator_workflow_run",
  "inventory_batch",
  "waste_event",
  "compliance_log",
  "supplier_document",
  "compliance_document",
]);

async function requireManager() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

function cleanSegment(value: string | null | undefined, fallback: string) {
  return (value ?? fallback).replace(/[^a-z0-9._-]/gi, "-").replace(/-+/g, "-").slice(0, 80) || fallback;
}

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic") return "heic";
  if (file.type === "image/heif") return "heif";
  return "jpg";
}

function valueFrom(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

async function recordFailedUpload(input: {
  branchId: string;
  profileId: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  evidenceType: OperatorEvidenceType;
  sourceType: OperatorEvidenceSourceType;
  sourceId: string | null;
  sourceRef: string | null;
  reason: string;
}) {
  if (!hasSupabaseServiceEnv()) return null;

  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("operator_evidence")
    .insert({
      branch_id: input.branchId,
      bucket: BUCKET,
      object_path: null,
      file_name: input.fileName,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      evidence_type: input.evidenceType,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_ref: input.sourceRef,
      status: "failed",
      review_required: true,
      failure_reason: input.reason,
      uploaded_by: input.profileId,
    })
    .select("id")
    .single<{ id: string }>();

  if (data?.id) {
    await emitAuditLog({
      eventType: "evidence_upload_failed",
      targetType: "operator_evidence",
      targetId: data.id,
      branchId: input.branchId,
      metadata: { evidence_type: input.evidenceType, source_type: input.sourceType, reason: input.reason },
      systemReason: "operator_evidence_upload",
    });
  }

  return data?.id ?? null;
}

export async function uploadOperatorEvidence(formData: FormData): Promise<OperatorEvidenceUploadResult> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Photo storage is not ready." };

  const fileValue = formData.get("file");
  const file = fileValue instanceof File ? fileValue : null;
  const evidenceTypeRaw = valueFrom(formData, "evidenceType") ?? "other";
  const sourceTypeRaw = valueFrom(formData, "sourceType") ?? "operator_workflow_run";
  const sourceId = valueFrom(formData, "sourceId");
  const sourceRef = simpleText(valueFrom(formData, "sourceRef"), 160);
  const evidenceType = (EVIDENCE_TYPES.has(evidenceTypeRaw) ? evidenceTypeRaw : "other") as OperatorEvidenceType;
  const sourceType = (SOURCE_TYPES.has(sourceTypeRaw) ? sourceTypeRaw : "operator_workflow_run") as OperatorEvidenceSourceType;
  const safeSourceId = isUuid(sourceId) ? sourceId : null;

  if (!file || file.size === 0) {
    return { ok: false, message: "Choose a photo first." };
  }

  const fileName = simpleText(file.name, 160) ?? "photo";
  if (file.size > MAX_BYTES) {
    const id = await recordFailedUpload({
      branchId: auth.branchId,
      profileId: auth.profileId,
      fileName,
      contentType: file.type || null,
      sizeBytes: file.size,
      evidenceType,
      sourceType,
      sourceId: safeSourceId,
      sourceRef,
      reason: "file_too_large",
    });
    return { ok: false, id: id ?? undefined, message: "Photo is too large. Try a smaller photo or skip for now." };
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    const id = await recordFailedUpload({
      branchId: auth.branchId,
      profileId: auth.profileId,
      fileName,
      contentType: file.type || null,
      sizeBytes: file.size,
      evidenceType,
      sourceType,
      sourceId: safeSourceId,
      sourceRef,
      reason: "unsupported_file_type",
    });
    return { ok: false, id: id ?? undefined, message: "That photo type is not supported. Try another photo or skip for now." };
  }

  const supabase = createSupabaseServiceClient();
  const now = new Date();
  const folder = `${auth.branchId}/${now.toISOString().slice(0, 10)}/${cleanSegment(sourceType, "source")}`;
  const objectPath = `${folder}/${randomUUID()}.${extensionFor(file)}`;
  const upload = await supabase.storage.from(BUCKET).upload(objectPath, file, {
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) {
    const id = await recordFailedUpload({
      branchId: auth.branchId,
      profileId: auth.profileId,
      fileName,
      contentType: file.type || null,
      sizeBytes: file.size,
      evidenceType,
      sourceType,
      sourceId: safeSourceId,
      sourceRef,
      reason: upload.error.message.slice(0, 240),
    });
    return { ok: false, id: id ?? undefined, message: "Photo did not save. Try again or skip for now." };
  }

  const reviewRequired = evidenceType === "certificate" || evidenceType === "supplier_document" || evidenceType === "other";
  const { data, error } = await supabase
    .from("operator_evidence")
    .insert({
      branch_id: auth.branchId,
      bucket: BUCKET,
      object_path: objectPath,
      file_name: fileName,
      content_type: file.type,
      size_bytes: file.size,
      evidence_type: evidenceType,
      source_type: sourceType,
      source_id: safeSourceId,
      source_ref: sourceRef,
      status: reviewRequired ? "needs_owner_review" : "uploaded",
      review_required: reviewRequired,
      uploaded_by: auth.profileId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data?.id) {
    await supabase.storage.from(BUCKET).remove([objectPath]);
    return { ok: false, message: "Photo saved, but the record did not save. Try again." };
  }

  await emitAuditLog({
    eventType: "evidence_uploaded",
    targetType: "operator_evidence",
    targetId: data.id,
    branchId: auth.branchId,
    metadata: { evidence_type: evidenceType, source_type: sourceType, source_id: safeSourceId, file_name: fileName },
    systemReason: "operator_evidence_upload",
  });

  if (reviewRequired) {
    await createOwnerAlert({
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_evidence_review",
      summary: "A photo was saved for owner review.",
      entityRef: data.id,
      eventType: "evidence_uploaded",
      metadata: { evidence_type: evidenceType, source_type: sourceType },
    });
  }

  revalidatePath("/admin/evidence");
  return { ok: true, id: data.id, fileName, message: "Photo saved." };
}

export async function linkOperatorEvidence(input: {
  evidenceId: string | null | undefined;
  sourceType: OperatorEvidenceSourceType;
  sourceId: string;
  sourceRef?: string | null;
  reviewRequired?: boolean;
}) {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Photo storage is not ready." };
  if (!isUuid(input.evidenceId) || !isUuid(input.sourceId)) return { ok: false, message: "Photo link is not valid." };
  if (!SOURCE_TYPES.has(input.sourceType)) return { ok: false, message: "Photo link is not valid." };

  const supabase = createSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("operator_evidence")
    .select("id,branch_id,status")
    .eq("id", input.evidenceId)
    .maybeSingle<{ id: string; branch_id: string; status: string }>();

  if (!existing || existing.branch_id !== auth.branchId || existing.status === "deleted" || existing.status === "failed") {
    return { ok: false, message: "Photo link is not available." };
  }

  const status = input.reviewRequired ? "needs_owner_review" : "linked";
  const { error } = await supabase
    .from("operator_evidence")
    .update({
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_ref: simpleText(input.sourceRef, 160),
      status,
      review_required: input.reviewRequired ?? false,
      linked_at: new Date().toISOString(),
    })
    .eq("id", input.evidenceId)
    .eq("branch_id", auth.branchId);

  if (error) return { ok: false, message: "Photo saved, but it did not link. The owner can still see it." };

  await emitAuditLog({
    eventType: "evidence_linked",
    targetType: "operator_evidence",
    targetId: input.evidenceId,
    branchId: auth.branchId,
    metadata: { source_type: input.sourceType, source_id: input.sourceId, source_ref: input.sourceRef ?? null },
    systemReason: "operator_evidence_link",
  });

  revalidatePath("/admin/evidence");
  return { ok: true, message: "Photo linked." };
}

export async function deleteOperatorEvidence(input: { evidenceId: string }) {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Photo storage is not ready." };
  if (!isUuid(input.evidenceId)) return { ok: false, message: "Photo record is not valid." };

  const supabase = createSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("operator_evidence")
    .select("id,branch_id,bucket,object_path,status")
    .eq("id", input.evidenceId)
    .maybeSingle<{ id: string; branch_id: string; bucket: string; object_path: string | null; status: string }>();

  if (!existing || existing.branch_id !== auth.branchId) return { ok: false, message: "Photo not found." };
  if (existing.status === "deleted") return { ok: true, message: "Photo already deleted." };

  if (existing.object_path) {
    const remove = await supabase.storage.from(existing.bucket).remove([existing.object_path]);
    if (remove.error) return { ok: false, message: "Could not delete the stored photo." };
  }

  const { error } = await supabase
    .from("operator_evidence")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      deleted_by: auth.profileId,
    })
    .eq("id", input.evidenceId)
    .eq("branch_id", auth.branchId);

  if (error) return { ok: false, message: "Could not mark the photo deleted." };

  await emitAuditLog({
    eventType: "evidence_deleted",
    targetType: "operator_evidence",
    targetId: input.evidenceId,
    branchId: auth.branchId,
    metadata: {},
    systemReason: "operator_evidence_delete",
  });

  revalidatePath("/admin/evidence");
  return { ok: true, message: "Photo deleted." };
}
