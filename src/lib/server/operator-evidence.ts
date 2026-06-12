import "server-only";

import type { OperatorEvidenceStatus, OperatorEvidenceType } from "@/lib/operator/evidence-types";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type OperatorEvidence = {
  id: string;
  branchId: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  evidenceType: OperatorEvidenceType;
  sourceType: string;
  sourceId: string | null;
  sourceRef: string | null;
  status: OperatorEvidenceStatus;
  reviewRequired: boolean;
  failureReason: string | null;
  uploadedByName: string | null;
  signedUrl: string | null;
  createdAt: string;
};

type EvidenceRow = {
  id: string;
  branch_id: string;
  bucket: string;
  object_path: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | string | null;
  evidence_type: OperatorEvidenceType;
  source_type: string;
  source_id: string | null;
  source_ref: string | null;
  status: OperatorEvidenceStatus;
  review_required: boolean | null;
  failure_reason: string | null;
  created_at: string;
  uploader: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function getOperatorEvidence(branchId: string): Promise<OperatorEvidence[]> {
  if (!hasSupabaseServiceEnv()) return [];

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("operator_evidence")
    .select(
      `
      id, branch_id, bucket, object_path, file_name, content_type, size_bytes,
      evidence_type, source_type, source_id, source_ref, status,
      review_required, failure_reason, created_at,
      uploader:profiles!operator_evidence_uploaded_by_fkey(full_name, email)
    `,
    )
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  const rows = data as EvidenceRow[];
  const signed = await Promise.all(
    rows.map(async (row) => {
      if (!row.object_path || row.status === "deleted" || row.status === "failed") return null;
      const { data: signedData } = await supabase.storage.from(row.bucket).createSignedUrl(row.object_path, 60 * 10);
      return signedData?.signedUrl ?? null;
    }),
  );

  return rows.map((row, index) => {
    const uploader = first(row.uploader);
    return {
      id: row.id,
      branchId: row.branch_id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      evidenceType: row.evidence_type,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceRef: row.source_ref,
      status: row.status,
      reviewRequired: row.review_required ?? false,
      failureReason: row.failure_reason,
      uploadedByName: uploader?.full_name ?? uploader?.email ?? null,
      signedUrl: signed[index],
      createdAt: row.created_at,
    };
  });
}
