import "server-only";

import { demoPickupWindows } from "@/lib/data/demo";
import type { PickupWindow } from "@/lib/domain/types";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type PickupWindowRow = {
  id: string;
  branch_id: string;
  label: string;
  start_time: string;
  end_time: string;
  cutoff_time: string | null;
  max_orders: number | null;
  days_of_week: number[];
  window_type: PickupWindow["windowType"];
  is_active: boolean;
};

function mapRow(row: PickupWindowRow): PickupWindow {
  return {
    id: row.id,
    branchId: row.branch_id,
    label: row.label,
    startTime: row.start_time?.slice(0, 5) ?? row.start_time,
    endTime: row.end_time?.slice(0, 5) ?? row.end_time,
    cutoffTime: row.cutoff_time ? row.cutoff_time.slice(0, 5) : null,
    maxOrders: row.max_orders,
    daysOfWeek: row.days_of_week,
    windowType: row.window_type,
    isActive: row.is_active,
  };
}

/**
 * All pickup windows for a branch (active and inactive). Falls back to demo
 * data only when Supabase is not configured.
 */
export async function getPickupWindows(branchId: string): Promise<PickupWindow[]> {
  if (!hasSupabaseServiceEnv()) {
    return demoPickupWindows;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pickup_windows")
    .select("id, branch_id, label, start_time, end_time, cutoff_time, max_orders, days_of_week, window_type, is_active")
    .eq("branch_id", branchId)
    .order("start_time", { ascending: true });

  if (error || !data) {
    return demoPickupWindows;
  }

  return (data as PickupWindowRow[]).map(mapRow);
}
