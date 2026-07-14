import { describe, expect, it } from "vitest";

import {
  buildCloseMoneyContexts,
  buildYesterdayMoneyLines,
  formatMoney,
  tillMovementLine,
  type MoneyPictureInput,
} from "./money-context";

function picture(overrides: Partial<MoneyPictureInput> = {}): MoneyPictureInput {
  return {
    floatPence: 5000,
    expectedCashPence: 14250,
    expectedCardPence: 11420,
    tillMovements: [],
    ordersMissingTender: [],
    ...overrides,
  };
}

describe("buildCloseMoneyContexts", () => {
  it("shows expected cash and card headings with £ amounts", () => {
    const contexts = buildCloseMoneyContexts(picture());
    expect(contexts.cash_counted.heading).toBe("Expected in till: £142.50");
    expect(contexts.terminal_total.heading).toBe("Card machine should show: £114.20");
  });

  it("passes expectedPence through so the step payload can persist it", () => {
    const contexts = buildCloseMoneyContexts(picture());
    expect(contexts.cash_counted.expectedPence).toBe(14250);
    expect(contexts.terminal_total.expectedPence).toBe(11420);
  });

  it("is honest when the float is unknown — never guesses", () => {
    const contexts = buildCloseMoneyContexts(picture({ floatPence: null, expectedCashPence: null }));
    expect(contexts.cash_counted.heading).toBe("Expected in till: not known — no float was saved at opening.");
    expect(contexts.cash_counted.expectedPence).toBeNull();
  });

  it("lists the day's till movements in plain English", () => {
    const contexts = buildCloseMoneyContexts(
      picture({
        tillMovements: [
          { kind: "paid_in", signedAmountPence: 2000, reasonCode: "change", note: null },
          { kind: "paid_out", signedAmountPence: -3500, reasonCode: "supplier", note: null },
          { kind: "paid_out", signedAmountPence: -1000, reasonCode: "other", note: "Window cleaner" },
        ],
      }),
    );
    expect(contexts.cash_counted.lines).toEqual([
      "Money moved today:",
      "+£20.00 — Change added",
      "-£35.00 — Paid a supplier",
      "-£10.00 — Window cleaner",
    ]);
  });

  it("flags collected orders with no payment recorded on both money steps", () => {
    const contexts = buildCloseMoneyContexts(picture({ ordersMissingTender: [{ orderId: "a" }, { orderId: "b" }] }));
    expect(contexts.cash_counted.lines).toContain(
      "2 collected orders have no payment recorded — expected money may be low.",
    );
    expect(contexts.terminal_total.lines?.length).toBe(1);
  });

  it("renders nothing when there is no picture", () => {
    expect(buildCloseMoneyContexts(null)).toEqual({});
  });
});

describe("tillMovementLine", () => {
  it("signs amounts and labels reasons", () => {
    expect(tillMovementLine({ kind: "paid_in", signedAmountPence: 500, reasonCode: "change", note: null })).toBe(
      "+£5.00 — Change added",
    );
    expect(tillMovementLine({ kind: "cash_drop", signedAmountPence: -10000, reasonCode: "owner", note: null })).toBe(
      "-£100.00 — Owner took cash",
    );
  });
});

describe("formatMoney", () => {
  it("always renders absolute pounds with two decimals", () => {
    expect(formatMoney(900)).toBe("£9.00");
    expect(formatMoney(-900)).toBe("£9.00");
    expect(formatMoney(0)).toBe("£0.00");
  });
});

describe("buildYesterdayMoneyLines (owner Today card — strict-surface wording)", () => {
  const base = {
    cashSalesPence: 19820,
    cardSalesPence: 11420,
    refundsPence: 0,
    cashVariancePence: 0 as number | null,
    cardVariancePence: 0 as number | null,
    varianceSuppressed: false,
    closed: true,
  };

  it("leads with the takings split", () => {
    const lines = buildYesterdayMoneyLines(base);
    expect(lines[0]).toBe("Took £312.40 — £198.20 cash, £114.20 card.");
  });

  it("mentions refunds only when they happened", () => {
    expect(buildYesterdayMoneyLines({ ...base, refundsPence: 1200 })[0]).toContain("Refunds £12.00.");
    expect(buildYesterdayMoneyLines(base)[0]).not.toContain("Refunds");
  });

  it("says the till matched", () => {
    expect(buildYesterdayMoneyLines(base)).toContain("Till matched.");
    expect(buildYesterdayMoneyLines(base)).toContain("Card machine matched.");
  });

  it("says short or over in plain words", () => {
    expect(buildYesterdayMoneyLines({ ...base, cashVariancePence: -900 })).toContain("Till was £9.00 short.");
    expect(buildYesterdayMoneyLines({ ...base, cashVariancePence: 450 })).toContain("Till was £4.50 over.");
    expect(buildYesterdayMoneyLines({ ...base, cardVariancePence: -300 })).toContain("Card machine was £3.00 short.");
  });

  it("is honest when the shop was not closed in the app", () => {
    const lines = buildYesterdayMoneyLines({ ...base, closed: false });
    expect(lines).toContain("The shop was not closed in the app, so the till was not checked.");
    expect(lines.join(" ")).not.toContain("matched");
  });

  it("is honest when the check was unreliable (missing tenders)", () => {
    const lines = buildYesterdayMoneyLines({ ...base, varianceSuppressed: true });
    expect(lines).toContain("Till check was not reliable — some collected orders had no payment recorded.");
  });

  it("is honest when expected money was unknown", () => {
    const lines = buildYesterdayMoneyLines({ ...base, cashVariancePence: null, cardVariancePence: null });
    expect(lines).toContain("The till was counted, but expected money was not known.");
  });

  it("never uses banned strict-surface words", () => {
    const everything = [
      buildYesterdayMoneyLines(base),
      buildYesterdayMoneyLines({ ...base, cashVariancePence: -900, refundsPence: 500, varianceSuppressed: false }),
      buildYesterdayMoneyLines({ ...base, closed: false }),
    ]
      .flat()
      .join(" ");
    expect(everything).not.toMatch(/variance/i);
    expect(everything).not.toContain("%");
  });
});
