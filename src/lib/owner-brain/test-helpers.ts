/**
 * Shared fixtures for the owner-brain unit tests. Imported only by `*.test.ts` files.
 */
import { buildShopIntelligence } from "@/lib/shop-intelligence/engine";
import { makeSnapshot } from "@/lib/shop-intelligence/test-helpers";
import type { ShopSnapshot } from "@/lib/shop-intelligence/snapshot";
import type { Finding, ShopIntelligence } from "@/lib/shop-intelligence/types";

export function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: "consistency-expired-active",
    area: "consistency",
    finding: "Out-of-date stock is still counted as good",
    severity: "urgent",
    explanation: "1 active batch is past the use-by date (12kg) but still marked sellable.",
    consequence: "Out-of-date meat could be sold — a food-safety risk, and it inflates your stock value.",
    recommendedAction: "Pull these batches now: record them as waste so they leave sellable stock.",
    confidence: "high",
    basis: { confidence: "high", summary: "Based on confirmed shop records", points: [] },
    playbook: { slug: "recording-waste", title: "Recording waste" },
    metrics: [
      { label: "Batches", value: "1" },
      { label: "Weight", value: "12kg" },
    ],
    source: "engine",
    ...over,
  };
}

/** A full V8 ShopIntelligence built from the shared snapshot fixture. */
export function makeIntel(over: Partial<ShopSnapshot> = {}): ShopIntelligence {
  return buildShopIntelligence(makeSnapshot(over));
}
