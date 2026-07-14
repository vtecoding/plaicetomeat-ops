export type OwnerDigestInput = {
  businessDate: string;
  openedBy: string | null;
  closedBy: string | null;
  totalTakingsPence: number;
  cashTakingsPence: number;
  cardTakingsPence: number;
  tillResult: string | null;
  deliveryCount: number;
  pendingDeliveryCosts: number;
  wasteCount: number;
  wasteKg: number;
  shortfallCount: number;
  openAlertCount: number;
};

function money(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

function countLine(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Audit §13's plain-English owner digest. */
export function buildOwnerDigest(input: OwnerDigestInput): string {
  const lines = [`PlaiceToMeat — ${dayLabel(input.businessDate)}`];
  lines.push(input.openedBy ? `Opened by ${input.openedBy}.` : "No opening was saved.");
  lines.push(input.closedBy ? `Closed by ${input.closedBy}.` : "No closing was saved yet.");
  lines.push(
    `Takings ${money(input.totalTakingsPence)}: ${money(input.cashTakingsPence)} cash, ${money(input.cardTakingsPence)} card.`,
  );
  lines.push(input.tillResult ? `${input.tillResult}.` : "No till result was saved.");
  lines.push(
    `${countLine(input.deliveryCount, "delivery", "deliveries")}; ${countLine(input.pendingDeliveryCosts, "cost")} still to add.`,
  );
  lines.push(`${countLine(input.wasteCount, "waste entry", "waste entries")} (${input.wasteKg.toFixed(2)}kg).`);
  lines.push(`${countLine(input.shortfallCount, "stock shortfall")}.`);
  lines.push(`${countLine(input.openAlertCount, "owner job")} open.`);

  if (
    input.pendingDeliveryCosts === 0 &&
    input.shortfallCount === 0 &&
    input.openAlertCount === 0 &&
    input.openedBy &&
    input.closedBy
  ) {
    lines.push("Nothing needs you today.");
  }
  return lines.join("\n");
}
