import type { OwnerDigestInput } from "./owner-digest";

export const CHANNEL_DISABLED = "CHANNEL_DISABLED";

export type OwnerAlertEnvironment = Record<string, string | undefined>;
export type OwnerAlertChannelConfig = {
  enabled: boolean;
  atMostOnceAccepted: boolean;
  accountSid: string;
  authToken: string;
  from: string;
};

export type OwnerDigestSnapshot = {
  business_date: string;
  opened_by: string | null;
  closed_by: string | null;
  cash_takings_pence: number | string | null;
  card_takings_pence: number | string | null;
  total_takings_pence: number | string | null;
  cash_variance_pence: number | string | null;
  card_variance_pence: number | string | null;
  delivery_count: number | string | null;
  pending_delivery_costs: number | string | null;
  waste_count: number | string | null;
  waste_kg: number | string | null;
  shortfall_count: number | string | null;
  open_alert_count: number | string | null;
};

function n(value: number | string | null | undefined) {
  return value == null ? 0 : Number(value);
}

function pounds(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Math.abs(pence) / 100);
}

export function resolveOwnerAlertChannel(env: OwnerAlertEnvironment): OwnerAlertChannelConfig {
  return {
    enabled: env.OWNER_ALERT_CHANNEL_ENABLED === "true",
    atMostOnceAccepted: env.OWNER_ALERT_TWILIO_AT_MOST_ONCE_ACCEPTED === "true",
    accountSid: env.TWILIO_ACCOUNT_SID ?? "",
    authToken: env.TWILIO_AUTH_TOKEN ?? "",
    from: env.TWILIO_OWNER_FROM ?? env.TWILIO_FROM_NUMBER ?? "",
  };
}

export function ownerAlertChannelConfigured(config: OwnerAlertChannelConfig) {
  return Boolean(config.enabled && config.atMostOnceAccepted && config.accountSid && config.authToken && config.from);
}

function whatsapp(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

export function ownerDigestInputFromSnapshot(snapshot: OwnerDigestSnapshot): OwnerDigestInput {
  const cash = snapshot.cash_variance_pence == null ? null : n(snapshot.cash_variance_pence);
  const card = snapshot.card_variance_pence == null ? null : n(snapshot.card_variance_pence);
  const results: string[] = [];
  if (cash != null) results.push(cash === 0 ? "Till matched" : `Till was ${pounds(cash)} ${cash < 0 ? "short" : "over"}`);
  if (card != null) results.push(card === 0 ? "Card machine matched" : `Card machine was ${pounds(card)} ${card < 0 ? "short" : "over"}`);
  return {
    businessDate: snapshot.business_date,
    openedBy: snapshot.opened_by,
    closedBy: snapshot.closed_by,
    totalTakingsPence: n(snapshot.total_takings_pence),
    cashTakingsPence: n(snapshot.cash_takings_pence),
    cardTakingsPence: n(snapshot.card_takings_pence),
    tillResult: results.length ? results.join("; ") : null,
    deliveryCount: n(snapshot.delivery_count),
    pendingDeliveryCosts: n(snapshot.pending_delivery_costs),
    wasteCount: n(snapshot.waste_count),
    wasteKg: n(snapshot.waste_kg),
    shortfallCount: n(snapshot.shortfall_count),
    openAlertCount: n(snapshot.open_alert_count),
  };
}

export function localBusinessClock(now: Date, timezone = "Europe/London") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    businessDate: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export class OwnerAlertProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = "OwnerAlertProviderError";
  }
}

export async function sendOwnerAlertViaTwilio(input: {
  config: OwnerAlertChannelConfig;
  target: string;
  message: string;
  providerIdempotencyKey: string;
  fetcher?: typeof fetch;
}) {
  const body = new URLSearchParams({
    From: whatsapp(input.config.from),
    To: whatsapp(input.target),
    Body: input.message,
  });
  const basic = globalThis.btoa(`${input.config.accountSid}:${input.config.authToken}`);
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
  } catch (error) {
    // Twilio Messages has no documented client idempotency key. A transport
    // error after send is therefore terminal-visible and must never be retried.
    throw new OwnerAlertProviderError(
      `Ambiguous Twilio result: ${error instanceof Error ? error.message : "transport failed"}`,
      false,
      true,
    );
  }
  const responseText = (await response.text()).slice(0, 1000);
  if (!response.ok) {
    const retryable = response.status === 429;
    const ambiguous = response.status >= 500;
    throw new OwnerAlertProviderError(`Twilio ${response.status}: ${responseText}`, retryable, ambiguous);
  }
  return { providerResponse: responseText || null };
}
