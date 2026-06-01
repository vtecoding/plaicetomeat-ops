import { describe, expect, it } from "vitest";

import { deriveLaunchReadiness, type LaunchSignals } from "./launch-readiness";

const ready: LaunchSignals = {
  productCount: 12,
  zeroPriceProductCount: 0,
  activePickupWindowCount: 3,
  certificatesConfigured: true,
  expiredCertificates: 0,
  anyOrderPlaced: true,
  staffAccountCount: 2,
  smsSendingEnabled: false,
};

describe("launch readiness", () => {
  it("reports not_started when nothing has been set up", () => {
    const result = deriveLaunchReadiness({
      productCount: 0,
      zeroPriceProductCount: 0,
      activePickupWindowCount: 0,
      certificatesConfigured: false,
      expiredCertificates: 0,
      anyOrderPlaced: false,
      staffAccountCount: 0,
      smsSendingEnabled: false,
    });
    expect(result.overall).toBe("not_started");
  });

  it("is ready when every checkable signal is satisfied (texts off is fine)", () => {
    const result = deriveLaunchReadiness(ready);
    expect(result.overall).toBe("ready");
  });

  it("never blocks readiness on manual-confirmation items", () => {
    const result = deriveLaunchReadiness(ready);
    const manual = result.items.filter((item) => item.status === "manual");
    expect(manual.map((item) => item.key)).toEqual(["owner_account", "public_pages"]);
    // Manual items are excluded from the auto-checked count.
    expect(result.autoCheckedCount).toBe(result.items.length - manual.length);
  });

  it("flags a £0 product as needing attention without faking confidence", () => {
    const result = deriveLaunchReadiness({ ...ready, zeroPriceProductCount: 1 });
    expect(result.overall).toBe("attention");
    expect(result.items.find((item) => item.key === "prices")?.status).toBe("attention");
  });

  it("treats expired certificates as attention", () => {
    const result = deriveLaunchReadiness({ ...ready, expiredCertificates: 2 });
    expect(result.items.find((item) => item.key === "certificates")?.status).toBe("attention");
    expect(result.overall).toBe("attention");
  });

  it("requires a real dry-run order", () => {
    const result = deriveLaunchReadiness({ ...ready, anyOrderPlaced: false });
    expect(result.items.find((item) => item.key === "dry_run")?.status).toBe("attention");
  });

  it("requires a non-owner staff account", () => {
    const result = deriveLaunchReadiness({ ...ready, staffAccountCount: 0 });
    expect(result.items.find((item) => item.key === "staff_account")?.status).toBe("attention");
  });
});
