import "server-only";

import { buildOwnerBrain } from "@/lib/owner-brain/brain";
import type { OwnerBrain } from "@/lib/owner-brain/types";
import { degraded, healthy, noData, configurationRequired, type DataResult } from "@/lib/domain/data-result";
import { getDashboardMetrics, type DashboardMetrics } from "@/lib/server/dashboard";
import { getOperationsIntelligence, type OpsIntelligence } from "@/lib/server/operations-intelligence";
import { getShopIntelligence, type ShopIntelligence } from "@/lib/server/shop-intelligence";
import { hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type OperationalSnapshotDataV1 = {
  metrics: DashboardMetrics;
  intelligence: OpsIntelligence;
  shopIntelligence: ShopIntelligence;
  brain: OwnerBrain;
};

export type OperationalSnapshotV1 = {
  version: 1;
  branchId: string;
  asOf: string;
  result: DataResult<OperationalSnapshotDataV1>;
};

export async function getOperationalSnapshotV1(branchId: string, now = new Date()): Promise<OperationalSnapshotV1> {
  const asOf = now.toISOString();

  if (!hasSupabaseServiceEnv()) {
    return {
      version: 1,
      branchId,
      asOf,
      result: configurationRequired("Live operational data is not configured. No demo data was used for this production truth surface."),
    };
  }

  const [metrics, intelligence, shopIntelligence] = await Promise.all([
    getDashboardMetrics(branchId, now),
    getOperationsIntelligence(branchId, now),
    getShopIntelligence(branchId, now),
  ]);
  const data = { metrics, intelligence, shopIntelligence, brain: buildOwnerBrain(shopIntelligence) };
  const issues = [intelligence.dataState.message].filter((message): message is string => Boolean(message));

  const result =
    intelligence.dataState.status === "error"
      ? degraded(data, "Some operational data is unavailable. No demo data was used.", issues)
      : metrics.orderCount === 0
        ? noData(data, "No real orders yet for this pickup date.", issues)
        : healthy(data, "Operational data loaded.");

  return { version: 1, branchId, asOf, result };
}
