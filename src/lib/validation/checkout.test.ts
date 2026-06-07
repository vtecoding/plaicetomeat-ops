import { describe, expect, it } from "vitest";

import { MAX_DISTINCT_SKUS, createCheckoutSchema, mergeCheckoutBasketItems } from "./checkout";

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

  it("rejects more than the maximum distinct SKUs", () => {
    const many = Array.from({ length: MAX_DISTINCT_SKUS + 1 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-0000000${String(2000 + i).padStart(5, "0")}`,
      productSlug: `p-${i}`,
      name: `Product ${i}`,
      quantity: 1,
      unitType: "each",
      unitPriceSnapshot: 1,
    }));

    const result = createCheckoutSchema({ now: new Date("2026-05-30T10:00:00") }).safeParse({
      ...baseCheckout,
      basket: many,
    });

    expect(result.success).toBe(false);
  });

  it("rejects an over-long idempotency key", () => {
    const result = createCheckoutSchema({ now: new Date("2026-05-30T10:00:00") }).safeParse({
      ...baseCheckout,
      idempotencyKey: "x".repeat(201),
    });

    expect(result.success).toBe(false);
  });
});

describe("mergeCheckoutBasketItems (duplicate-SKU merge)", () => {
  const sku = (productId: string, quantity: number) => ({
    productId,
    productSlug: "slug",
    name: "Name",
    quantity,
    unitType: "kg",
    unitPriceSnapshot: 1,
  });

  it("sums quantities for the same productId and keeps one line", () => {
    const merged = mergeCheckoutBasketItems([sku("p1", 3), sku("p2", 1), sku("p1", 4)]);
    expect(merged).toHaveLength(2);
    const p1 = merged.find((m) => (m as { productId: string }).productId === "p1") as { quantity: number };
    expect(p1.quantity).toBe(7);
  });

  it("closes the per-SKU max bypass: merged quantity is validated against the limit", () => {
    // Two lines of 15 each would each pass per-line, but the 30 aggregate must fail.
    const merged = mergeCheckoutBasketItems([sku("00000000-0000-4000-8000-000000000201", 15), sku("00000000-0000-4000-8000-000000000201", 15)]);
    const result = createCheckoutSchema({ now: new Date("2026-05-30T10:00:00") }).safeParse({
      ...baseCheckout,
      basket: merged,
    });
    expect(result.success).toBe(false);
  });

  it("passes malformed entries through unchanged for the schema to reject", () => {
    const merged = mergeCheckoutBasketItems([sku("p1", 1), null, { nope: true }, "bad"]);
    expect(merged).toContain(null);
    expect(merged).toContainEqual({ nope: true });
    expect(merged).toContain("bad");
  });

  it("returns an empty array for non-array input", () => {
    expect(mergeCheckoutBasketItems(undefined)).toEqual([]);
    expect(mergeCheckoutBasketItems("nope")).toEqual([]);
  });
});
