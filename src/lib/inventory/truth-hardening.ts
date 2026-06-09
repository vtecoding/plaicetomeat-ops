export type LedgerMutation = "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";

export type ConfidenceSignal = "trusted" | "count_soon" | "count_today";

export type InventoryTruthInput = {
  productId: string;
  productName: string;
  cacheMismatch?: boolean;
  shortfallCount30d?: number;
  correctionCount30d?: number;
  lastCountDaysAgo?: number | null;
  failureTrendCount30d?: number;
};

export type InventoryConfidence = {
  productId: string;
  productName: string;
  internalScore: number;
  signal: ConfidenceSignal;
  internalReasons: string[];
  operatorMessage: string;
};

export type ReversalMovementInput = {
  originalMovementId: string;
  orderId: string;
  batchId: string;
  orderItemId?: string | null;
  originalDeltaKg: number;
  balanceBeforeKg: number;
  sourceEvent: "REFUND_REVERSAL" | "COLLECTION_REVERSAL" | "CANCELLED_COLLECTION_REVERSAL" | "OPERATOR_CORRECTION";
};

export type CompensatingMovement = {
  reversalOfMovementId: string;
  orderId: string;
  batchId: string;
  orderItemId?: string | null;
  deltaKg: number;
  quantityKg: number;
  balanceBeforeKg: number;
  balanceAfterKg: number;
  sourceEvent: ReversalMovementInput["sourceEvent"];
};

export type ProductReconciliationInput = InventoryTruthInput & {
  repeatedShortfalls?: number;
  recurringMismatches?: number;
  countRequests30d?: number;
};

export type ReconciliationFinding = {
  productId: string;
  productName: string;
  severity: "watch" | "count_soon" | "count_today";
  reason: string;
  operatorMessage: string;
};

export type FailureEventInput = {
  type: "depletion_failure" | "oversell_flag" | "unmapped_product" | "non_weight_tracked_sale";
  count30d: number;
};

export type SaleDepletionKey = {
  orderItemId: string;
  batchId: string;
  sourceEvent: "SALE_COLLECT";
};

export function canMutateHistoricalMovement(operation: LedgerMutation): boolean {
  return operation === "INSERT";
}

export function saleDepletionKeysAreUnique(keys: SaleDepletionKey[]): boolean {
  return new Set(keys.map((key) => `${key.sourceEvent}:${key.orderItemId}:${key.batchId}`)).size === keys.length;
}

export function buildCompensatingMovement(input: ReversalMovementInput): CompensatingMovement {
  if (input.originalDeltaKg >= 0) {
    throw new Error("Only negative sale movements can be reversed automatically.");
  }

  const deltaKg = roundKg(Math.abs(input.originalDeltaKg));
  const balanceAfterKg = roundKg(input.balanceBeforeKg + deltaKg);

  return {
    reversalOfMovementId: input.originalMovementId,
    orderId: input.orderId,
    batchId: input.batchId,
    orderItemId: input.orderItemId,
    deltaKg,
    quantityKg: deltaKg,
    balanceBeforeKg: roundKg(input.balanceBeforeKg),
    balanceAfterKg,
    sourceEvent: input.sourceEvent,
  };
}

export function calculateInventoryConfidence(input: InventoryTruthInput): InventoryConfidence {
  const internalReasons: string[] = [];
  let score = 100;

  if (input.cacheMismatch) {
    score -= 40;
    internalReasons.push("cache_mismatch");
  }

  const shortfalls = input.shortfallCount30d ?? 0;
  if (shortfalls > 0) {
    score -= shortfalls >= 2 ? 30 : 10;
    internalReasons.push("shortfall");
  }

  const corrections = input.correctionCount30d ?? 0;
  if (corrections > 0) {
    score -= Math.min(20, corrections * 5);
    internalReasons.push("correction");
  }

  if (input.lastCountDaysAgo == null) {
    score -= 20;
    internalReasons.push("no_recent_count");
  } else if (input.lastCountDaysAgo > 14) {
    score -= 15;
    internalReasons.push("stale_count");
  } else if (input.lastCountDaysAgo > 7) {
    score -= 8;
    internalReasons.push("count_aging");
  }

  const failureTrendCount = input.failureTrendCount30d ?? 0;
  if (failureTrendCount >= 3) {
    score -= 20;
    internalReasons.push("failure_trend");
  }

  const internalScore = clampScore(score);
  const signal = confidenceSignal({
    score: internalScore,
    cacheMismatch: Boolean(input.cacheMismatch),
    shortfalls,
    corrections,
    lastCountDaysAgo: input.lastCountDaysAgo,
    failureTrendCount,
  });

  return {
    productId: input.productId,
    productName: input.productName,
    internalScore,
    signal,
    internalReasons,
    operatorMessage: operatorCountMessage(input.productName, signal),
  };
}

export function buildReconciliationReport(rows: ProductReconciliationInput[]): ReconciliationFinding[] {
  return rows
    .map((row) => {
      const confidence = calculateInventoryConfidence(row);
      const repeatedShortfalls = row.repeatedShortfalls ?? row.shortfallCount30d ?? 0;
      const recurringMismatches = row.recurringMismatches ?? 0;
      const countRequests = row.countRequests30d ?? 0;

      if (row.cacheMismatch || recurringMismatches > 0) {
        return finding(row, "count_today", "ledger_cache_mismatch");
      }
      if (repeatedShortfalls >= 2) {
        return finding(row, "count_today", "repeated_shortfall");
      }
      if (confidence.signal === "count_today") {
        return finding(row, "count_today", confidence.internalReasons[0] ?? "confidence_degraded");
      }
      if (countRequests >= 2 || confidence.signal === "count_soon") {
        return finding(row, "count_soon", countRequests >= 2 ? "frequent_count_request" : "confidence_aging");
      }
      return null;
    })
    .filter((row): row is ReconciliationFinding => row !== null);
}

export function summarizeFailureVisibility(events: FailureEventInput[]): FailureEventInput[] {
  return events.filter((event) => event.count30d >= 2);
}

export function eachBoxFutureRecommendation(): string {
  return [
    "Recommendation: defer automatic each/box depletion until weights are trustworthy.",
    "Use weighed-at-collection for weight-confirmed each items, supplier or pack-defined weights for true packs, nominal weights only as a fallback, and keep unresolved items manual-counted.",
  ].join(" ");
}

function confidenceSignal(input: {
  score: number;
  cacheMismatch: boolean;
  shortfalls: number;
  corrections: number;
  lastCountDaysAgo?: number | null;
  failureTrendCount: number;
}): ConfidenceSignal {
  if (input.cacheMismatch || input.shortfalls >= 2 || input.failureTrendCount >= 3 || input.score < 60) {
    return "count_today";
  }
  if (input.corrections >= 2 || input.lastCountDaysAgo == null || input.lastCountDaysAgo > 7 || input.score < 80) {
    return "count_soon";
  }
  return "trusted";
}

function operatorCountMessage(productName: string, signal: ConfidenceSignal): string {
  if (signal === "count_today") return `Please count ${productName} today.`;
  if (signal === "count_soon") return `Please count ${productName} soon.`;
  return "Stock available.";
}

function finding(
  row: ProductReconciliationInput,
  severity: ReconciliationFinding["severity"],
  reason: string,
): ReconciliationFinding {
  return {
    productId: row.productId,
    productName: row.productName,
    severity,
    reason,
    operatorMessage: operatorCountMessage(row.productName, severity === "watch" ? "count_soon" : severity),
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}
