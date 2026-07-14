import { describe, expect, it } from "vitest";

import { branchLocalDayStartIso, parseOwnerAwayAggregates } from "@/lib/domain/owner-away-accuracy";

describe("Owner Away aggregate accuracy", () => {
  it("keeps a >20-order truth count while the preview remains capped at 20", () => {
    const preview = Array.from({ length: 20 }, (_, index) => ({ id: `preview-${index}` }));
    const totals = parseOwnerAwayAggregates({ order_count: "27", revenue: "814.35" });
    expect(preview).toHaveLength(20);
    expect(totals.orderCount).toBe(27);
    expect(totals.revenue).toBe(814.35);
  });

  it("normalises database count and sum values", () => {
    expect(parseOwnerAwayAggregates({ delivery_count: 55, delivered_kg: "150.25", waste_count: 230, open_alert_count: 31, critical_alert_count: 4 }))
      .toMatchObject({ deliveryCount: 55, deliveredKg: 150.25, wasteCount: 230, openAlertCount: 31, criticalAlertCount: 4 });
  });

  it("starts an off-mode window at branch-local midnight across GMT and BST", () => {
    expect(branchLocalDayStartIso(new Date("2026-01-14T12:00:00Z"), "Europe/London")).toBe("2026-01-14T00:00:00.000Z");
    expect(branchLocalDayStartIso(new Date("2026-07-14T12:00:00Z"), "Europe/London")).toBe("2026-07-13T23:00:00.000Z");
  });

  it("keeps simultaneous branches on their own local calendar date", () => {
    const instant = new Date("2026-07-14T00:30:00Z");
    expect(branchLocalDayStartIso(instant, "Europe/London")).toBe("2026-07-13T23:00:00.000Z");
    expect(branchLocalDayStartIso(instant, "America/Los_Angeles")).toBe("2026-07-13T07:00:00.000Z");
  });
});
