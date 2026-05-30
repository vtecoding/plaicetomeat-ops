import type { OrderStatus } from "./types";

export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  incoming: ["prepping", "cancelled"],
  prepping: ["ready", "cancelled"],
  ready: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return VALID_ORDER_TRANSITIONS[from].includes(to);
}

export function assertValidOrderTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Invalid order transition from ${from} to ${to}.`);
  }
}

export function getNextOrderActions(status: OrderStatus) {
  return VALID_ORDER_TRANSITIONS[status];
}
