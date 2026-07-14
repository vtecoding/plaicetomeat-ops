import "server-only";

import { getRealtimeMode } from "@/lib/domain/compliance-inventory";
import { getBatchesAtRisk, getInventoryBatches, getSuppliers, summariseCompliance } from "@/lib/server/compliance-inventory";
import { branchLocalDate, getBranchBusinessDate } from "@/lib/server/payment-truth";
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
  is_test: boolean | null;
};

type PaymentMetricRow = {
  direction: "sale" | "refund";
  amount_pence: number;
  order: { is_test: boolean | null } | { is_test: boolean | null }[] | null;
};

/**
 * Real, branch-scoped operational summary for today. Every number is computed
 * from the database. Test orders are counted separately and excluded from the
 * real order count and revenue so owner metrics stay truthful.
 */
export async function getDashboardMetrics(branchId: string, now = new Date()): Promise<DashboardMetrics> {
  const configured = hasSupabaseServiceEnv();
  const date = configured
    ? await getBranchBusinessDate(branchId, now)
    : branchLocalDate("Europe/London", now);

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

  if (!configured) {
    return empty;
  }

  const supabase = createSupabaseServiceClient();

  const [{ data: orders, error }, { data: paymentRows, error: paymentError }] = await Promise.all([
    supabase
      .from("orders")
      .select("status, is_test")
      .eq("branch_id", branchId)
      .eq("pickup_date", date),
    supabase
      .from("payment_events")
      .select("direction, amount_pence, order:orders!inner(is_test)")
      .eq("branch_id", branchId)
      .eq("business_date", date),
  ]);

  if (error || paymentError || !orders || !paymentRows) {
    return empty;
  }

  const rows = orders as OrderMetricRow[];
  const real = rows.filter((r) => !r.is_test && r.status !== "cancelled");
  const testOrderCount = rows.filter((r) => r.is_test).length;

  const orderCount = real.length;
  const awaitingPrep = real.filter((r) => r.status === "incoming" || r.status === "prepping").length;
  const readyCount = real.filter((r) => r.status === "ready").length;
  // Money-of-record: only collected tender is revenue, and same-day refunds
  // reduce it. Incoming/ready headers never inflate the owner dashboard.
  const estimatedRevenue =
    (paymentRows as PaymentMetricRow[])
      .filter((payment) => {
        const order = Array.isArray(payment.order) ? payment.order[0] : payment.order;
        return !order?.is_test;
      })
      .reduce(
        (sum, payment) => sum + (payment.direction === "sale" ? payment.amount_pence : -payment.amount_pence),
        0,
      ) / 100;

  // Failed SMS today (branch-scoped). Best-effort; absence is not an error.
  const startOfDay = `${date}T00:00:00.000Z`;
  const { count: failedSmsCount } = await supabase
    .from("sms_log")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .eq("status", "failed")
    .gte("created_at", startOfDay);

  const [suppliers, batches] = await Promise.all([getSuppliers(branchId), getInventoryBatches(branchId)]);
  const compliance = summariseCompliance(suppliers);
  const batchesAtRisk = getBatchesAtRisk(batches);
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const { count: wasteEventsThisWeek } = await supabase
    .from("inventory_waste_events")
    .select("id, product:products!inner(inventory_policy)", { count: "exact", head: true })
    .eq("product.branch_id", branchId)
    .eq("product.inventory_policy", "kg_batch")
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
    inventoryConfigured: batches.length > 0,
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
