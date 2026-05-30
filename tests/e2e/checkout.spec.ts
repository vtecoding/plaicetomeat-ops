import { expect, test } from "@playwright/test";

// Phase 11: the checkout API must re-validate everything server-side, even when
// the client is bypassed entirely (direct POST).
test.describe("checkout server validation", () => {
  test("rejects an invalid phone even if the client is bypassed", async ({ request }) => {
    const res = await request.post("/api/checkout", {
      data: {
        branchId: "00000000-0000-4000-8000-000000000001",
        customerName: "Bypasser",
        customerPhone: "not-a-phone",
        pickupDate: "2026-06-02",
        pickupWindowId: "00000000-0000-4000-8000-000000000302",
        idempotencyKey: "bypass-invalid-phone-1",
        basket: [
          {
            productId: "00000000-0000-4000-8000-000000000202",
            productSlug: "whole-chicken",
            name: "Whole Chicken",
            quantity: 1,
            unitType: "each",
            unitPriceSnapshot: 6.5,
          },
        ],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/UK mobile/i);
  });

  test("rejects an empty basket server-side", async ({ request }) => {
    const res = await request.post("/api/checkout", {
      data: {
        branchId: "00000000-0000-4000-8000-000000000001",
        customerName: "Empty Basket",
        customerPhone: "07700900123",
        pickupDate: "2026-06-02",
        pickupWindowId: "00000000-0000-4000-8000-000000000302",
        idempotencyKey: "bypass-empty-basket-1",
        basket: [],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects malformed JSON", async ({ request }) => {
    const res = await request.post("/api/checkout", {
      headers: { "content-type": "application/json" },
      data: "{not json",
    });
    expect(res.status()).toBe(400);
  });
});
