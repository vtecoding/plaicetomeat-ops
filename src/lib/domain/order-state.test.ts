import { describe, expect, it } from "vitest";

import { assertValidOrderTransition, canTransitionOrder } from "./order-state";

describe("order state transitions", () => {
  it("accepts valid transitions", () => {
    expect(canTransitionOrder("incoming", "prepping")).toBe(true);
    expect(canTransitionOrder("prepping", "ready")).toBe(true);
    expect(canTransitionOrder("ready", "collected")).toBe(true);
    expect(canTransitionOrder("incoming", "cancelled")).toBe(true);
    expect(canTransitionOrder("prepping", "cancelled")).toBe(true);
  });

  it("rejects invalid transitions with a clear error", () => {
    expect(canTransitionOrder("collected", "prepping")).toBe(false);
    expect(() => assertValidOrderTransition("collected", "prepping")).toThrow(
      "Invalid order transition from collected to prepping.",
    );
  });
});
