import { buildBasketActions } from "./basket-actions";
import { buildComplianceActions } from "./compliance-actions";
import { buildCustomerActions } from "./customer-actions";
import { buildMarginActions } from "./margin-actions";
import { sortOwnerActions } from "./action-score";
import { buildSeasonalActions } from "./seasonal-actions";
import { buildStockActions } from "./stock-actions";
import type { ActionEngineInput, OwnerAction } from "./action-types";
import { buildWasteActions } from "./waste-actions";

export function buildOwnerActions(input: ActionEngineInput): OwnerAction[] {
  const actions = [
    ...buildComplianceActions(input),
    ...buildStockActions(input),
    ...buildWasteActions(input),
    ...buildMarginActions(input),
    ...buildCustomerActions(input),
    ...buildBasketActions(input),
    ...buildSeasonalActions(input),
    ...buildSystemActions(input),
  ];

  return sortOwnerActions(actions);
}

function buildSystemActions(input: ActionEngineInput): OwnerAction[] {
  const actions: OwnerAction[] = [];

  if (input.system.failedSmsToday > 0) {
    actions.push({
      id: "system-sms-failed-today",
      category: "system",
      group: "urgent",
      severity: "warning",
      title: "SMS contact needs checking",
      explanation: `${input.system.failedSmsToday} SMS messages failed today.`,
      estimatedImpact: "Customers may need to be contacted manually.",
      recommendedAction: "Continue preparing orders. Phone customers manually if a ready message fails.",
      sourceMetrics: {
        failedSmsToday: input.system.failedSmsToday,
      },
      createdAt: input.createdAt,
      confidence: "high",
    });
  }

  if (input.system.realtimeMode === "auto" || input.system.realtimeMode === "polling") {
    actions.push({
      id: "system-realtime-degraded",
      category: "system",
      group: "urgent",
      severity: "info",
      title: "Counter connection needs checking",
      explanation: "Realtime updates are not confirmed.",
      estimatedImpact: "Counter updates may rely on polling rather than live push.",
      recommendedAction: "Open the counter page and verify orders appear immediately during service.",
      sourceMetrics: {
        realtimeMode: input.system.realtimeMode,
      },
      createdAt: input.createdAt,
      confidence: "medium",
    });
  }

  return actions;
}
