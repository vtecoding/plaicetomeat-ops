import { describe, expect, it } from "vitest";

import { notificationOpenDispatchId } from "./open-evidence";

describe("notification open evidence", () => {
  it("recovers the dispatch identity after an authenticated redirect", () => {
    expect(notificationOpenDispatchId("verify=challenge&notification=11111111-1111-4111-8111-111111111111"))
      .toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects absent and malformed dispatch identities", () => {
    expect(notificationOpenDispatchId("verify=challenge")).toBeNull();
    expect(notificationOpenDispatchId("notification=not-a-dispatch")).toBeNull();
  });
});
