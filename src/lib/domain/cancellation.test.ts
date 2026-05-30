import { describe, expect, it } from "vitest";

import { canCustomerCancelOrder } from "./cancellation";

describe("customer cancellation", () => {
  it("allows incoming orders within the window", () => {
    expect(
      canCustomerCancelOrder({
        status: "incoming",
        createdAt: "2026-05-29T10:00:00.000Z",
        cancellationWindowMinutes: 60,
        now: new Date("2026-05-29T10:59:59.000Z"),
      }).allowed,
    ).toBe(true);
  });

  it("rejects prepping orders and expired windows", () => {
    expect(
      canCustomerCancelOrder({
        status: "prepping",
        createdAt: "2026-05-29T10:00:00.000Z",
        cancellationWindowMinutes: 60,
        now: new Date("2026-05-29T10:10:00.000Z"),
      }).allowed,
    ).toBe(false);

    expect(
      canCustomerCancelOrder({
        status: "incoming",
        createdAt: "2026-05-29T10:00:00.000Z",
        cancellationWindowMinutes: 60,
        now: new Date("2026-05-29T11:00:01.000Z"),
      }).allowed,
    ).toBe(false);
  });
});
