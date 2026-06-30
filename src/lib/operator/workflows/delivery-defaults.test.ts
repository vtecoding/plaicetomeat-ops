import { describe, expect, it } from "vitest";

import {
  hasConfidentSupplier,
  initialSelectionFromDefaults,
  resolveDeliveryDefaults,
  type ActiveSupplier,
  type DeliveryHistoryEntry,
} from "./delivery-defaults";

const SUPPLIERS: ActiveSupplier[] = [
  { id: "pak", name: "Pak Halal" },
  { id: "abc", name: "ABC Meats" },
];

function entry(partial: Partial<DeliveryHistoryEntry> & { productId: string }): DeliveryHistoryEntry {
  return {
    supplierId: "pak",
    storageLabel: "Fridge",
    receivedDate: "2026-06-20",
    expiryDate: "2026-06-21",
    ...partial,
  };
}

describe("resolveDeliveryDefaults — supplier", () => {
  it("uses the last supplier used for this product (most recent wins)", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [
        entry({ productId: "chicken", supplierId: "abc", receivedDate: "2026-06-25" }),
        entry({ productId: "chicken", supplierId: "pak", receivedDate: "2026-06-10" }),
      ],
    });
    expect(defaults.supplier).toMatchObject({ value: "abc", label: "ABC Meats", source: "last_used" });
  });

  it("uses the most frequent supplier when the latest delivery recorded none", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [
        entry({ productId: "chicken", supplierId: null, receivedDate: "2026-06-25" }),
        entry({ productId: "chicken", supplierId: "pak", receivedDate: "2026-06-20" }),
        entry({ productId: "chicken", supplierId: "pak", receivedDate: "2026-06-18" }),
        entry({ productId: "chicken", supplierId: "abc", receivedDate: "2026-06-15" }),
      ],
    });
    expect(defaults.supplier).toMatchObject({ value: "pak", source: "most_frequent" });
  });

  it("uses the only active supplier when exactly one exists and there is no history", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "lamb",
      suppliers: [{ id: "pak", name: "Pak Halal" }],
      history: [],
    });
    expect(defaults.supplier).toMatchObject({ value: "pak", source: "only_active" });
  });

  it("returns no supplier default when ambiguous (no history, several suppliers)", () => {
    const defaults = resolveDeliveryDefaults({ productId: "beef", suppliers: SUPPLIERS, history: [] });
    expect(defaults.supplier).toMatchObject({ value: null, source: null });
    expect(hasConfidentSupplier(defaults)).toBe(false);
  });
});

describe("resolveDeliveryDefaults — storage", () => {
  it("uses the last storage location used for this product", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [
        entry({ productId: "chicken", storageLabel: "Freezer", receivedDate: "2026-06-25" }),
        entry({ productId: "chicken", storageLabel: "Fridge", receivedDate: "2026-06-10" }),
      ],
    });
    expect(defaults.storage).toMatchObject({ value: "freezer", source: "last_used" });
  });

  it("returns no storage default when history only has unknown locations", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [entry({ productId: "chicken", storageLabel: "Not sure" })],
    });
    expect(defaults.storage).toMatchObject({ value: null });
  });
});

describe("resolveDeliveryDefaults — expiry", () => {
  it("uses the last received→expiry pattern where it maps to a quick choice", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [entry({ productId: "chicken", receivedDate: "2026-06-25", expiryDate: "2026-06-27" })], // +2 days
    });
    expect(defaults.expiry).toMatchObject({ value: "two_days", source: "last_pattern" });
  });

  it("falls back to the conservative safe default (tomorrow) when there is no usable pattern", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [entry({ productId: "chicken", receivedDate: "2026-06-25", expiryDate: "2026-07-30" })], // far out → not a quick choice
    });
    expect(defaults.expiry).toMatchObject({ value: "tomorrow", source: "safe_default" });
  });

  it("uses the safe default for a brand-new product with no history", () => {
    const defaults = resolveDeliveryDefaults({ productId: "new", suppliers: SUPPLIERS, history: [] });
    expect(defaults.expiry).toMatchObject({ value: "tomorrow", source: "safe_default" });
  });
});

describe("initialSelectionFromDefaults", () => {
  it("seeds the confirm screen from the defaults' values (what gets persisted unless corrected)", () => {
    const defaults = resolveDeliveryDefaults({
      productId: "chicken",
      suppliers: SUPPLIERS,
      history: [entry({ productId: "chicken", supplierId: "pak", storageLabel: "Fridge", receivedDate: "2026-06-25", expiryDate: "2026-06-26" })],
    });
    expect(initialSelectionFromDefaults(defaults)).toEqual({ supplierId: "pak", storageChoice: "fridge", expiryChoice: "tomorrow" });
  });
});
