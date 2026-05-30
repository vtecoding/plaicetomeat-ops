import { describe, expect, it } from "vitest";

import { checkoutSchema } from "./checkout";

describe("checkout validation", () => {
  it("requires +44 E.164 phone numbers", () => {
    const result = checkoutSchema.safeParse({
      branchId: "00000000-0000-4000-8000-000000000001",
      customerName: "Aisha Khan",
      customerPhone: "07700900111",
      customerEmail: "",
      pickupDate: "2026-05-29",
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
    });

    expect(result.success).toBe(false);
  });
});
