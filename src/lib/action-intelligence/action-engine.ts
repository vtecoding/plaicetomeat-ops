import { buildBasketActions } from "./basket-actions";
import { buildComplianceActions } from "./compliance-actions";
import { buildCustomerActions } from "./customer-actions";
import { buildMarginActions } from "./margin-actions";
import { sortOwnerActions } from "./action-score";
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
      title: "SMS failures need attention today",
      explanation: `${input.system.failedSmsToday} SMS messages failed today.`,
      estimatedImpact: "Customers may miss ready-for-collection updates.",
      recommendedAction: "Check SMS environment variables and provider delivery status before marking more orders ready.",
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
      title: "Realtime updates are not confirmed live",
      explanation: `Realtime mode is ${input.system.realtimeMode}.`,
      estimatedImpact: "Counter updates may rely on polling rather than live push.",
      recommendedAction: "Verify realtime environment configuration and watch the counter connection badge during service.",
      sourceMetrics: {
        realtimeMode: input.system.realtimeMode,
      },
      createdAt: input.createdAt,
      confidence: "medium",
    });
  }

  return actions;
}
