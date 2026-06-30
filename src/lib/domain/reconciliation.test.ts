import { describe, expect, it } from "vitest";

import {
  batchIdFromCostRef,
  isReconcileKind,
  RECONCILE_KIND_LIST,
  reconcileSpecFor,
} from "./reconciliation";

describe("reconciliation classification", () => {
  it("batches exactly the two low-urgency bookkeeping kinds", () => {
    expect(RECONCILE_KIND_LIST.sort()).toEqual(["operator_delivery_cost_pending", "operator_waste_reason_check"]);
  });

  it("never batches an urgent operator kind (help / stock / unknown-product stay individual)", () => {
    for (const urgent of [
      "operator_help",
      "operator_stock_ran_out",
      "operator_delivery_unknown_supplier",
      "operator_waste_unknown_product",
    ]) {
      expect(isReconcileKind(urgent)).toBe(false);
      expect(reconcileSpecFor(urgent)).toBeNull();
    }
  });

  it("classifies cost-pending and waste-reason as inline (Class A) with their actions", () => {
    expect(reconcileSpecFor("operator_delivery_cost_pending")).toMatchObject({ klass: "inline", action: "delivery-cost" });
    expect(reconcileSpecFor("operator_waste_reason_check")).toMatchObject({ klass: "inline", action: "waste-reason" });
  });
});

describe("batchIdFromCostRef", () => {
  const uuid = "00000000-0000-4000-8000-000000000601";

  it("recovers the batch id from a `${batchId}:cost` ref", () => {
    expect(batchIdFromCostRef(`${uuid}:cost`)).toBe(uuid);
  });

  it("accepts a bare batch uuid too", () => {
    expect(batchIdFromCostRef(uuid)).toBe(uuid);
  });

  it("returns null for a non-uuid or empty ref", () => {
    expect(batchIdFromCostRef("not-a-uuid:cost")).toBeNull();
    expect(batchIdFromCostRef(null)).toBeNull();
    expect(batchIdFromCostRef("")).toBeNull();
  });
});
