export type ActionCategory = "stock" | "waste" | "margin" | "customer" | "basket" | "compliance" | "system";
export type ActionGroup = "urgent" | "money_saving" | "stock" | "compliance" | "customer_growth";
export type ActionSeverity = "info" | "warning" | "urgent";
export type ActionConfidence = "low" | "medium" | "high";

export type OwnerAction = {
  id: string;
  category: ActionCategory;
  group: ActionGroup;
  severity: ActionSeverity;
  title: string;
  explanation: string;
  estimatedImpact: string;
  recommendedAction: string;
  sourceMetrics: Record<string, string | number | null>;
  createdAt: string;
  confidence: ActionConfidence;
  blockingReason?: string;
};

export type ActionEngineInput = {
  createdAt: string;
  expiringStock: Array<{
    productName: string;
    remainingWeightKg: number;
    valueAtRisk: number;
    daysToExpiry: number;
  }>;
  waste: {
    weekValue: number;
    byProduct: Array<{ label: string; value: number }>;
  };
  margin: {
    worst: Array<{
      productName: string;
      grossProfit: number | null;
      wasteCost: number;
    }>;
    highestWasteDrag: {
      productName: string;
      wasteCost: number;
      grossProfit: number | null;
    } | null;
  };
  customers: {
    firstTimeCustomers: number;
    repeatCustomers: number;
    repeatRate: number;
    /** Named regulars who have gone quiet — each a basket of revenue to win back. */
    lapsedRegulars?: Array<{
      customerName: string;
      averageOrderValue: number;
      daysSinceLastOrder: number;
      orders: number;
    }>;
  };
  basket: {
    status: "ready" | "insufficient_history" | "no_pairings";
    realOrderCount: number;
    bundleSuggestion: string | null;
    topPairings: Array<{ productA: string; productB: string; count: number }>;
  };
  compliance: {
    rows: Array<{
      supplierName: string;
      daysToExpiry: number | null;
      band: string;
    }>;
  };
  system: {
    failedSmsToday: number;
    realtimeMode: "websocket" | "polling" | "auto";
  };
};
