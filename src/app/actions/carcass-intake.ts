"use server";

import { revalidatePath } from "next/cache";

import { calculateCarcassBreakdown } from "@/lib/butchery/carcass-breakdown";
import { getCutSheet } from "@/lib/butchery/cut-sheets";
import {
  buildIntakePlan,
  buildIntakePreview,
  toRpcCuts,
  validateIntakeInputs,
  type IntakeMapping,
} from "@/lib/domain/carcass-intake";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConfirmIntakeResult =
  | {
      ok: true;
      message: string;
      intakeId: string;
      stockCount: number;
      reviewCount: number;
      processingLossKg: number;
    }
  | { ok: false; message: string };

const SAFE_MESSAGE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Intake type is invalid",
  "Received weight must be",
  "Total cost must be",
  "no saleable cuts",
  "Expiry date cannot be",
  "Supplier not found",
  "No cuts to confirm",
  "already confirmed",
  "linked product no longer exists",
  "cut weight cannot be negative",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_MESSAGE_PATTERNS.some((p) => raw.includes(p))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

export type ConfirmIntakeInput = {
  branchId: string;
  animalId: string;
  intakeType: string;
  supplierId?: string | null;
  weightKg: number;
  costGbp: number;
  daysHung?: number;
  receivedAt: string;
  expiryDate: string;
  notes?: string | null;
  idempotencyKey: string;
  mapping: Record<string, IntakeMapping>;
  /** Effective per-cut margins shown to the operator, so server pricing matches the preview. */
  marginOverrides?: Record<string, number>;
};

/**
 * Confirm a carcass intake. The server is authoritative: it recomputes the
 * breakdown from the animal/weight/cost itself (the client cannot inject costs or
 * weights), builds the plan, and calls one atomic RPC that creates per-cut stock,
 * optional product cost/price updates, and the audit record — all or nothing.
 */
export async function confirmCarcassIntake(input: ConfirmIntakeInput): Promise<ConfirmIntakeResult> {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };

  const sheet = getCutSheet(input.animalId);
  if (!sheet) return { ok: false, message: "Choose a valid animal before confirming." };

  const daysHung = Number.isFinite(input.daysHung) ? Number(input.daysHung) : 0;
  const breakdown = calculateCarcassBreakdown({
    sheet,
    carcassWeightKg: Number(input.weightKg),
    carcassCost: Number(input.costGbp),
    daysHung,
    marginOverrides: input.marginOverrides,
  });
  if (!breakdown.ok) return { ok: false, message: breakdown.message };

  const inputError = validateIntakeInputs({
    intakeType: input.intakeType,
    receivedWeightKg: breakdown.carcassWeightKg,
    totalCostGbp: breakdown.carcassCost,
    receivedAt: input.receivedAt,
    expiryDate: input.expiryDate,
    saleableWeightKg: breakdown.saleableKg,
  });
  if (inputError) return { ok: false, message: inputError };

  const plan = buildIntakePlan(breakdown, input.mapping ?? {});
  const preview = buildIntakePreview(plan);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_confirm_carcass_intake", {
    p_branch_id: input.branchId,
    p_animal_type: input.animalId,
    p_intake_type: input.intakeType,
    p_supplier_id: input.supplierId ?? null,
    p_received_weight_kg: breakdown.carcassWeightKg,
    p_total_cost_gbp: breakdown.carcassCost,
    p_days_hung: daysHung,
    p_received_at: input.receivedAt,
    p_default_expiry_date: input.expiryDate,
    p_processed_weight_kg: breakdown.processedWeightKg,
    p_saleable_weight_kg: breakdown.saleableKg,
    p_processing_loss_kg: plan.processingLossKg,
    p_blended_cost_per_kg: breakdown.blendedCostPerKgSaleable,
    p_idempotency_key: input.idempotencyKey,
    p_notes: input.notes ?? null,
    p_cuts: toRpcCuts(plan),
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not confirm this intake. Please try again.") };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/admin/purchasing");
  revalidatePath("/admin/cutting-guide");

  const stockCount = preview.stockLines.length;
  const reviewCount = preview.reviewLines.length;
  const parts = [`Stock created for ${stockCount} cut${stockCount === 1 ? "" : "s"}.`];
  if (reviewCount > 0) parts.push(`${reviewCount} cut${reviewCount === 1 ? "" : "s"} need a product before they can be stocked.`);
  if (plan.processingLossKg > 0) parts.push(`${plan.processingLossKg}kg recorded as processing loss.`);

  return {
    ok: true,
    message: parts.join(" "),
    intakeId: String(data),
    stockCount,
    reviewCount,
    processingLossKg: plan.processingLossKg,
  };
}
