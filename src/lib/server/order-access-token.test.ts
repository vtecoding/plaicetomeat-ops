import { describe, expect, it } from "vitest";

import { decodeGrants, encodeGrants, type Grant } from "./order-access-token";

const SECRET = "v11-unit-test-order-access-secret-32bytes-min";
const grants: Grant[] = [{ i: "11111111-1111-4111-8111-111111111111", v: 1 }];

describe("order-access token signing (V11.1)", () => {
  it("round-trips signed grants", () => {
    const token = encodeGrants(grants, SECRET);
    expect(decodeGrants(token, SECRET)).toEqual(grants);
  });

  it("rejects a token signed with a different secret", () => {
    const token = encodeGrants(grants, SECRET);
    expect(decodeGrants(token, "a-completely-different-secret-of-len-32!!")).toEqual([]);
  });

  it("rejects a tampered payload (forged grant)", () => {
    const token = encodeGrants(grants, SECRET);
    const [payload, sig] = token.split(".");
    // Re-encode a different grant but keep the original signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ g: [{ i: "22222222-2222-4222-8222-222222222222", v: 1 }], iat: Date.now() }),
    ).toString("base64url");
    expect(decodeGrants(`${forgedPayload}.${sig}`, SECRET)).toEqual([]);
    expect(payload).toBeTruthy();
  });

  it("rejects a flipped signature byte", () => {
    const token = encodeGrants(grants, SECRET);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(decodeGrants(flipped, SECRET)).toEqual([]);
  });

  it("rejects malformed / empty tokens", () => {
    expect(decodeGrants(undefined, SECRET)).toEqual([]);
    expect(decodeGrants("", SECRET)).toEqual([]);
    expect(decodeGrants("noseparator", SECRET)).toEqual([]);
    expect(decodeGrants(".", SECRET)).toEqual([]);
  });

  it("drops malformed grant entries", () => {
    const token = encodeGrants(
      [{ i: "33333333-3333-4333-8333-333333333333", v: 2 }, { i: 5 as unknown as string, v: 1 }],
      SECRET,
    );
    expect(decodeGrants(token, SECRET)).toEqual([{ i: "33333333-3333-4333-8333-333333333333", v: 2 }]);
  });
});
