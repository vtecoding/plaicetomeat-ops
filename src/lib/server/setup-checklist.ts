import "server-only";

import { demoProducts } from "@/lib/data/demo";
import {
  buildLaunchSafety,
  buildSetupChecklist,
  setupProgress,
  type SetupItem,
  type SetupSection,
  type SetupSignals,
} from "@/lib/domain/setup-checklist";
import type { DashboardMetrics } from "@/lib/server/dashboard";
import { getAllProducts } from "@/lib/server/catalog";
import { getActivePickupWindows } from "@/lib/server/pickup-windows";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const DEMO_PRODUCT_IDS = new Set(demoProducts.map((product) => product.id));

export type SetupChecklist = {
  sections: SetupSection[];
  launchSafety: SetupItem[];
  progress: { done: number; auto: number };
};

/**
 * Gather real setup signals for a branch and derive the owner-facing checklist
 * plus the owner-only launch-safety list. Reuses the dashboard metrics for
 * certificate state. Any data fault degrades gracefully — affected items just
 * read as "not done" rather than throwing.
 */
export async function getSetupChecklist(branchId: string, metrics: DashboardMetrics): Promise<SetupChecklist> {
  const signals: SetupSignals = {
    productCount: 0,
    zeroPriceProductCount: 0,
    demoProductsPresent: false,
    activePickupWindowCount: 0,
    certificatesConfigured: metrics.certificateRecordsConfigured,
    expiredCertificates: metrics.expiredCertificates,
    expiringCertificates: metrics.expiringCertificates,
    staffAccountCount: 0,
    anyOrderPlaced: false,
    // NEXT_PUBLIC_ vars are inlined at build; off (or unset) is the safe live state.
    checkoutTestModeEnabled: process.env.NEXT_PUBLIC_CHECKOUT_TEST_MODE === "true",
    // Admin/counter routes are middleware-protected via route-access.
    adminRoutesProtected: true,
  };

  if (!hasSupabaseServiceEnv()) {
    return assemble(signals);
  }

  try {
    const [products, windows] = await Promise.all([getAllProducts(branchId), getActivePickupWindows(branchId)]);
    signals.productCount = products.length;
    signals.zeroPriceProductCount = products.filter((product) => !(product.pricePerUnit > 0)).length;
    signals.demoProductsPresent = products.some((product) => DEMO_PRODUCT_IDS.has(product.id));
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
    console.error("[setup-checklist] signal gathering failed", { branchId, error });
  }

  return assemble(signals);
}

function assemble(signals: SetupSignals): SetupChecklist {
  const sections = buildSetupChecklist(signals);
  return {
    sections,
    launchSafety: buildLaunchSafety(signals),
    progress: setupProgress(sections),
  };
}
