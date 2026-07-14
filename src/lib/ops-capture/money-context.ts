/**
 * V18 A1 — plain-English money context for the closing checklist's two money
 * steps (cash_counted, terminal_total). Pure so the wording and maths are unit
 * tested; the server pages feed it the day payment picture.
 *
 * Rules (audit PTM-OPS-001): show the expected value, never prefill it — the
 * operator must actually count; if the float is unknown, say so and never
 * guess; if collected orders have no payment recorded, say expected money may
 * be low rather than pretending precision.
 */

export type MoneyContext = { heading: string; lines?: string[]; expectedPence?: number | null };

export type MoneyPictureInput = {
  floatPence: number | null;
  expectedCashPence: number | null;
  expectedCardPence: number;
  tillMovements: Array<{
    kind: "paid_in" | "paid_out" | "cash_drop" | "correction";
    signedAmountPence: number;
    reasonCode: "change" | "supplier" | "owner" | "other";
    note: string | null;
  }>;
  ordersMissingTender: Array<{ orderId: string }>;
};

const REASON_LABELS: Record<string, string> = {
  change: "Change added",
  supplier: "Paid a supplier",
  owner: "Owner took cash",
  other: "Other",
};

export function formatMoney(pence: number): string {
  return `£${(Math.abs(pence) / 100).toFixed(2)}`;
}

export function tillMovementLine(movement: MoneyPictureInput["tillMovements"][number]): string {
  const sign = movement.signedAmountPence >= 0 ? "+" : "-";
  const label =
    movement.reasonCode === "other" && movement.note
      ? movement.note
      : (REASON_LABELS[movement.reasonCode] ?? "Other");
  return `${sign}${formatMoney(movement.signedAmountPence)} — ${label}`;
}

export type YesterdayMoneyInput = {
  cashSalesPence: number;
  cardSalesPence: number;
  refundsPence: number;
  cashVariancePence: number | null;
  cardVariancePence: number | null;
  varianceSuppressed: boolean;
  closed: boolean;
};

/**
 * Owner Today card wording (strict surface — plain sentences, no percentages,
 * never the word "variance"): yesterday's takings split and the till result.
 */
export function buildYesterdayMoneyLines(card: YesterdayMoneyInput): string[] {
  const lines: string[] = [];
  const takings = card.cashSalesPence + card.cardSalesPence;

  let takingsLine = `Took ${formatMoney(takings)} — ${formatMoney(card.cashSalesPence)} cash, ${formatMoney(card.cardSalesPence)} card.`;
  if (card.refundsPence > 0) {
    takingsLine += ` Refunds ${formatMoney(card.refundsPence)}.`;
  }
  lines.push(takingsLine);

  if (!card.closed) {
    lines.push("The shop was not closed in the app, so the till was not checked.");
    return lines;
  }

  if (card.varianceSuppressed) {
    lines.push("Till check was not reliable — some collected orders had no payment recorded.");
    return lines;
  }

  if (card.cashVariancePence === null) {
    lines.push("The till was counted, but expected money was not known.");
  } else if (card.cashVariancePence === 0) {
    lines.push("Till matched.");
  } else {
    lines.push(
      `Till was ${formatMoney(card.cashVariancePence)} ${card.cashVariancePence < 0 ? "short" : "over"}.`,
    );
  }

  if (card.cardVariancePence !== null) {
    if (card.cardVariancePence === 0) {
      lines.push("Card machine matched.");
    } else {
      lines.push(
        `Card machine was ${formatMoney(card.cardVariancePence)} ${card.cardVariancePence < 0 ? "short" : "over"}.`,
      );
    }
  }

  return lines;
}

export function buildCloseMoneyContexts(picture: MoneyPictureInput | null): Record<string, MoneyContext> {
  if (!picture) return {};

  const cashLines: string[] = [];
  if (picture.tillMovements.length > 0) {
    cashLines.push("Money moved today:");
    for (const movement of picture.tillMovements) {
      cashLines.push(tillMovementLine(movement));
    }
  }
  if (picture.ordersMissingTender.length > 0) {
    const n = picture.ordersMissingTender.length;
    cashLines.push(
      `${n} collected ${n === 1 ? "order has" : "orders have"} no payment recorded — expected money may be low.`,
    );
  }

  const cashHeading =
    picture.expectedCashPence !== null
      ? `Expected in till: ${formatMoney(picture.expectedCashPence)}`
      : "Expected in till: not known — no float was saved at opening.";

  return {
    cash_counted: {
      heading: cashHeading,
      lines: cashLines,
      expectedPence: picture.expectedCashPence,
    },
    terminal_total: {
      heading: `Card machine should show: ${formatMoney(picture.expectedCardPence)}`,
      lines:
        picture.ordersMissingTender.length > 0
          ? ["Some collected orders have no payment recorded, so this may not match."]
          : [],
      expectedPence: picture.expectedCardPence,
    },
  };
}
