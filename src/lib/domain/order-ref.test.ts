import { describe, expect, it } from "vitest";

import { generateOrderRef, isOrderRef } from "./order-ref";

describe("order reference", () => {
  it("formats PTM-YYYY-NNNNN", () => {
    const ref = generateOrderRef(new Date("2026-05-29T12:00:00"), 42);

    expect(ref).toBe("PTM-2026-00042");
    expect(isOrderRef(ref)).toBe(true);
  });
});
