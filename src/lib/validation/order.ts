import { z } from "zod";

import { ORDER_STATUSES } from "@/lib/domain/types";

export const orderRefSchema = z.string().regex(/^PTM-\d{6}-\d{4}$/);

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderStatusUpdateSchema = z.object({
  orderId: z.string().uuid(),
  nextStatus: orderStatusSchema,
});

export const customerCancellationSchema = z.object({
  orderRef: orderRefSchema,
  reason: z.string().trim().max(300).optional(),
});
