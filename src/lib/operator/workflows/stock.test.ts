import { describe, expect, it } from "vitest";

import { deliveryNeedsOwnerCheck, expiryDateFromChoice, storageLabel } from "./stock";

describe("operator stock workflow helpers", () => {
  it("turns simple expiry buttons into dates", () => {
    const today = new Date("2026-06-12T10:00:00.000Z");

    expect(expiryDateFromChoice("today", today)).toBe("2026-06-12");
    expect(expiryDateFromChoice("tomorrow", today)).toBe("2026-06-13");
    expect(expiryDateFromChoice("two_days", today)).toBe("2026-06-14");
    expect(expiryDateFromChoice("not_sure", today)).toBe("2026-06-12");
  });

  it("marks simple gaps for owner check", () => {
    expect(
      deliveryNeedsOwnerCheck({
        supplierKnown: true,
        expiryChoice: "tomorrow",
        storageChoice: "fridge",
        photoProvided: true,
      }),
    ).toBe(false);

    expect(
      deliveryNeedsOwnerCheck({
        supplierKnown: true,
        expiryChoice: "not_sure",
        storageChoice: "fridge",
        photoProvided: true,
      }),
    ).toBe(true);
  });

  it("has a calm fallback label", () => {
    expect(storageLabel("not_sure")).toBe("Not sure");
    expect(storageLabel(undefined)).toBe("Not sure");
  });
});
