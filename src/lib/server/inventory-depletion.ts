import "server-only";

import { buildCollectionStockMessage, type CollectionStockSummary } from "@/lib/inventory/collection-stock";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ShortfallDetailRow = { product_name?: unknown; short_kg?: unknown };

type DepletionRow = {
  status: "completed" | "completed_with_shortfall";
  weight_tracked_lines: number | null;
  non_weight_tracked_lines: number | null;
  shortfall_detail: ShortfallDetailRow[] | null;
};

/**
 * Read the recorded outcome of a collection's stock depletion and turn it into the
 * one-line, plain-English confirmation the operator sees. A read failure here must
 * never surface as an error — the collection has already committed; we just fall
 * back to a quiet "Collected." (undefined → the UI shows its default).
 */
export async function getCollectionStockMessage(
  supabase: SupabaseServerClient,
  orderId: string,
): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from("order_inventory_depletions")
      .select("status, weight_tracked_lines, non_weight_tracked_lines, shortfall_detail")
      .eq("order_id", orderId)
      .eq("source_event", "SALE_COLLECT")
      .maybeSingle();

    if (error || !data) return undefined;

    const row = data as DepletionRow;
    const shortfall = Array.isArray(row.shortfall_detail)
      ? row.shortfall_detail.map((item) => ({
          productName: String(item.product_name ?? "this item"),
          shortKg: Number(item.short_kg ?? 0),
        }))
      : [];

    const summary: CollectionStockSummary = {
      status: row.status,
      weightTrackedLines: row.weight_tracked_lines ?? 0,
      nonWeightTrackedLines: row.non_weight_tracked_lines ?? 0,
      shortfall,
    };

    return buildCollectionStockMessage(summary);
  } catch {
    return undefined;
  }
}
