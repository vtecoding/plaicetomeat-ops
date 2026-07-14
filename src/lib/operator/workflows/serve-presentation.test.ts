import { describe, expect, it } from "vitest";

import {
  formatServeLineName,
  formatServePresetLabel,
  savedServeTotalMessage,
} from "@/lib/operator/workflows/serve-presentation";

describe("serve price presentation", () => {
  it("shows an approximate line price on weight and count presets", () => {
    expect(formatServePresetLabel("500g", 0.5, 9)).toBe("500g — ≈ £4.50");
    expect(formatServePresetLabel("6", 6, 2.25)).toBe("6 — ≈ £13.50");
  });

  it("uses multiplication language for counted summaries", () => {
    expect(formatServeLineName("Eggs", 12, "each")).toBe("Eggs ×12");
    expect(formatServeLineName("Curry box", 2, "box")).toBe("Curry box ×2");
    expect(formatServeLineName("Chicken", 0.5, "kg", "500g")).toBe("Chicken 500g");
  });

  it("surfaces a server-side price change and always states the saved total", () => {
    expect(savedServeTotalMessage(10, 10)).toBe("Saved. Total £10.00.");
    expect(savedServeTotalMessage(10, 11.25)).toBe("Price updated. Total £11.25.");
  });
});
