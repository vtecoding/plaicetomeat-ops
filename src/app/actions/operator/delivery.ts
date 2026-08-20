"use server";

import {
  isUuid,
  revalidateOperatorOps,
  type OperatorActionResult,
} from "@/app/actions/operator/escalation";
import { linkOperatorEvidence } from "@/app/actions/operator/evidence";
import { assertProductionMutationAllowed, LIVE_EXECUTION_CONTEXT, type ExecutionContext } from "@/lib/operator/execution-context";
import type { ExpiryChoice, StorageChoice } from "@/lib/operator/workflows/stock";
import { resolveStaffContext } from "@/lib/server/staff-context";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
  hasSupabaseServiceEnv,
} from "@/lib/supabase/server";

type ProductRow = {
  id: string;
  name: string;
  unit_type: string | null;
  inventory_policy: "kg_batch" | "untracked_manual";
};

type DeliveryCompletion = {
  outcome?: "delivery" | "owner_check";
  id?: string;
  product_name?: string;
  needs_owner?: boolean;
  evidence_review_required?: boolean;
  replayed?: boolean;
};

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok
    ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id }
    : ctx;
}

async function getProduct(branchId: string, productId: string) {
  if (!hasSupabaseServiceEnv() || !isUuid(productId)) return null;
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("products")
    .select("id,name,unit_type,inventory_policy")
    .eq("branch_id", branchId)
    .eq("id", productId)
    .maybeSingle<ProductRow>();
  return data ?? null;
}

async function ownerCheck(input: {
  runId: string;
  branchId: string;
  kind: string;
  summary: string;
  steps: Record<string, unknown>;
  message: string;
}): Promise<OperatorActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_operator_owner_check_v18", {
    p_run_id: input.runId,
    p_branch_id: input.branchId,
    p_workflow: "delivery",
    p_kind: input.kind,
    p_summary: input.summary,
    p_steps: input.steps,
  });
  if (error || !data) {
    return {
      ok: false,
      message: error?.message.includes("different answers")
        ? "This was already saved with different answers."
        : "Could not tell the owner. Please try again.",
    };
  }

  const receipt = data as DeliveryCompletion;
  revalidateOperatorOps();
  return {
    ok: true,
    message: receipt.replayed ? "Already saved." : input.message,
    id: receipt.id,
    needsOwner: true,
  };
}

export async function confirmSimpleDelivery(input: {
  runId: string;
  productId: string | null;
  supplierId: string | null;
  quantity: number;
  expiryChoice: ExpiryChoice;
  storageChoice: StorageChoice;
  noteEvidenceId?: string | null;
  // Provenance of each confirm-don't-ask value (last_used, safe_default, manual, etc.).
  // This is audit-only and never changes stock validation.
  sources?: {
    supplier?: string | null;
    storage?: string | null;
    expiry?: string | null;
  } | null;
  executionContext?: ExecutionContext;
}): Promise<OperatorActionResult> {
  assertProductionMutationAllowed(input.executionContext, "operator-confirm-delivery");
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const quantity = Number(input.quantity);
  const noteEvidenceId = isUuid(input.noteEvidenceId) ? input.noteEvidenceId : null;
  const steps = {
    productId: input.productId,
    supplierId: input.supplierId,
    quantity,
    expiryChoice: input.expiryChoice,
    storageChoice: input.storageChoice,
    noteEvidenceId,
    supplierSource: input.sources?.supplier ?? null,
    storageSource: input.sources?.storage ?? null,
    expirySource: input.sources?.expiry ?? null,
  };

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: "Please enter how much arrived." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_operator_delivery_v18", {
    p_run_id: input.runId,
    p_branch_id: auth.branchId,
    p_product_id: isUuid(input.productId) ? input.productId : null,
    p_supplier_id: isUuid(input.supplierId) ? input.supplierId : null,
    p_quantity_kg: quantity,
    p_expiry_choice: input.expiryChoice,
    p_storage_choice: input.storageChoice,
    p_note_evidence_id: noteEvidenceId,
    p_steps: steps,
  });
  if (error || !data) {
    return {
      ok: false,
      message: error?.message.includes("different answers")
        ? "This was already saved with different answers."
        : "Could not save the delivery. Please try again.",
    };
  }

  const receipt = data as DeliveryCompletion;
  let needsOwner = receipt.needs_owner ?? receipt.outcome === "owner_check";
  if (noteEvidenceId && receipt.outcome === "delivery" && receipt.id) {
    const evidenceLink = await linkOperatorEvidence({
      evidenceId: noteEvidenceId,
      expectedRunId: input.runId,
      sourceType: "inventory_batch",
      sourceId: receipt.id,
      sourceRef: receipt.product_name ?? "Delivery",
      reviewRequired: receipt.evidence_review_required ?? false,
      executionContext: LIVE_EXECUTION_CONTEXT,
    });
    if (!evidenceLink.ok) {
      revalidateOperatorOps();
      return {
        ok: false,
        message: "Stock was saved, but the photo did not link. The owner job is still open. Please try again.",
      };
    }
    needsOwner = evidenceLink.needsOwner ?? needsOwner;
  }
  revalidateOperatorOps();

  return {
    ok: true,
    message: receipt.replayed
      ? "Already saved."
      : receipt.outcome === "owner_check"
        ? "Saved. The owner will check it."
        : needsOwner
          ? "Stock added. The owner will check it."
          : "Stock added.",
    id: receipt.id,
    needsOwner,
  };
}

export async function reportRanOut(input: {
  runId: string;
  productId: string | null;
  sure: boolean;
  executionContext?: ExecutionContext;
}): Promise<OperatorActionResult> {
  assertProductionMutationAllowed(input.executionContext, "operator-report-ran-out");
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const product = input.productId ? await getProduct(auth.branchId, input.productId) : null;
  return ownerCheck({
    runId: input.runId,
    branchId: auth.branchId,
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

export async function tellOwnerAboutStock(input: { runId: string; executionContext?: ExecutionContext }): Promise<OperatorActionResult> {
  assertProductionMutationAllowed(input.executionContext, "operator-stock-owner-check");
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  return ownerCheck({
    runId: input.runId,
    branchId: auth.branchId,
    kind: "operator_stock_help_needed",
    summary: "Operator was not sure what happened with stock.",
    steps: { askedForHelp: true },
    message: "Saved. The owner will check it.",
  });
}
