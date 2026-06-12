"use server";

import { recordWaste } from "@/app/actions/compliance-inventory";
import {
  auditOperatorRun,
  createOwnerAlert,
  isUuid,
  readCompletedRun,
  revalidateOperatorOps,
  saveOperatorRun,
  type OperatorActionResult,
} from "@/app/actions/operator/escalation";
import { linkOperatorEvidence } from "@/app/actions/operator/evidence";
import type { WasteReasonChoice } from "@/lib/operator/workflows/waste";
import { wasteReasonLabel } from "@/lib/operator/workflows/waste";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type ProductRow = { id: string; name: string; unit_type: string | null };
type BatchRow = { id: string; remaining_weight_kg: string | number };

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

async function getProduct(branchId: string, productId: string | null) {
  if (!hasSupabaseServiceEnv() || !isUuid(productId)) return null;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("products")
    .select("id,name,unit_type")
    .eq("branch_id", branchId)
    .eq("id", productId)
    .maybeSingle<ProductRow>();
  return data ?? null;
}

async function getWasteBatch(branchId: string, productId: string, quantityKg: number) {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("inventory_batches")
    .select("id,remaining_weight_kg")
    .eq("branch_id", branchId)
    .eq("product_id", productId)
    .eq("status", "active")
    .gte("remaining_weight_kg", quantityKg)
    .order("expiry_date", { ascending: true })
    .limit(1)
    .maybeSingle<BatchRow>();

  return data ?? null;
}

async function ownerCheck(input: {
  runId: string;
  branchId: string;
  profileId: string;
  kind: string;
  summary: string;
  steps: Record<string, unknown>;
  message: string;
}): Promise<OperatorActionResult> {
  const alertId = await createOwnerAlert({
    branchId: input.branchId,
    profileId: input.profileId,
    kind: input.kind,
    summary: input.summary,
    entityRef: input.runId,
    metadata: input.steps,
  });
  await saveOperatorRun({
    runId: input.runId,
    branchId: input.branchId,
    profileId: input.profileId,
    workflow: "waste",
    status: "completed",
    steps: input.steps,
    resultRef: alertId ? `owner_alert:${alertId}` : null,
  });
  await auditOperatorRun({
    runId: input.runId,
    branchId: input.branchId,
    profileId: input.profileId,
    workflow: "waste",
    metadata: input.steps,
  });
  revalidateOperatorOps();
  return { ok: true, message: input.message, id: alertId ?? undefined, needsOwner: true };
}

export async function recordNoWaste(input: { runId: string }): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const completed = await readCompletedRun(input.runId);
  if (completed) return { ok: true, message: "Already saved.", id: completed };

  await saveOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "waste",
    status: "completed",
    steps: { waste: "none" },
    resultRef: "no_waste",
  });
  await auditOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "waste",
    metadata: { waste: "none" },
  });
  revalidateOperatorOps();

  return { ok: true, message: "Saved. No waste today.", id: input.runId };
}

export async function recordSimpleWaste(input: {
  runId: string;
  productId: string | null;
  quantity: number;
  reason: WasteReasonChoice;
  photoEvidenceId?: string | null;
}): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const completed = await readCompletedRun(input.runId);
  if (completed) return { ok: true, message: "Already saved.", id: completed };

  const quantity = Number(input.quantity);
  const photoEvidenceId = isUuid(input.photoEvidenceId) ? input.photoEvidenceId : null;
  const steps = {
    productId: input.productId,
    quantity,
    reason: input.reason,
    photoEvidenceId,
  };

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: "Please enter how much was thrown away." };
  }

  const product = await getProduct(auth.branchId, input.productId);
  if (!product) {
    return ownerCheck({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_waste_unknown_product",
      summary: "Waste was recorded, but the product was not clear.",
      steps,
      message: "Saved. The owner will check it.",
    });
  }

  if (product.unit_type !== "kg") {
    return ownerCheck({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_waste_needs_owner",
      summary: `${product.name} waste needs the owner to check it.`,
      steps: { ...steps, productName: product.name, unitType: product.unit_type },
      message: "Saved. The owner will check it.",
    });
  }

  const batch = await getWasteBatch(auth.branchId, product.id, quantity);
  if (!batch) {
    return ownerCheck({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_waste_no_matching_stock",
      summary: `${product.name} waste was noted, but matching stock was not found.`,
      steps: { ...steps, productName: product.name },
      message: "Saved. The owner will check it.",
    });
  }

  const res = await recordWaste({
    batchId: batch.id,
    quantityKg: quantity,
    reason: input.reason,
  });

  if (!res.ok) return res;

  const needsOwner = input.reason === "review";
  const evidenceLink =
    photoEvidenceId && res.id
      ? await linkOperatorEvidence({
          evidenceId: photoEvidenceId,
          sourceType: "waste_event",
          sourceId: res.id,
          sourceRef: product.name,
          reviewRequired: needsOwner,
        })
      : null;

  let alertId: string | null = null;
  if (needsOwner) {
    alertId = await createOwnerAlert({
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_waste_reason_check",
      summary: `${product.name} waste was saved. Owner should check the reason.`,
      entityRef: input.runId,
      metadata: {
        ...steps,
        productName: product.name,
        batchId: batch.id,
        reasonLabel: wasteReasonLabel(input.reason),
        evidenceLinkOk: evidenceLink?.ok ?? null,
      },
    });
  }

  await saveOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "waste",
    status: "completed",
    steps: { ...steps, productName: product.name, batchId: batch.id, wasteId: res.id, evidenceLinkOk: evidenceLink?.ok ?? null },
    resultRef: res.id ? `waste:${res.id}` : alertId ? `owner_alert:${alertId}` : null,
  });
  await auditOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "waste",
    metadata: {
      productId: product.id,
      batchId: batch.id,
      wasteId: res.id,
      needsOwner: !!alertId,
      evidenceId: photoEvidenceId,
      evidenceLinkOk: evidenceLink?.ok ?? null,
    },
  });
  revalidateOperatorOps();

  return {
    ok: true,
    message: alertId ? "Waste saved. The owner will check it." : "Waste saved.",
    id: res.id,
    needsOwner: !!alertId,
  };
}
