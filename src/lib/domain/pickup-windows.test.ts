import { describe, expect, it } from "vitest";

import type { PickupWindow } from "./types";
import { isBeforeCutoff, validatePickupWindowForDate } from "./pickup-windows";

const commuterWindow: PickupWindow = {
  id: "window-1",
  branchId: "branch-1",
  label: "Drive Home Pickup",
  startTime: "16:30",
  endTime: "17:30",
  cutoffTime: "15:30",
  maxOrders: 30,
  daysOfWeek: [1, 2, 3, 4, 5],
  windowType: "commuter",
  isActive: true,
};

describe("pickup window validation", () => {
  it("validates cutoff before, at, and after cutoff", () => {
    expect(isBeforeCutoff("15:29", "15:30")).toBe(true);
    expect(isBeforeCutoff("15:30", "15:30")).toBe(false);
    expect(isBeforeCutoff("15:31", "15:30")).toBe(false);
  });

  it("accepts valid days of week and rejects wrong days", () => {
    expect(
      validatePickupWindowForDate({
        pickupWindow: commuterWindow,
        pickupDate: "2026-06-01",
        now: new Date("2026-05-29T10:00:00"),
      }).valid,
    ).toBe(true);

    expect(
      validatePickupWindowForDate({
        pickupWindow: commuterWindow,
        pickupDate: "2026-05-31",
        now: new Date("2026-05-29T10:00:00"),
      }),
    ).toEqual({
      valid: false,
      reason: "Pickup window is not available on that day.",
    });
  });

  it("rejects same-day submissions at cutoff", () => {
    expect(
      validatePickupWindowForDate({
        pickupWindow: commuterWindow,
        pickupDate: "2026-05-29",
        now: new Date("2026-05-29T15:30:00"),
      }),
    ).toEqual({
      valid: false,
      reason: "Pickup cutoff has passed for this window.",
    });
  });
});
