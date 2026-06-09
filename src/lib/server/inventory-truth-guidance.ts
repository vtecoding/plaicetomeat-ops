import "server-only";

import type { InventoryOperatorSignal, InventoryTruthGuidanceInput } from "@/lib/domain/operator-guidance";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

/**
 * Reads the inventory-truth confidence monitor (V14.1-H) and maps it into the
 * plain operator-guidance shape. Extracted into its own module so both the shop
 * intelligence snapshot and the purchasing plan can consume the same signals
 * without a circular import. Read-only; mutates nothing.
 */

type InventoryConfidenceMonitorRow = {
  product_id: string;
  product_name: string | null;
  operator_signal: string;
  internal_reasons: string[] | null;
};

function toInventoryOperatorSignal(value: string): InventoryOperatorSignal | null {
  if (value === "trusted" || value === "count_soon" || value === "count_today") return value;
  return null;
}

export async function getInventoryTruthGuidance(branchId: string): Promise<InventoryTruthGuidanceInput[]> {
  if (!hasSupabaseServiceEnv()) return [];

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("inventory_confidence_monitor")
      .select("product_id, product_name, operator_signal, internal_reasons")
      .eq("branch_id", branchId);

    if (error || !data) return [];

    return (data as InventoryConfidenceMonitorRow[])
      .map((row): InventoryTruthGuidanceInput | null => {
        const signal = toInventoryOperatorSignal(row.operator_signal);
        if (!signal) return null;
        return {
          productId: row.product_id,
          productName: row.product_name ?? "this item",
          operatorSignal: signal,
          internalReasons: row.internal_reasons ?? [],
        };
      })
      .filter((row): row is InventoryTruthGuidanceInput => row !== null);
  } catch (error) {
    console.error("[inventory-truth-guidance] confidence monitor query failed", { branchId, error });
    return [];
  }
}
