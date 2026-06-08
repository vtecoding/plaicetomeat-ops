import "server-only";

import { healthy, noData, unavailable, type DataResult } from "@/lib/domain/data-result";
import type { PricingValidationDecision, PricingValidationRecord, SpeciesId } from "@/lib/butchery/pricing-validation";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type Row = {
  species: SpeciesId;
  cut_id: string;
  cut_name: string;
  system_yield_pct: string | number;
  system_cost_per_kg: string | number;
  system_price_per_kg: string | number;
  system_margin_pct: string | number;
  butcher_yield_pct: string | number | null;
  butcher_price_per_kg: string | number | null;
  variance_pct: string | number | null;
  decision: PricingValidationDecision;
  notes: string | null;
  butcher_name: string | null;
  reviewed_at: string | null;
};

function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function nullableNum(value: string | number | null): number | null {
  return value === null ? null : num(value);
}

function mapRow(row: Row): PricingValidationRecord {
  return {
    species: row.species,
    cutId: row.cut_id,
    cutName: row.cut_name,
    systemYieldPct: num(row.system_yield_pct),
    systemCostPerKg: num(row.system_cost_per_kg),
    systemPricePerKg: num(row.system_price_per_kg),
    systemMarginPct: num(row.system_margin_pct),
    butcherYieldPct: nullableNum(row.butcher_yield_pct),
    butcherPricePerKg: nullableNum(row.butcher_price_per_kg),
    variancePct: nullableNum(row.variance_pct),
    decision: row.decision,
    notes: row.notes,
    butcherName: row.butcher_name,
    reviewedAt: row.reviewed_at,
  };
}

/**
 * Load the saved butcher pricing-validation records for a branch as an honest
 * DataResult. An unconfigured/erroring environment is UNAVAILABLE (never disguised as
 * an empty review); no records yet is NO_DATA.
 */
export async function getPricingValidations(branchId: string): Promise<DataResult<PricingValidationRecord[]>> {
  if (!hasSupabaseServiceEnv()) {
    return unavailable("Pricing validation records are unavailable until Supabase is configured.");
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pricing_validations")
    .select(
      "species, cut_id, cut_name, system_yield_pct, system_cost_per_kg, system_price_per_kg, system_margin_pct, butcher_yield_pct, butcher_price_per_kg, variance_pct, decision, notes, butcher_name, reviewed_at",
    )
    .eq("branch_id", branchId);

  if (error) {
    return unavailable("Pricing validation records are temporarily unavailable.", [error.message]);
  }

  const records = (data as Row[]).map(mapRow);
  if (records.length === 0) {
    return noData([], "No butcher pricing validations recorded yet.");
  }
  return healthy(records);
}
