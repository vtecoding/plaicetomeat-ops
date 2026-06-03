import { describe, expect, it } from "vitest";

import {
  buildLaunchSafety,
  buildSetupChecklist,
  setupProgress,
  setupStatusLabel,
  type SetupSignals,
} from "./setup-checklist";

function signals(overrides: Partial<SetupSignals> = {}): SetupSignals {
  return {
    productCount: 5,
    zeroPriceProductCount: 0,
    demoProductsPresent: false,
    activePickupWindowCount: 2,
    certificatesConfigured: true,
    expiredCertificates: 0,
    expiringCertificates: 0,
    staffAccountCount: 1,
    anyOrderPlaced: true,
    checkoutTestModeEnabled: false,
    adminRoutesProtected: true,
    ...overrides,
  };
}

describe("buildSetupChecklist", () => {
  it("produces the five owner setup sections", () => {
    const sections = buildSetupChecklist(signals());
    expect(sections.map((s) => s.key)).toEqual(["business", "product", "security", "compliance", "operations"]);
  });

  it("marks verifiable items done when the data is healthy", () => {
    const sections = buildSetupChecklist(signals());
    const product = sections.find((s) => s.key === "product")!;
    const realProducts = product.items.find((i) => i.key === "real-products")!;
    const demoRemoved = product.items.find((i) => i.key === "demo-removed")!;
    expect(realProducts.status).toBe("done");
    expect(demoRemoved.status).toBe("done");
  });

  it("flags demo products and missing prices as not done", () => {
    const sections = buildSetupChecklist(signals({ demoProductsPresent: true, zeroPriceProductCount: 2 }));
    const product = sections.find((s) => s.key === "product")!;
    expect(product.items.find((i) => i.key === "demo-removed")!.status).toBe("todo");
    expect(product.items.find((i) => i.key === "prices")!.status).toBe("todo");
  });

  it("keeps security back-door items as human-confirmed (never auto-done)", () => {
    const sections = buildSetupChecklist(signals());
    const security = sections.find((s) => s.key === "security")!;
    expect(security.items.find((i) => i.key === "temp-owner")!.status).toBe("manual");
    expect(security.items.find((i) => i.key === "test-accounts")!.status).toBe("manual");
  });
});

describe("buildLaunchSafety", () => {
  it("auto-verifies checkout test mode and route protection", () => {
    const items = buildLaunchSafety(signals());
    expect(items.find((i) => i.key === "checkout-test-mode")!.status).toBe("done");
    expect(items.find((i) => i.key === "routes-protected")!.status).toBe("done");
  });

  it("flags checkout test mode left on as not done", () => {
    const items = buildLaunchSafety(signals({ checkoutTestModeEnabled: true }));
    expect(items.find((i) => i.key === "checkout-test-mode")!.status).toBe("todo");
  });
});

describe("setupStatusLabel + setupProgress", () => {
  it("uses plain-English status labels", () => {
    expect(setupStatusLabel("done")).toBe("Done");
    expect(setupStatusLabel("todo")).toBe("Not done");
    expect(setupStatusLabel("manual")).toBe("Check yourself");
  });

  it("counts only auto-verifiable items in the progress summary", () => {
    const progress = setupProgress(buildSetupChecklist(signals()));
    expect(progress.auto).toBeGreaterThan(0);
    expect(progress.done).toBeLessThanOrEqual(progress.auto);
  });
});
