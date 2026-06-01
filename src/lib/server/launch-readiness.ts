import "server-only";

import { getAllProducts } from "@/lib/server/catalog";
import { getActivePickupWindows } from "@/lib/server/pickup-windows";
import type { DashboardMetrics } from "@/lib/server/dashboard";
import {
  deriveLaunchReadiness,
  type LaunchReadiness,
  type LaunchSignals,
} from "@/lib/domain/launch-readiness";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

/**
 * Gather real launch-readiness signals for a branch and derive the owner-facing
 * status. Reuses the already-computed dashboard metrics for certificate state so
 * the page does not re-query compliance. Any data fault degrades gracefully —
 * the owner never sees a raw error, just an "attention" item.
 */
export async function getLaunchReadiness(branchId: string, metrics: DashboardMetrics): Promise<LaunchReadiness> {
  const signals: LaunchSignals = {
    productCount: 0,
    zeroPriceProductCount: 0,
    activePickupWindowCount: 0,
    certificatesConfigured: metrics.certificateRecordsConfigured,
    expiredCertificates: metrics.expiredCertificates,
    anyOrderPlaced: false,
    staffAccountCount: 0,
    smsSendingEnabled: process.env.SMS_SENDING_ENABLED === "true",
  };

  if (!hasSupabaseServiceEnv()) {
    return deriveLaunchReadiness(signals);
  }

  try {
    const [products, windows] = await Promise.all([getAllProducts(branchId), getActivePickupWindows(branchId)]);
    signals.productCount = products.length;
    signals.zeroPriceProductCount = products.filter((product) => !(product.pricePerUnit > 0)).length;
    signals.activePickupWindowCount = windows.length;

    const supabase = createSupabaseServiceClient();
    const [{ count: orderCount }, { count: staffCount }] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("branch_id", branchId),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .in("role", ["staff", "manager"]),
    ]);

    signals.anyOrderPlaced = (orderCount ?? 0) > 0;
    signals.staffAccountCount = staffCount ?? 0;
  } catch (error) {
    // Developers only — the owner just sees the affected items as "attention".
    console.error("[launch-readiness] signal gathering failed", { branchId, error });
  }

  return deriveLaunchReadiness(signals);
}
