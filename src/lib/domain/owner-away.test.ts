import { describe, expect, it } from "vitest";

import { buildOwnerAwayHeadline, formatSimpleCount, ownerAwayStatusLabel } from "./owner-away";

describe("owner away copy", () => {
  it("makes owner checks the loudest state", () => {
    expect(
      buildOwnerAwayHeadline({
        ownerAway: true,
        shopOpened: true,
        openAlertCount: 1,
        orderCount: 4,
        evidenceReviewCount: 0,
        certificateReviewCount: 0,
      }),
    ).toBe("Owner checks needed");
  });

  it("keeps the quiet running state plain", () => {
    expect(
      buildOwnerAwayHeadline({
        ownerAway: true,
        shopOpened: true,
        openAlertCount: 0,
        orderCount: 3,
        evidenceReviewCount: 0,
        certificateReviewCount: 0,
      }),
    ).toBe("Shop is running while you are away");
  });

  it("does not hide a missing opening", () => {
    expect(
      buildOwnerAwayHeadline({
        ownerAway: true,
        shopOpened: false,
        openAlertCount: 0,
        orderCount: 0,
        evidenceReviewCount: 0,
        certificateReviewCount: 0,
      }),
    ).toBe("Shop not opened yet");
  });

  it("formats the status and simple counts without jargon", () => {
    expect(ownerAwayStatusLabel(true)).toBe("Owner Away is on");
    expect(ownerAwayStatusLabel(false)).toBe("Owner Away is off");
    expect(formatSimpleCount(1, "photo")).toBe("1 photo");
    expect(formatSimpleCount(2, "photo")).toBe("2 photos");
  });
});
