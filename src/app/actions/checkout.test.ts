import { beforeEach, describe, expect, it, vi } from "vitest";

// V12.3 — fault isolation: a committed order must not report total failure when
// the access cookie can't be established, and a missing access secret must block
// BEFORE any mutation. Server boundary is mocked.
vi.mock("server-only", () => ({}));

const { submitCheckoutMock, isOrderAccessConfiguredMock, grantOrderAccessMock } = vi.hoisted(() => ({
  submitCheckoutMock: vi.fn(),
  isOrderAccessConfiguredMock: vi.fn(),
  grantOrderAccessMock: vi.fn(),
}));

vi.mock("@/lib/server/orders", () => ({ submitCheckout: submitCheckoutMock }));
vi.mock("@/lib/server/order-access-session", () => ({
  isOrderAccessConfigured: isOrderAccessConfiguredMock,
  grantOrderAccess: grantOrderAccessMock,
}));

import { createOrderAction } from "@/app/actions/checkout";

function form(basket = "[]"): FormData {
  const fd = new FormData();
  fd.set("branchId", "00000000-0000-4000-8000-000000000001");
  fd.set("customerName", "Test Person");
  fd.set("customerPhone", "07700900000");
  fd.set("pickupDate", "2026-06-08");
  fd.set("pickupWindowId", "00000000-0000-4000-8000-000000000301");
  fd.set("idempotencyKey", "key-abcdef123456");
  fd.set("basket", basket);
  fd.set("isTest", "false");
  return fd;
}

beforeEach(() => {
  submitCheckoutMock.mockReset();
  isOrderAccessConfiguredMock.mockReset();
  grantOrderAccessMock.mockReset();
  isOrderAccessConfiguredMock.mockReturnValue(true);
});

describe("createOrderAction", () => {
  it("preflights the access secret and refuses BEFORE mutation when missing", async () => {
    isOrderAccessConfiguredMock.mockReturnValue(false);

    const result = await createOrderAction({ ok: false, message: "" }, form());

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/temporarily unavailable/i);
    expect(submitCheckoutMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized basket before mutation", async () => {
    const huge = JSON.stringify(Array.from({ length: 5000 }, () => ({ productId: "x".repeat(40), quantity: 1 })));
    const result = await createOrderAction({ ok: false, message: "" }, form(huge));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/too large/i);
    expect(submitCheckoutMock).not.toHaveBeenCalled();
  });

  it("propagates a checkout service failure", async () => {
    submitCheckoutMock.mockResolvedValue({ ok: false, status: 429, message: "Too many checkout attempts just now." });

    const result = await createOrderAction({ ok: false, message: "" }, form());

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/too many/i);
  });

  it("returns full success when the order commits and access is established", async () => {
    submitCheckoutMock.mockResolvedValue({ ok: true, orderRef: "PTM-1", publicAccessId: "acc-1", message: "Order created." });
    grantOrderAccessMock.mockResolvedValue(undefined);

    const result = await createOrderAction({ ok: false, message: "" }, form());

    expect(result).toMatchObject({
      ok: true,
      orderPlaced: true,
      accessEstablished: true,
      recoveryRequired: false,
      orderRef: "PTM-1",
      publicAccessId: "acc-1",
    });
  });

  it("returns recoverable PARTIAL success when access establishment fails after commit", async () => {
    submitCheckoutMock.mockResolvedValue({ ok: true, orderRef: "PTM-2", publicAccessId: "acc-2", message: "Order created." });
    grantOrderAccessMock.mockRejectedValue(new Error("secret missing"));

    const result = await createOrderAction({ ok: false, message: "" }, form());

    expect(result.ok).toBe(true);
    expect(result.orderPlaced).toBe(true);
    expect(result.accessEstablished).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.orderRef).toBe("PTM-2");
    expect(result.message).toMatch(/find my order/i);
  });
});
