import "server-only";

import { getRealtimeMode } from "@/lib/domain/compliance-inventory";
import { getLocalIsoDate } from "@/lib/domain/checkout-rules";
import { getBatchesAtRisk, getInventoryBatches, getSuppliers, summariseCompliance } from "@/lib/server/compliance-inventory";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type DashboardMetrics = {
  configured: boolean;
  date: string;
  orderCount: number;
  awaitingPrep: number;
  readyCount: number;
  estimatedRevenue: number;
  failedSmsCount: number;
  testOrderCount: number;
  inventoryConfigured: boolean;
  realtimeMode: "websocket" | "polling" | "auto";
  expiredCertificates: number;
  expiringCertificates: number;
  missingCertificates: number;
  certificateRecordsConfigured: boolean;
  batchesExpiringWithin3Days: number;
  stockValueAtRisk: number;
  wasteEventsThisWeek: number;
  expiringBatchCount: number;
};

type OrderMetricRow = {
  status: string;
  subtotal: string | number;
  is_test: boolean | null;
};

function toNum(value: string | number | null) {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value);
}

/**
 * Real, branch-scoped operational summary for today. Every number is computed
 * from the database. Test orders are counted separately and excluded from the
 * real order count and revenue so owner metrics stay truthful.
 */
export async function getDashboardMetrics(branchId: string, now = new Date()): Promise<DashboardMetrics> {
  const date = getLocalIsoDate(now);

  const empty: DashboardMetrics = {
    configured: false,
    date,
    orderCount: 0,
    awaitingPrep: 0,
    readyCount: 0,
    estimatedRevenue: 0,
    failedSmsCount: 0,
    testOrderCount: 0,
    inventoryConfigured: false,
    realtimeMode: getRealtimeMode(),
    expiredCertificates: 0,
    expiringCertificates: 0,
    missingCertificates: 0,
    certificateRecordsConfigured: false,
    batchesExpiringWithin3Days: 0,
    stockValueAtRisk: 0,
    wasteEventsThisWeek: 0,
    expiringBatchCount: 0,
  };

  if (!hasSupabaseServiceEnv()) {
    return empty;
  }

  const supabase = createSupabaseServiceClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("status, subtotal, is_test")
    .eq("branch_id", branchId)
    .eq("pickup_date", date);

  if (error || !orders) {
    return empty;
  }

  const rows = orders as OrderMetricRow[];
  const real = rows.filter((r) => !r.is_test && r.status !== "cancelled");
  const testOrderCount = rows.filter((r) => r.is_test).length;

  const orderCount = real.length;
  const awaitingPrep = real.filter((r) => r.status === "incoming" || r.status === "prepping").length;
  const readyCount = real.filter((r) => r.status === "ready").length;
  const estimatedRevenue = real
    .filter((r) => r.status !== "cancelled")
    .reduce((sum, r) => sum + toNum(r.subtotal), 0);

  // Failed SMS today (branch-scoped). Best-effort; absence is not an error.
  const startOfDay = `${date}T00:00:00.000Z`;
  const { count: failedSmsCount } = await supabase
    .from("sms_log")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .eq("status", "failed")
    .gte("created_at", startOfDay);

  // Inventory is optional; only treat as configured if any batch row exists.
  const { count: inventoryCount } = await supabase
    .from("inventory_batches")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId);

  const [suppliers, batches] = await Promise.all([getSuppliers(branchId), getInventoryBatches(branchId)]);
  const compliance = summariseCompliance(suppliers);
  const batchesAtRisk = getBatchesAtRisk(batches);
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const { count: wasteEventsThisWeek } = await supabase
    .from("inventory_waste_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", weekStart.toISOString());

  return {
    configured: true,
    date,
    orderCount,
    awaitingPrep,
    readyCount,
    estimatedRevenue,
    failedSmsCount: failedSmsCount ?? 0,
    testOrderCount,
    inventoryConfigured: (inventoryCount ?? 0) > 0,
    realtimeMode: getRealtimeMode(),
    expiredCertificates: compliance.expired,
    expiringCertificates: compliance.expiringSoon,
    missingCertificates: compliance.missing,
    certificateRecordsConfigured: compliance.configured,
    batchesExpiringWithin3Days: batchesAtRisk.length,
    expiringBatchCount: batchesAtRisk.length,
    stockValueAtRisk: batchesAtRisk.reduce((sum, batch) => sum + batch.estimatedValueAtRisk, 0),
    wasteEventsThisWeek: wasteEventsThisWeek ?? 0,
  };
}
