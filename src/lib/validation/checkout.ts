import { z } from "zod";

export const ukPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+44\d{10}$/, "Enter a UK phone number in +44 E.164 format.");

export const checkoutBasketItemSchema = z.object({
  productId: z.string().uuid(),
  productSlug: z.string().min(1),
  name: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitType: z.enum(["kg", "each", "box"]),
  unitPriceSnapshot: z.coerce.number().nonnegative(),
});

export const checkoutSchema = z.object({
  branchId: z.string().uuid(),
  customerName: z.string().trim().min(2, "Name is required."),
  customerPhone: ukPhoneSchema,
  customerEmail: z.string().trim().email().optional().or(z.literal("")),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pickup date is required."),
  pickupWindowId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(12),
  basket: z.array(checkoutBasketItemSchema).min(1, "Basket cannot be empty."),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
