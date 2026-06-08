import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./utils";

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-08T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("says 'just now' under a minute", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(0.5), now)).toBe("just now");
  });

  it("keeps minutes up to 90 minutes", () => {
    expect(formatRelativeTime(ago(1), now)).toBe("1 min ago");
    expect(formatRelativeTime(ago(45), now)).toBe("45 min ago");
    expect(formatRelativeTime(ago(89), now)).toBe("89 min ago");
  });

  it("rolls up into hours between 90 minutes and 48 hours", () => {
    expect(formatRelativeTime(ago(90), now)).toBe("1 hour ago");
    expect(formatRelativeTime(ago(150), now)).toBe("2 hours ago");
    expect(formatRelativeTime(ago(47 * 60), now)).toBe("47 hours ago");
  });

  it("rolls up into whole days past 48 hours", () => {
    expect(formatRelativeTime(ago(48 * 60), now)).toBe("2 days ago");
    // The audit's "3142 min ago" / "3495 min ago" must read as days.
    expect(formatRelativeTime(ago(3142), now)).toBe("2 days ago");
    expect(formatRelativeTime(ago(3495), now)).toBe("2 days ago");
    expect(formatRelativeTime(ago(8 * 24 * 60), now)).toBe("8 days ago");
  });

  it("never shows a negative or future age", () => {
    expect(formatRelativeTime(ago(-30), now)).toBe("just now");
  });

  it("accepts an ISO string", () => {
    expect(formatRelativeTime("2026-06-06T12:00:00Z", now)).toBe("2 days ago");
  });
});
