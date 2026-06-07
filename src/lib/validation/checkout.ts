import { z } from "zod";

import {
  DEFAULT_MAX_QUANTITY_PER_SKU,
  getPickupDateError,
  isUkMobileNumber,
  normalizeUkMobileNumber,
} from "@/lib/domain/checkout-rules";

// V12.3 — checkout payload caps (abuse-resistance).
export const MAX_DISTINCT_SKUS = 30;
export const MAX_CHECKOUT_BODY_BYTES = 32 * 1024; // 32 KiB
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

/**
 * Merge duplicate SKUs in a raw basket BEFORE validation: entries with the same
 * `productId` have their quantities summed (so duplicate lines cannot bypass the
 * per-SKU maximum). Malformed/foreign entries are passed through unchanged so the
 * schema can still reject them. Pure and order-stable (first-seen order).
 */
export function mergeCheckoutBasketItems(items: unknown): unknown[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const mergedOrder: string[] = [];
  const byProduct = new Map<string, Record<string, unknown>>();
  const passthrough: unknown[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      passthrough.push(raw);
      continue;
    }

    const item = raw as Record<string, unknown>;
    const productId = item.productId;
    const quantity = item.quantity;

    if (typeof productId !== "string" || (typeof quantity !== "number" && typeof quantity !== "string")) {
      passthrough.push(raw);
      continue;
    }

    const numericQuantity = typeof quantity === "number" ? quantity : Number(quantity);
    if (!Number.isFinite(numericQuantity)) {
      passthrough.push(raw);
      continue;
    }

    const existing = byProduct.get(productId);
    if (existing) {
      existing.quantity = (existing.quantity as number) + numericQuantity;
    } else {
      const copy = { ...item, quantity: numericQuantity };
      byProduct.set(productId, copy);
      mergedOrder.push(productId);
    }
  }

  return [...mergedOrder.map((id) => byProduct.get(id)!), ...passthrough];
}

export const ukPhoneSchema = z
  .string()
  .trim()
  .refine(isUkMobileNumber, "Enter a UK mobile number starting 07 or +447.")
  .transform(normalizeUkMobileNumber);

export const checkoutBasketItemSchema = z.object({
  productId: z.string().uuid(),
  productSlug: z.string().min(1),
  name: z.string().min(1),
  quantity: z.coerce
    .number()
    .positive()
    .max(DEFAULT_MAX_QUANTITY_PER_SKU, `Maximum ${DEFAULT_MAX_QUANTITY_PER_SKU} per item.`),
  unitType: z.enum(["kg", "each", "box"]),
  unitPriceSnapshot: z.coerce.number().nonnegative(),
});

export function createCheckoutSchema(
  options: {
    now?: Date;
    sameDayCutoffHour?: number;
  } = {},
) {
  return z.object({
    branchId: z.string().uuid(),
    customerName: z.string().trim().min(2, "Name is required.").max(80, "Name must be 80 characters or less."),
    customerPhone: ukPhoneSchema,
    customerEmail: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().email("Enter a valid email address.").max(MAX_EMAIL_LENGTH, "Email is too long.").optional(),
    ),
    pickupDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pickup date is required.")
      .superRefine((value, ctx) => {
        const message = getPickupDateError(value, options);

        if (message) {
          ctx.addIssue({
            code: "custom",
            message,
          });
        }
      }),
    pickupWindowId: z.string().uuid(),
    notes: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().max(500, "Notes must be 500 characters or less.").optional(),
    ),
    idempotencyKey: z.string().trim().min(12).max(MAX_IDEMPOTENCY_KEY_LENGTH),
    basket: z
      .array(checkoutBasketItemSchema)
      .min(1, "Basket cannot be empty.")
      .max(MAX_DISTINCT_SKUS, `You can order at most ${MAX_DISTINCT_SKUS} different items at once.`),
    isTest: z.preprocess((value) => value === true || value === "true", z.boolean()).optional(),
  });
}

export const checkoutSchema = createCheckoutSchema();

export type CheckoutInput = z.infer<typeof checkoutSchema>;
