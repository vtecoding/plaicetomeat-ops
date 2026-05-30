import { z } from "zod";

import {
  DEFAULT_MAX_QUANTITY_PER_SKU,
  getPickupDateError,
  isUkMobileNumber,
  normalizeUkMobileNumber,
} from "@/lib/domain/checkout-rules";

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
      z.string().trim().email("Enter a valid email address.").optional(),
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
    idempotencyKey: z.string().trim().min(12),
    basket: z.array(checkoutBasketItemSchema).min(1, "Basket cannot be empty."),
    isTest: z.preprocess((value) => value === true || value === "true", z.boolean()).optional(),
  });
}

export const checkoutSchema = createCheckoutSchema();

export type CheckoutInput = z.infer<typeof checkoutSchema>;
