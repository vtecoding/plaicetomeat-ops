import { describe, expect, it } from "vitest";

import { createCheckoutSchema } from "./checkout";

const baseCheckout = {
  branchId: "00000000-0000-4000-8000-000000000001",
  customerName: "Aisha Khan",
  customerPhone: "07700 900111",
  customerEmail: "",
  pickupDate: "2026-05-31",
  pickupWindowId: "00000000-0000-4000-8000-000000000301",
  idempotencyKey: "checkout-123456",
  basket: [
    {
      productId: "00000000-0000-4000-8000-000000000201",
      productSlug: "chicken-breast-fillets",
      name: "Chicken Breast Fillets",
      quantity: 1,
      unitType: "kg",
      unitPriceSnapshot: 0.01,
    },
  ],
};

describe("checkout validation", () => {
  it("accepts local UK mobile numbers and normalizes them", () => {
    const result = createCheckoutSchema({ now: new Date("2026-05-30T10:00:00") }).safeParse(baseCheckout);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.customerPhone).toBe("+447700900111");
      expect(result.data.customerEmail).toBeUndefined();
    }
  });

  it("rejects invalid phone numbers, past dates, and same-day orders after cutoff", () => {
    const schema = createCheckoutSchema({ now: new Date("2026-05-30T17:00:00") });

    expect(schema.safeParse({ ...baseCheckout, customerPhone: "0121 555 5555" }).success).toBe(false);
    expect(schema.safeParse({ ...baseCheckout, pickupDate: "2026-05-29" }).success).toBe(false);

    const sameDay = schema.safeParse({ ...baseCheckout, pickupDate: "2026-05-30" });

    expect(sameDay.success).toBe(false);

    if (!sameDay.success) {
      expect(sameDay.error.issues.at(-1)?.message).toBe("Same-day orders close at 4pm.");
    }
  });

  it("enforces basket quantity abuse limits", () => {
    const result = createCheckoutSchema({ now: new Date("2026-05-30T10:00:00") }).safeParse({
      ...baseCheckout,
      basket: [{ ...baseCheckout.basket[0], quantity: 21 }],
    });

    expect(result.success).toBe(false);
  });
});
