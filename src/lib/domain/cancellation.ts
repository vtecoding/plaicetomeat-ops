import type { OrderStatus } from "./types";

export type CancellationWindowInput = {
  status: OrderStatus;
  createdAt: string | Date;
  cancellationWindowMinutes: number;
  now?: Date;
};

export function canCustomerCancelOrder({
  status,
  createdAt,
  cancellationWindowMinutes,
  now = new Date(),
}: CancellationWindowInput) {
  if (status !== "incoming") {
    return {
      allowed: false,
      reason: "This order is already being prepared. Please call the shop.",
    };
  }

  const createdAtDate = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const expiresAt = createdAtDate.getTime() + cancellationWindowMinutes * 60_000;

  if (now.getTime() > expiresAt) {
    return {
      allowed: false,
      reason: "The online cancellation window has expired. Please call the shop.",
    };
  }

  return { allowed: true, reason: null };
}
