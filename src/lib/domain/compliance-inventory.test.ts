import { describe, expect, it } from "vitest";

import { getCertificateState } from "@/lib/domain/compliance-inventory";

describe("certificate status", () => {
  const now = new Date("2026-05-31T12:00:00.000Z");

  it("requires an expiry date and verification before showing valid", () => {
    expect(getCertificateState({ certExpiry: null, verifiedAt: null }, now)).toBe("missing");
    expect(getCertificateState({ certExpiry: "2026-08-31", verifiedAt: null }, now)).toBe("unverified");
  });

  it("marks verified certificates by expiry risk", () => {
    expect(getCertificateState({ certExpiry: "2026-08-31", verifiedAt: "2026-05-30T10:00:00.000Z" }, now)).toBe("valid");
    expect(getCertificateState({ certExpiry: "2026-06-10", verifiedAt: "2026-05-30T10:00:00.000Z" }, now)).toBe("expiring_soon");
    expect(getCertificateState({ certExpiry: "2026-05-30", verifiedAt: "2026-05-30T10:00:00.000Z" }, now)).toBe("expired");
  });
});
