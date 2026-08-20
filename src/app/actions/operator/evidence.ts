"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomUUID } from "node:crypto";

import { isUuid, simpleText } from "@/app/actions/operator/escalation";
import type {
  OperatorEvidenceSourceType,
  OperatorEvidenceType,
  OperatorEvidenceUploadResult,
} from "@/lib/operator/evidence-types";
import { assertProductionMutationAllowed, type ExecutionContext } from "@/lib/operator/execution-context";
import { resolveStaffContext } from "@/lib/server/staff-context";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
  hasSupabaseServiceEnv,
} from "@/lib/supabase/server";

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
  const evidenceId = randomUUID();
  const { data, error } = await supabase.rpc("record_operator_evidence_failure_v18", {
    p_evidence_id: evidenceId,
    p_branch_id: input.branchId,
    p_actor_id: input.profileId,
    p_file_name: input.fileName,
    p_content_type: input.contentType,
    p_size_bytes: input.sizeBytes,
    p_evidence_type: input.evidenceType,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_source_ref: input.sourceRef,
    p_reason: input.reason,
  });
  const result = data as { id?: string } | null;
  return error ? null : result?.id ?? null;
}

export async function uploadOperatorEvidence(formData: FormData): Promise<OperatorEvidenceUploadResult> {
  assertProductionMutationAllowed(
    valueFrom(formData, "executionMode") === "live" ? { mode: "live" } : undefined,
    "operator-upload-evidence",
  );
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
  if (sourceTypeRaw !== "operator_workflow_run") {
    return { ok: false, message: "Photo details are not valid." };
  }
  const sourceType: OperatorEvidenceSourceType = "operator_workflow_run";
  const safeSourceId = isUuid(sourceId) ? sourceId : null;
  const operationId = valueFrom(formData, "operationId");
  if (!safeSourceId || !isUuid(operationId) || operationId !== safeSourceId) {
    return { ok: false, message: "Photo details are not valid." };
  }
  const deterministicOperationId = operationId;

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
  const fileSha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  const now = new Date();
  const folder = `${auth.branchId}/${now.toISOString().slice(0, 10)}/${cleanSegment(sourceType, "source")}`;
  const evidenceId = deterministicOperationId ?? randomUUID();
  const objectPath = deterministicOperationId
    ? `${auth.branchId}/operations/${cleanSegment(sourceType, "source")}/${deterministicOperationId}`
    : `${folder}/${randomUUID()}.${extensionFor(file)}`;
  const upload = await supabase.storage.from(BUCKET).upload(objectPath, file, {
    contentType: file.type,
    upsert: false,
  });

  let objectExists = !upload.error;
  let objectConflict = false;
  if (upload.error && deterministicOperationId) {
    // A provider error can mean either a real failure or that another copy of
    // this request already created the deterministic object. Downloading and
    // hashing the stored bytes proves which case this is and prevents the
    // upload loser from writing evidence metadata for a different photo.
    const stored = await supabase.storage.from(BUCKET).download(objectPath);
    if (!stored.error && stored.data) {
      const storedSha256 = createHash("sha256")
        .update(Buffer.from(await stored.data.arrayBuffer()))
        .digest("hex");
      objectExists = storedSha256 === fileSha256;
      objectConflict = storedSha256 !== fileSha256;
    }
  }
  if (objectConflict) {
    return { ok: false, message: "This paper run already has a different photo. Start fresh." };
  }
  if (!objectExists) {
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
      reason: (upload.error?.message ?? "storage object unavailable").slice(0, 240),
    });
    return { ok: false, id: id ?? undefined, message: "Photo did not save. Try again or skip for now." };
  }

  const { data, error } = await supabase.rpc("finalize_operator_evidence_upload_v18", {
    p_evidence_id: evidenceId,
    p_branch_id: auth.branchId,
    p_actor_id: auth.profileId,
    p_bucket: BUCKET,
    p_object_path: objectPath,
    p_file_name: fileName,
    p_content_type: file.type,
    p_size_bytes: file.size,
    p_evidence_type: evidenceType,
    p_source_type: sourceType,
    p_source_id: safeSourceId,
    p_source_ref: sourceRef,
    p_sha256: fileSha256,
  });
  const finalized = data as { id?: string; created?: boolean } | null;

  if (error || !finalized?.id) {
    if (!deterministicOperationId) await supabase.storage.from(BUCKET).remove([objectPath]);
    return {
      ok: false,
      code: deterministicOperationId ? "evidence_row_conflict" : undefined,
      message: "Photo saved, but the record did not save. Try again.",
    };
  }

  revalidatePath("/admin/evidence");
  return { ok: true, id: finalized.id, fileName, message: "Photo saved." };
}

export async function linkOperatorEvidence(input: {
  evidenceId: string | null | undefined;
  expectedRunId: string;
  sourceType: OperatorEvidenceSourceType;
  sourceId: string;
  sourceRef?: string | null;
  reviewRequired?: boolean;
  executionContext?: ExecutionContext;
}) {
  assertProductionMutationAllowed(input.executionContext, "operator-link-evidence");
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.evidenceId) || !isUuid(input.expectedRunId) || !isUuid(input.sourceId)) {
    return { ok: false, message: "Photo link is not valid." };
  }
  if (!SOURCE_TYPES.has(input.sourceType)) return { ok: false, message: "Photo link is not valid." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("link_operator_evidence_v18", {
    p_evidence_id: input.evidenceId,
    p_branch_id: auth.branchId,
    p_expected_run_id: input.expectedRunId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_source_ref: simpleText(input.sourceRef, 160),
    p_review_required: input.reviewRequired ?? false,
  });

  if (error) return { ok: false, message: "Photo saved, but it did not link. The owner can still see it." };

  const receipt = (data ?? {}) as {
    needs_owner?: boolean;
    owner_alert_resolved?: boolean;
    replayed?: boolean;
  };
  revalidatePath("/admin/evidence");
  return {
    ok: true,
    message: "Photo linked.",
    needsOwner: receipt.needs_owner,
    ownerAlertResolved: receipt.owner_alert_resolved ?? false,
    replayed: receipt.replayed ?? false,
  };
}

export async function deleteOperatorEvidence(input: { evidenceId: string }) {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Photo storage is not ready." };
  if (!isUuid(input.evidenceId)) return { ok: false, message: "Photo record is not valid." };

  const supabase = createSupabaseServiceClient();
  const { data: requested, error: requestError } = await supabase.rpc("request_operator_evidence_delete_v18", {
    p_evidence_id: input.evidenceId,
    p_branch_id: auth.branchId,
    p_actor_id: auth.profileId,
  });
  const request = requested as {
    id?: string;
    bucket?: string;
    objectPath?: string | null;
    alreadyDeleted?: boolean;
  } | null;
  if (requestError || !request?.id) {
    const protectedEvidence = requestError?.message.includes("Linked or compliance evidence");
    return {
      ok: false,
      message: protectedEvidence
        ? "Linked delivery, waste and compliance proof cannot be deleted here."
        : "Could not request photo deletion.",
    };
  }
  if (request.alreadyDeleted) return { ok: true, message: "Photo already deleted." };

  if (request.objectPath) {
    const remove = await supabase.storage.from(request.bucket ?? BUCKET).remove([request.objectPath]);
    if (remove.error) {
      revalidatePath("/admin/evidence");
      return { ok: false, message: "Photo deletion is waiting. Try delete again." };
    }
  }

  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_operator_evidence_delete_v18", {
    p_evidence_id: input.evidenceId,
    p_branch_id: auth.branchId,
    p_actor_id: auth.profileId,
  });
  const completion = finalized as { id?: string } | null;
  if (finalizeError || !completion?.id) {
    revalidatePath("/admin/evidence");
    return { ok: false, message: "Photo was removed; its record is waiting to finish. Try delete again." };
  }

  revalidatePath("/admin/evidence");
  return { ok: true, message: "Photo deleted." };
}
