import { describe, expect, it } from "vitest";

import type { ActionEngineInput } from "./action-types";
import { buildStockActions } from "./stock-actions";

function inputWithExpiring(daysToExpiry: number): ActionEngineInput {
  return {
    createdAt: "2026-06-08T08:00:00Z",
    expiringStock: [
      { productName: "Chicken Breast Fillets", remainingWeightKg: 18.5, valueAtRisk: 92.5, daysToExpiry },
    ],
    waste: { weekValue: 0, byProduct: [] },
    margin: { worst: [], highestWasteDrag: null },
    customers: { firstTimeCustomers: 0, repeatCustomers: 0, repeatRate: 0 },
    basket: { status: "no_pairings", realOrderCount: 0, bundleSuggestion: null, topPairings: [] },
    compliance: { rows: [] },
    system: { failedSmsToday: 0, realtimeMode: "auto" },
  };
}

describe("buildStockActions expiry wording", () => {
  it("says 'expiring today' for stock dated today (never 'within 0 days')", () => {
    const [action] = buildStockActions(inputWithExpiring(0));
    expect(action?.explanation).toBe("Chicken Breast Fillets has 18.500kg expiring today.");
    expect(action?.explanation).not.toContain("within 0 days");
  });

  it("says 'expiring tomorrow' for stock dated tomorrow", () => {
    const [action] = buildStockActions(inputWithExpiring(1));
    expect(action?.explanation).toBe("Chicken Breast Fillets has 18.500kg expiring tomorrow.");
    expect(action?.explanation).not.toContain("within 1 day");
  });

  it("falls back to a day count beyond tomorrow", () => {
    const [action] = buildStockActions(inputWithExpiring(3));
    expect(action?.explanation).toBe("Chicken Breast Fillets has 18.500kg expiring within 3 days.");
  });
});
