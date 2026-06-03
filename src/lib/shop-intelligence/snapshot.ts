/**
 * The plain-data snapshot the V8 engine reasons over.
 *
 * The server (`src/lib/server/shop-intelligence.ts`) assembles this from existing
 * reads — `getDashboardMetrics`, `getOperationsIntelligence`, `getInventoryBatches`,
 * `getPurchasingPlan` — so the engine itself never touches the database and is fully
 * unit-testable from fixtures.
 */
import type { OwnerAction } from "@/lib/action-intelligence/action-types";
import type { IntelConfidence } from "./types";

export type SnapshotBatch = {
  productName: string;
  status: "active" | "depleted" | "disposed" | "recalled";
  remainingWeightKg: number;
  daysToExpiry: number;
  expectedWeightKg: number;
  actualWeightKg: number;
  varianceKg: number;
  /** Non-null once the butcher has confirmed the real weight (V6.6). */
  actualConfirmedAt: string | null;
  estimatedValueAtRisk: number;
};

export type SnapshotDepletionRow = {
  productName: string;
  state: string;
  remainingWeightKg: number;
  daysUntilRunout: number | null;
  dailyVelocityKg: number | null;
};

export type ShopSnapshot = {
  now: string; // ISO
  dataConfigured: boolean;

  orders: { today: number; awaitingPrep: number; ready: number };
  revenue: { today: number; yesterday: number; weekToDate: number | null };

  stock: {
    batchesExpiringWithin3Days: number;
    valueAtRisk: number;
    activeBatchCount: number;
    /** Days since the most recent stock activity (new batch or confirmed actual). */
    daysSinceLastStockActivity: number | null;
  };

  expiry: {
    expiresToday: number;
    expiresThisWeek: number;
    expired: number;
    valueAtRisk: number;
  };

  depletion: SnapshotDepletionRow[];

  waste: {
    weekValue: number;
    monthValue: number;
    byProduct: Array<{ label: string; value: number }>;
    byReason: Array<{ label: string; value: number }>;
    eventsThisWeek: number;
  };

  margin: {
    best: { productName: string; grossProfit: number | null } | null;
    worst: { productName: string; grossProfit: number | null; grossMarginPercentage: number | null } | null;
    highestWasteDrag: { productName: string; wasteCost: number } | null;
    rows: Array<{
      productName: string;
      revenue: number;
      grossProfit: number | null;
      grossMarginPercentage: number | null;
      unitsSold: number;
    }>;
    unavailableCount: number;
  };

  compliance: {
    rows: Array<{ supplierName: string; daysToExpiry: number | null; band: string }>;
    expired: number;
    expiringSoon: number;
    missing: number;
    status: string;
  };

  batches: SnapshotBatch[];

  products: {
    total: number;
    zeroPrice: number;
    missingCost: number;
    missingStockInfo: number;
    /** Products that have sold but have no cost recorded (a consistency gap). */
    activeSellingNoCost: number;
  };

  purchasing: {
    dataQualityScore: number;
    dataQualityBand: "high" | "medium" | "low";
    topRecommendations: Array<{
      kind: "order_more" | "order_less";
      productName: string;
      title: string;
      reason: string;
      confidence: IntelConfidence;
    }>;
    supplierReadiness: "ready" | "needs_review";
  };

  system: { failedSmsToday: number; realtimeHealthy: boolean };

  /** Existing owner actions, normalised into findings so nothing is lost. */
  ownerActions: OwnerAction[];
};
