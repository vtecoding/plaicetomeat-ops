import { describe, expect, it } from "vitest";

import { renderReadySmsTemplate, shouldSendReadySms } from "./sms";

describe("ready SMS", () => {
  it("renders branch configurable placeholders", () => {
    expect(
      renderReadySmsTemplate({
        template: "Order {order_ref} is ready at {address}.",
        orderRef: "PTM-260529-0042",
        address: "426 Birmingham Road",
      }),
    ).toBe("Order PTM-260529-0042 is ready at 426 Birmingham Road.");
  });

  it("blocks duplicate sends once ready_sms_sent_at is set", () => {
    expect(shouldSendReadySms(null)).toBe(true);
    expect(shouldSendReadySms("2026-05-29T12:00:00.000Z")).toBe(false);
  });
});
