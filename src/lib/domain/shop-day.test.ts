import { describe, expect, it } from "vitest";

import {
  canPerformShopDayAction,
  deriveShopDayPhase,
  shopDayActionInstruction,
  transitionShopDay,
  unresolvedGateObligations,
  type ShopDayObligation,
  type ShopDayPhase,
} from "./shop-day";

describe("deriveShopDayPhase", () => {
  it.each([
    [null, null, "not_open"],
    ["abandoned", null, "not_open"],
    ["in_progress", null, "opening"],
    ["completed", null, "trading"],
    ["completed", "abandoned", "trading"],
    ["completed", "in_progress", "closing"],
    ["completed", "completed", "closed"],
  ] as const)("maps opening=%s closing=%s to %s", (openingStatus, closingStatus, phase) => {
    expect(deriveShopDayPhase({ openingStatus, closingStatus })).toEqual({ ok: true, phase });
  });

  it.each(["in_progress", "completed"] as const)("rejects %s closing without a completed opening", (closingStatus) => {
    expect(deriveShopDayPhase({ openingStatus: null, closingStatus })).toEqual({
      ok: false,
      reason: "closing_without_opening",
    });
  });
});

describe("transitionShopDay", () => {
  const openingBlocker: ShopDayObligation = { id: "opening-temperature", gate: "opening", status: "pending" };
  const closingBlocker: ShopDayObligation = { id: "till-variance", gate: "closing", status: "deferred" };

  it("follows the canonical shop-day sequence", () => {
    expect(transitionShopDay("not_open", "start_opening")).toEqual({ ok: true, phase: "opening", changed: true });
    expect(transitionShopDay("opening", "complete_opening")).toEqual({ ok: true, phase: "trading", changed: true });
    expect(transitionShopDay("trading", "start_closing")).toEqual({ ok: true, phase: "closing", changed: true });
    expect(transitionShopDay("closing", "complete_closing")).toEqual({ ok: true, phase: "closed", changed: true });
  });

  it("makes repeated commands safe and idempotent", () => {
    expect(transitionShopDay("opening", "start_opening")).toMatchObject({ ok: true, changed: false });
    expect(transitionShopDay("trading", "complete_opening")).toMatchObject({ ok: true, changed: false });
    expect(transitionShopDay("closing", "start_closing")).toMatchObject({ ok: true, changed: false });
    expect(transitionShopDay("closed", "complete_closing")).toMatchObject({ ok: true, changed: false });
  });

  it("does not complete opening while a required check is unresolved", () => {
    expect(transitionShopDay("opening", "complete_opening", [openingBlocker])).toEqual({
      ok: false,
      phase: "opening",
      reason: "opening_checks_incomplete",
      instruction: "Finish the required opening checks before opening the shop.",
      blockerIds: ["opening-temperature"],
    });
  });

  it("does not treat Later as completion for a required close obligation", () => {
    expect(transitionShopDay("closing", "complete_closing", [closingBlocker])).toMatchObject({
      ok: false,
      reason: "closing_checks_incomplete",
      blockerIds: ["till-variance"],
    });
  });

  it("rejects out-of-order transitions with a human instruction", () => {
    expect(transitionShopDay("not_open", "start_closing")).toMatchObject({
      ok: false,
      reason: "shop_not_open",
      instruction: "Finish opening the shop before starting the close.",
    });
    expect(transitionShopDay("trading", "complete_closing")).toMatchObject({
      ok: false,
      reason: "closing_not_started",
      instruction: "Start the closing checks first.",
    });
  });

  it.each(["not_open", "opening", "closing", "closed"] as ShopDayPhase[])(
    "blocks trading actions in %s",
    (phase) => {
      expect(canPerformShopDayAction(phase, "serve_customer")).toBe(false);
    },
  );

  it("allows operational actions while trading", () => {
    expect(canPerformShopDayAction("trading", "serve_customer")).toBe(true);
    expect(canPerformShopDayAction("trading", "receive_delivery")).toBe(true);
    expect(canPerformShopDayAction("trading", "record_waste")).toBe(true);
    expect(canPerformShopDayAction("trading", "count_till")).toBe(true);
  });

  it("returns a human next step for every blocked phase", () => {
    expect(shopDayActionInstruction("not_open")).toContain("opening");
    expect(shopDayActionInstruction("opening")).toContain("opening");
    expect(shopDayActionInstruction("closing")).toContain("Closing");
    expect(shopDayActionInstruction("closed")).toContain("closed");
    expect(shopDayActionInstruction("trading")).toBeNull();
  });

  it("reports all unresolved obligations for a gate", () => {
    expect(
      unresolvedGateObligations(
        [
          openingBlocker,
          { id: "opening-display", gate: "opening", status: "completed" },
          closingBlocker,
        ],
        "opening",
      ).map((item) => item.id),
    ).toEqual(["opening-temperature"]);
  });
});
