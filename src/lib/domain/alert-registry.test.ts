import { describe, expect, it } from "vitest";

import { ALERT_KINDS, ALERT_KIND_LIST, alertHref, alertSpecFor, canManuallyResolveAlert } from "./alert-registry";
import { RECONCILE_KIND_LIST } from "./reconciliation";

describe("owner alert registry", () => {
  it("gives every canonical kind one action, resolution rule and href builder", () => {
    expect(ALERT_KIND_LIST.length).toBeGreaterThan(15);
    for (const kind of ALERT_KIND_LIST) {
      const spec = ALERT_KINDS[kind];
      expect(["inline-cost", "confirm-reason", "link", "note-resolve"]).toContain(spec.action);
      expect([null, "stock-touch", "checklist-step-complete", "opening-complete", "certificate-renewal-or-window"]).toContain(spec.autoResolve);
      expect(typeof spec.href).toBe("function");
      expect(spec.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("preserves the exact two richer reconciliation behaviours", () => {
    expect([...RECONCILE_KIND_LIST].sort()).toEqual([
      "operator_delivery_cost_pending",
      "operator_waste_reason_check",
    ]);
    expect(alertSpecFor("operator_delivery_cost_pending").action).toBe("inline-cost");
    expect(alertSpecFor("operator_waste_reason_check").action).toBe("confirm-reason");
  });

  it("links certificate, shortfall, closing-money and mistake jobs to their work", () => {
    expect(alertHref("certificate_expiring", "supplier_document:abc")).toBe("/admin/compliance");
    expect(alertHref("inventory_shortfall", "order:abc")).toBe("/admin/inventory");
    expect(alertHref("till_variance", "close:abc")).toBe("/admin/orders");
    expect(alertHref("operator_mistake_flag", "order:abc")).toBe("/admin/orders");
    expect(alertSpecFor("certificate_expiring").autoResolve).toBe("certificate-renewal-or-window");
    expect(alertSpecFor("not_opened_by_time").autoResolve).toBe("opening-complete");
    expect(alertSpecFor("operator_waste_recovery_needed")).toMatchObject({
      title: "Reconcile interrupted waste",
      action: "link",
      autoResolve: null,
    });
    expect(alertHref("operator_waste_recovery_needed", "run-id")).toBe("/admin/inventory");
  });

  it("keeps unknown historical rows clearable instead of orphaning them", () => {
    expect(alertSpecFor("old_kind_from_a_shipped_build")).toMatchObject({
      action: "note-resolve",
      autoResolve: null,
    });
  });

  it("never lets a note bypass a truth-backed automatic resolution rule", () => {
    expect(canManuallyResolveAlert("inventory_shortfall")).toBe(false);
    expect(canManuallyResolveAlert("operator_checklist_help")).toBe(false);
    expect(canManuallyResolveAlert("checklist_skip")).toBe(false);
    expect(canManuallyResolveAlert("not_opened_by_time")).toBe(false);
    expect(canManuallyResolveAlert("certificate_expiring")).toBe(false);
    expect(canManuallyResolveAlert("operator_delivery_check_needed")).toBe(true);
    expect(canManuallyResolveAlert("operator_help")).toBe(true);
    expect(canManuallyResolveAlert("unknown_historical_kind")).toBe(true);
  });
});
