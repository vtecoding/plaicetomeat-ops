import "server-only";

import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type CarcassIntakeSummary = {
  id: string;
  animalType: string;
  intakeType: string;
  receivedWeightKg: number;
  totalCostGbp: number;
  blendedCostPerKg: number | null;
  processingLossKg: number | null;
  receivedAt: string;
  confirmedAt: string | null;
  stockCuts: number;
  reviewCuts: number;
};

type IntakeRow = {
  id: string;
  animal_type: string;
  intake_type: string;
  received_weight_kg: number | string;
  total_cost_gbp: number | string;
  blended_cost_per_kg: number | string | null;
  processing_loss_kg: number | string | null;
  received_at: string;
  confirmed_at: string | null;
  cuts: { is_waste: boolean; product_id: string | null; batch_id: string | null; expected_weight_kg: number | string }[] | null;
};

/** Recent confirmed carcass intakes for a branch — makes intake a first-class,
 *  queryable record rather than data hidden inside batches. */
export async function getRecentCarcassIntakes(branchId: string, limit = 5): Promise<CarcassIntakeSummary[]> {
  if (!hasSupabaseServiceEnv()) return [];

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("carcass_intakes")
    .select(`
      id, animal_type, intake_type, received_weight_kg, total_cost_gbp,
      blended_cost_per_kg, processing_loss_kg, received_at, confirmed_at,
      cuts:carcass_intake_cuts(is_waste, product_id, batch_id, expected_weight_kg)
    `)
    .eq("branch_id", branchId)
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as IntakeRow[]).map((row) => {
    const cuts = row.cuts ?? [];
    const stockCuts = cuts.filter((cut) => !cut.is_waste && cut.batch_id).length;
    const reviewCuts = cuts.filter((cut) => !cut.is_waste && !cut.product_id && Number(cut.expected_weight_kg) > 0).length;
    return {
      id: row.id,
      animalType: row.animal_type,
      intakeType: row.intake_type,
      receivedWeightKg: Number(row.received_weight_kg),
      totalCostGbp: Number(row.total_cost_gbp),
      blendedCostPerKg: row.blended_cost_per_kg == null ? null : Number(row.blended_cost_per_kg),
      processingLossKg: row.processing_loss_kg == null ? null : Number(row.processing_loss_kg),
      receivedAt: row.received_at,
      confirmedAt: row.confirmed_at,
      stockCuts,
      reviewCuts,
    };
  });
}
