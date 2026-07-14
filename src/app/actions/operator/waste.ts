"use server";

import {
  isUuid,
  revalidateOperatorOps,
  type OperatorActionResult,
} from "@/app/actions/operator/escalation";
import { linkOperatorEvidence } from "@/app/actions/operator/evidence";
import type { WasteReasonChoice } from "@/lib/operator/workflows/waste";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type WasteCompletion = {
  outcome?: "no_waste" | "owner_check" | "waste";
  id?: string;
  product_name?: string;
  owner_alert_kind?: string;
  needs_owner?: boolean;
  replayed?: boolean;
};

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const, branchId: ctx.branchId, profileId: ctx.profile.id } : ctx;
}

export async function recordNoWaste(input: { runId: string }): Promise<OperatorActionResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Please go back and try again." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_operator_no_waste_v18", {
    p_run_id: input.runId,
    p_branch_id: auth.branchId,
  });
  if (error || !data) return { ok: false, message: "Could not save. Please try again." };
  revalidateOperatorOps();

  const receipt = data as WasteCompletion;
  return { ok: true, message: receipt.replayed ? "Already saved." : "Saved. No waste today.", id: receipt.id ?? input.runId };
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_operator_waste_v18", {
    p_run_id: input.runId,
    p_branch_id: auth.branchId,
    p_product_id: isUuid(input.productId) ? input.productId : null,
    p_quantity_kg: quantity,
    p_reason: input.reason,
    p_photo_evidence_id: photoEvidenceId,
    p_steps: steps,
  });
  if (error || !data) {
    return { ok: false, message: error?.message.includes("different answers") ? "This was already saved with different answers." : "Could not save waste. Please try again." };
  }

  const receipt = data as WasteCompletion;
  if (photoEvidenceId && receipt.outcome === "waste" && receipt.id) {
    await linkOperatorEvidence({
      evidenceId: photoEvidenceId,
      expectedRunId: input.runId,
      sourceType: "waste_event",
      sourceId: receipt.id,
      sourceRef: receipt.product_name ?? "Waste",
      reviewRequired: receipt.needs_owner ?? false,
    });
  }
  revalidateOperatorOps();

  const needsOwner = receipt.needs_owner ?? receipt.outcome === "owner_check";
  return {
    ok: true,
    message: receipt.replayed
      ? "Already saved."
      : receipt.outcome === "owner_check"
        ? "Saved. The owner will check it."
        : needsOwner
          ? "Waste saved. The owner will check it."
          : "Waste saved.",
    id: receipt.id,
    needsOwner,
  };
}
