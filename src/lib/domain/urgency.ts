import type { Order, PickupWindow } from "./types";
import { timeToMinutes } from "./pickup-windows";

export type UrgencyLevel = "normal" | "amber" | "red" | "passed";

export function getOrderUrgency(order: Order, pickupWindow: PickupWindow | undefined, now = new Date()): UrgencyLevel {
  if (!pickupWindow || order.status === "collected" || order.status === "cancelled") {
    return "normal";
  }

  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  if (order.pickupDate !== today) {
    return "normal";
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = timeToMinutes(pickupWindow.startTime);
  const endMinutes = timeToMinutes(pickupWindow.endTime);
  const minutesUntilStart = startMinutes - nowMinutes;

  if (nowMinutes > endMinutes) {
    return "passed";
  }

  if (minutesUntilStart <= 10) {
    return "red";
  }

  if (minutesUntilStart <= 30) {
    return "amber";
  }

  return "normal";
}
