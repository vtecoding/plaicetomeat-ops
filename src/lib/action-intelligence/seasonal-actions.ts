import type { ActionEngineInput, OwnerAction } from "./action-types";
import { getActiveSeasonalEvents } from "./seasonal-calendar";

/**
 * Surfaces the peak butcher trading days (the two Eids, Christmas, New Year,
 * Easter and BBQ bank holidays) while there is still time to prepare and order
 * extra stock. These are some of the highest-value reminders a halal butcher
 * can get, so they sit in the money-making columns and escalate to "urgent" in
 * the final few days.
 */
export function buildSeasonalActions(input: ActionEngineInput): OwnerAction[] {
  const now = new Date(input.createdAt);

  return getActiveSeasonalEvents(now).map((event) => {
    const imminent = event.daysUntil <= 3;
    const estimated = event.dateConfidence === "estimated";

    return {
      id: `seasonal-${event.id}`,
      category: "basket",
      group: imminent ? "urgent" : "money_saving",
      severity: imminent ? "urgent" : event.daysUntil <= 10 ? "warning" : "info",
      title: `${event.name} ${countdownPhrase(event.daysUntil)}`,
      explanation: `${event.name} is on ${formatEventDate(event.date)}${estimated ? " (estimated — confirm the exact day locally)" : ""}.`,
      estimatedImpact: event.why,
      recommendedAction: event.advice,
      sourceMetrics: {
        event: event.name,
        date: event.date,
        daysUntil: event.daysUntil,
        dateConfidence: event.dateConfidence,
      },
      createdAt: input.createdAt,
      confidence: estimated ? "medium" : "high",
    };
  });
}

function countdownPhrase(days: number): string {
  if (days <= 0) return "is today";
  if (days === 1) return "is tomorrow";
  return `is in ${days} days`;
}

const eventDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatEventDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return eventDateFormatter.format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}
