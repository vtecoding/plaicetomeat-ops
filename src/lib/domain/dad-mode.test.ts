import { describe, expect, it } from "vitest";

import type { OwnerAction } from "@/lib/action-intelligence/action-types";
import {
  buildComplianceWarnings,
  buildStockAttention,
  buildTodayActions,
  buildTodayOrders,
  overallUrgency,
  severityToUrgency,
  URGENCY_LABEL,
} from "./dad-mode";

function action(overrides: Partial<OwnerAction> = {}): OwnerAction {
  return {
    id: overrides.id ?? "a1",
    category: overrides.category ?? "stock",
    group: overrides.group ?? "stock",
    severity: overrides.severity ?? "warning",
    title: overrides.title ?? "Chicken stock may run out soon",
    explanation: overrides.explanation ?? "You currently have 4.2kg left.",
    estimatedImpact: overrides.estimatedImpact ?? "",
    recommendedAction: overrides.recommendedAction ?? "Check whether you need to order more.",
    sourceMetrics: overrides.sourceMetrics ?? {},
    createdAt: overrides.createdAt ?? "2026-06-03T08:00:00.000Z",
    confidence: overrides.confidence ?? "medium",
  };
}

describe("severityToUrgency", () => {
  it("maps internal severities to human urgencies, never the raw word", () => {
    expect(severityToUrgency("urgent")).toBe("urgent");
    expect(severityToUrgency("warning")).toBe("attention");
    expect(severityToUrgency("info")).toBe("important");
  });

  it("has a friendly label for every urgency and no raw enum text", () => {
    const labels = Object.values(URGENCY_LABEL);
    expect(labels).toEqual(["Urgent", "Needs attention", "Important", "All good"]);
    for (const label of labels) {
      expect(label).not.toMatch(/info|warning/i);
    }
  });
});

describe("buildTodayActions", () => {
  it("caps the list at five and reshapes into plain cards", () => {
    const actions = Array.from({ length: 8 }, (_, i) => action({ id: `a${i}`, severity: "info" }));
    const built = buildTodayActions(actions);
    expect(built).toHaveLength(5);
    expect(built[0]).toMatchObject({
      title: "Chicken stock may run out soon",
      why: "You currently have 4.2kg left.",
      suggested: "Check whether you need to order more.",
      actionLabel: "Review stock",
      href: "/admin/inventory",
      urgencyLabel: "Important",
    });
  });

  it("routes each category to a real destination", () => {
    expect(buildTodayActions([action({ category: "compliance" })])[0].href).toBe("/admin/compliance");
    expect(buildTodayActions([action({ category: "margin" })])[0].href).toBe("/admin/products");
    expect(buildTodayActions([action({ category: "customer" })])[0].href).toBe("/admin/orders");
  });

  it("never surfaces a raw lowercase severity word on a card", () => {
    const built = buildTodayActions([action({ severity: "urgent" }), action({ severity: "warning" }), action({ severity: "info" })]);
    const humanLabels = Object.values(URGENCY_LABEL);
    for (const card of built) {
      // The exact raw enum (lowercase) must never be the visible label.
      expect(["info", "warning", "urgent"]).not.toContain(card.urgencyLabel);
      expect(humanLabels).toContain(card.urgencyLabel);
    }
  });
});

describe("buildTodayOrders", () => {
  it("summarises the counter workload", () => {
    expect(buildTodayOrders({ orderCount: 5, awaitingPrep: 2, readyCount: 1 })).toEqual({
      total: 5,
      awaitingPrep: 2,
      ready: 1,
      hasWork: true,
    });
  });

  it("reports no work when nothing is waiting or ready", () => {
    expect(buildTodayOrders({ orderCount: 3, awaitingPrep: 0, readyCount: 0 }).hasWork).toBe(false);
  });
});

describe("buildStockAttention", () => {
  it("shows nothing when stock is healthy", () => {
    expect(buildStockAttention({ batchesExpiringWithin3Days: 0, stockValueAtRisk: 0 })).toEqual([]);
  });

  it("flags expiring stock as urgent", () => {
    const items = buildStockAttention({ batchesExpiringWithin3Days: 2, stockValueAtRisk: 30 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "stock-expiring", urgency: "urgent", urgencyLabel: "Urgent" });
  });

  it("falls back to at-risk value when nothing is imminently expiring", () => {
    const items = buildStockAttention({ batchesExpiringWithin3Days: 0, stockValueAtRisk: 42 });
    expect(items[0]).toMatchObject({ id: "stock-at-risk", urgency: "attention" });
    expect(items[0].detail).toContain("£42");
  });
});

describe("buildComplianceWarnings", () => {
  it("reports no urgent issues when everything is in date", () => {
    expect(
      buildComplianceWarnings({ expiredCertificates: 0, missingCertificates: 0, expiringCertificates: 0 }),
    ).toEqual([]);
  });

  it("orders expired and missing as urgent above expiring", () => {
    const items = buildComplianceWarnings({
      expiredCertificates: 1,
      missingCertificates: 1,
      expiringCertificates: 2,
    });
    expect(items.map((i) => i.id)).toEqual(["cert-expired", "cert-missing", "cert-expiring"]);
    expect(items[0].urgency).toBe("urgent");
    expect(items[2].urgency).toBe("attention");
  });
});

describe("overallUrgency", () => {
  it("escalates to the worst item present", () => {
    expect(overallUrgency([])).toBe("ok");
    expect(
      overallUrgency([{ id: "x", title: "", detail: "", urgency: "attention", urgencyLabel: "Needs attention" }]),
    ).toBe("attention");
    expect(
      overallUrgency([
        { id: "x", title: "", detail: "", urgency: "attention", urgencyLabel: "Needs attention" },
        { id: "y", title: "", detail: "", urgency: "urgent", urgencyLabel: "Urgent" },
      ]),
    ).toBe("urgent");
  });
});
