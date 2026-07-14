import { describe, expect, it } from "vitest";

import { buildOwnerDigest } from "./owner-digest";

describe("owner daily digest", () => {
  it("snapshots every audit §13 fact in plain English", () => {
    expect(
      buildOwnerDigest({
        businessDate: "2026-07-14",
        openedBy: "Gul",
        closedBy: "Amina",
        totalTakingsPence: 48250,
        cashTakingsPence: 19750,
        cardTakingsPence: 28500,
        tillResult: "Till was £5.00 short",
        deliveryCount: 2,
        pendingDeliveryCosts: 1,
        wasteCount: 3,
        wasteKg: 1.25,
        shortfallCount: 1,
        openAlertCount: 4,
      }),
    ).toMatchInlineSnapshot(`
      "PlaiceToMeat — Tue, 14 Jul
      Opened by Gul.
      Closed by Amina.
      Takings £482.50: £197.50 cash, £285.00 card.
      Till was £5.00 short.
      2 deliveries; 1 cost still to add.
      3 waste entries (1.25kg).
      1 stock shortfall.
      4 owner jobs open."
    `);
  });

  it("says plainly when the day needs no owner action", () => {
    expect(
      buildOwnerDigest({
        businessDate: "2026-07-14",
        openedBy: "Gul",
        closedBy: "Gul",
        totalTakingsPence: 0,
        cashTakingsPence: 0,
        cardTakingsPence: 0,
        tillResult: "Till matched",
        deliveryCount: 0,
        pendingDeliveryCosts: 0,
        wasteCount: 0,
        wasteKg: 0,
        shortfallCount: 0,
        openAlertCount: 0,
      }),
    ).toContain("Nothing needs you today.");
  });
});
