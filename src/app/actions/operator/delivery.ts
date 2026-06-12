"use server";

import { createInventoryBatch } from "@/app/actions/compliance-inventory";
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
import {
  deliveryNeedsOwnerCheck,
  expiryDateFromChoice,
  storageLabel,
  type ExpiryChoice,
  type StorageChoice,
} from "@/lib/operator/workflows/stock";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type ProductRow = { id: string; name: string; unit_type: string | null };
type SupplierRow = { id: string; name: string; active: boolean | null };

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

async function getProduct(branchId: string, productId: string) {
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

async function getSupplier(branchId: string, supplierId: string | null) {
  if (!hasSupabaseServiceEnv() || !isUuid(supplierId)) return null;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id,name,active")
    .eq("branch_id", branchId)
    .eq("id", supplierId)
    .maybeSingle<SupplierRow>();
  return data?.active ? data : null;
}

function todayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
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
    workflow: "delivery",
    status: "completed",
    steps: input.steps,
    resultRef: alertId ? `owner_alert:${alertId}` : null,
  });
  await auditOperatorRun({
    runId: input.runId,
    branchId: input.branchId,
    profileId: input.profileId,
    workflow: "delivery",
    metadata: input.steps,
  });
  revalidateOperatorOps();
  return { ok: true, message: input.message, id: alertId ?? undefined, needsOwner: true };
}

export async function confirmSimpleDelivery(input: {
  runId: string;
  productId: string | null;
  supplierId: string | null;
  quantity: number;
  expiryChoice: ExpiryChoice;
  storageChoice: StorageChoice;
  noteEvidenceId?: string | null;
}): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const completed = await readCompletedRun(input.runId);
  if (completed) return { ok: true, message: "Already saved.", id: completed };

  const quantity = Number(input.quantity);
  const noteEvidenceId = isUuid(input.noteEvidenceId) ? input.noteEvidenceId : null;
  const steps = {
    productId: input.productId,
    supplierId: input.supplierId,
    quantity,
    expiryChoice: input.expiryChoice,
    storageChoice: input.storageChoice,
    noteEvidenceId,
  };

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: "Please enter how much arrived." };
  }

  const product = input.productId ? await getProduct(auth.branchId, input.productId) : null;
  if (!product) {
    return ownerCheck({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_delivery_unknown_product",
      summary: "Delivery arrived, but the product was not clear.",
      steps,
      message: "Saved. The owner will check it.",
    });
  }

  if (product.unit_type !== "kg") {
    return ownerCheck({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_delivery_needs_owner",
      summary: `${product.name} arrived and needs the owner to add it.`,
      steps: { ...steps, productName: product.name, unitType: product.unit_type },
      message: "Saved. The owner will add this one.",
    });
  }

  const supplier = await getSupplier(auth.branchId, input.supplierId);
  if (!supplier) {
    return ownerCheck({
      runId: input.runId,
      branchId: auth.branchId,
      profileId: auth.profileId,
      kind: "operator_delivery_unknown_supplier",
      summary: `${product.name} arrived, but the supplier was not clear.`,
      steps: { ...steps, productName: product.name },
      message: "Saved. The owner will check the supplier.",
    });
  }

  const expiryDate = expiryDateFromChoice(input.expiryChoice);
  const needsOwner = deliveryNeedsOwnerCheck({
    supplierKnown: true,
    expiryChoice: input.expiryChoice,
    storageChoice: input.storageChoice,
    photoProvided: !!noteEvidenceId,
  });
  const note = needsOwner
    ? `Operator delivery needs owner check. Location: ${storageLabel(input.storageChoice)}. Note photo: ${noteEvidenceId ? "yes" : "no"}.`
    : null;

  const res = await createInventoryBatch({
    branchId: auth.branchId,
    productId: product.id,
    supplierId: supplier.id,
    receivedDate: todayIso(),
    expiryDate,
    receivedWeightKg: quantity,
    remainingWeightKg: quantity,
    invoiceCost: 0,
    storageLocation: input.storageChoice === "not_sure" ? null : storageLabel(input.storageChoice),
    batchNumber: `OP-${input.runId.slice(0, 8)}`,
    intakeIdempotencyKey: `operator-delivery:${input.runId}:${product.id}:${quantity}:${expiryDate}`,
    expectedWeightKg: quantity,
    actualReviewNote: note,
  });

  if (!res.ok) return res;

  const evidenceLink =
    noteEvidenceId && res.id
      ? await linkOperatorEvidence({
          evidenceId: noteEvidenceId,
          sourceType: "inventory_batch",
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
      kind: "operator_delivery_check_needed",
      summary: `${product.name} was added. Owner should check the details.`,
      entityRef: input.runId,
      metadata: { ...steps, productName: product.name, supplierName: supplier.name, batchId: res.id, evidenceLinkOk: evidenceLink?.ok ?? null },
    });
  }

  await saveOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "delivery",
    status: "completed",
    steps: { ...steps, productName: product.name, supplierName: supplier.name, batchId: res.id, evidenceLinkOk: evidenceLink?.ok ?? null },
    resultRef: res.id ? `inventory_batch:${res.id}` : alertId ? `owner_alert:${alertId}` : null,
  });
  await auditOperatorRun({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    workflow: "delivery",
    metadata: { productId: product.id, batchId: res.id, needsOwner, evidenceId: noteEvidenceId, evidenceLinkOk: evidenceLink?.ok ?? null },
  });
  revalidateOperatorOps();

  return {
    ok: true,
    message: needsOwner ? "Stock added. The owner will check it." : "Stock added.",
    id: res.id,
    needsOwner,
  };
}

export async function reportRanOut(input: {
  runId: string;
  productId: string | null;
  sure: boolean;
}): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const completed = await readCompletedRun(input.runId);
  if (completed) return { ok: true, message: "Already saved.", id: completed };

  const product = input.productId ? await getProduct(auth.branchId, input.productId) : null;
  return ownerCheck({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    kind: "operator_stock_ran_out",
    summary: product
      ? input.sure
        ? `${product.name} has run out.`
        : `${product.name} may have run out.`
      : "Something ran out, but the product was not clear.",
    steps: { productId: input.productId, productName: product?.name ?? null, sure: input.sure },
    message: "Saved. The owner will check it.",
  });
}

export async function tellOwnerAboutStock(input: { runId: string }): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  return ownerCheck({
    runId: input.runId,
    branchId: auth.branchId,
    profileId: auth.profileId,
    kind: "operator_stock_help_needed",
    summary: "Operator was not sure what happened with stock.",
    steps: { askedForHelp: true },
    message: "Saved. The owner will check it.",
  });
}
