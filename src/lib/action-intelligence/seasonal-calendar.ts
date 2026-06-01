/**
 * Seasonal demand calendar for a UK halal butcher.
 *
 * Butchers earn a large slice of their annual profit on a handful of peak days.
 * For a *halal* butcher the two Eids are the biggest days of the year, alongside
 * Christmas, New Year and the BBQ bank holidays. Missing the prep/ordering window
 * for one of these costs far more than a normal trading day.
 *
 * Islamic dates depend on the lunar calendar and a local moon sighting, so they
 * cannot be computed exactly in advance — those entries are marked `estimated`
 * and the advice tells the owner to confirm the exact day locally. Fixed
 * Gregorian dates (Christmas, bank holidays) are marked `fixed`.
 *
 * The `date` is the main demand/collection day. `leadDays` is how far ahead the
 * owner should start preparing (longer for the events that need extra stock
 * ordered from suppliers).
 */
export type SeasonalDateConfidence = "fixed" | "estimated";

export type SeasonalEvent = {
  id: string;
  /** Plain-English event name shown to the owner. */
  name: string;
  /** Main demand day, ISO `YYYY-MM-DD` (local UK date). */
  date: string;
  /** Start advising this many days before the date. */
  leadDays: number;
  /** Whether the date is fixed (calendar) or estimated (moon-dependent). */
  dateConfidence: SeasonalDateConfidence;
  /** What the butcher should physically do to be ready. */
  advice: string;
  /** Why this day matters for takings. */
  why: string;
  /** A short preparation checklist for the owner to work through. */
  prepTasks?: string[];
};

/**
 * Known peak days for 2026–2028. Estimated Islamic dates are based on widely
 * published astronomical predictions and should be confirmed locally — the
 * value of the reminder is the lead time to prep, not the exact day.
 *
 * Keep this list extended each year so the advisor never goes quiet.
 */
export const SEASONAL_EVENTS: readonly SeasonalEvent[] = [
  // 2026
  {
    id: "christmas-2026",
    name: "Christmas",
    date: "2026-12-24",
    leadDays: 21,
    dateConfidence: "fixed",
    advice:
      "Open Christmas pre-orders now and order extra turkey, lamb and beef joints. Set clear Christmas Eve collection slots and a cut-off date for orders.",
    why: "Christmas Eve is one of the busiest collection days of the year. Customers book large joints well ahead, so taking pre-orders early locks in the sales and tells you how much to buy.",
    prepTasks: [
      "Open Christmas pre-orders",
      "Order extra turkey, lamb and beef joints",
      "Set Christmas Eve collection slots and an order cut-off date",
      "Plan extra staff for the final few days",
    ],
  },
  {
    id: "new-year-2026",
    name: "New Year",
    date: "2026-12-31",
    leadDays: 10,
    dateConfidence: "fixed",
    advice: "Stock up on steaks, mince and party cuts, and confirm your New Year's Eve opening hours and collection slots.",
    why: "New Year's Eve drives a spike in steaks and party platters. A short heads-up avoids running short.",
  },
  // 2027
  {
    id: "ramadan-2027",
    name: "Start of Ramadan",
    date: "2027-02-08",
    leadDays: 14,
    dateConfidence: "estimated",
    advice:
      "Build up everyday cuts, chicken and mince for daily iftar shopping, and consider an evening collection slot. Confirm the exact start date with your community — it depends on the moon sighting.",
    why: "Demand rises every evening through Ramadan as families cook for iftar. Steady stock and a late slot capture that repeat trade for a whole month.",
    prepTasks: [
      "Review expected lamb demand",
      "Review expected chicken and mince demand",
      "Review opening hours and add an evening collection slot",
      "Prepare family packs for iftar",
    ],
  },
  {
    id: "eid-al-fitr-2027",
    name: "Eid al-Fitr",
    date: "2027-03-11",
    leadDays: 28,
    dateConfidence: "estimated",
    advice:
      "Take Eid pre-orders now for lamb, chicken and party cuts, order extra from your supplier early, and plan extra hands for the rush. Confirm the exact day locally — it depends on the moon sighting.",
    why: "Eid al-Fitr ends Ramadan with celebration meals and large family orders — one of the biggest takings days of the year for a halal butcher.",
    prepTasks: [
      "Open Eid pre-orders for lamb, chicken and party cuts",
      "Order extra stock from your supplier early",
      "Plan extra staff for the rush",
      "Prepare family packs",
      "Confirm Eid opening hours and collection slots",
    ],
  },
  {
    id: "easter-2027",
    name: "Easter weekend",
    date: "2027-03-27",
    leadDays: 10,
    dateConfidence: "fixed",
    advice: "Order extra lamb and roasting joints and set Good Friday and Easter Saturday collection slots.",
    why: "The long Easter weekend lifts demand for lamb and roasts even for customers who don't usually pre-order.",
  },
  {
    id: "early-may-bh-2027",
    name: "Early May bank holiday (BBQ weekend)",
    date: "2027-05-01",
    leadDays: 7,
    dateConfidence: "fixed",
    advice: "Push BBQ packs — burgers, kebabs, marinated chicken, lamb chops and sausages — and order extra ahead of the weekend.",
    why: "The first warm bank holiday kicks off BBQ season. Ready-made BBQ packs sell fast and carry good margins.",
  },
  {
    id: "eid-al-adha-2027",
    name: "Eid al-Adha (Qurbani)",
    date: "2027-05-16",
    leadDays: 35,
    dateConfidence: "estimated",
    advice:
      "Start Qurbani/Eid al-Adha pre-orders as early as possible, confirm whole-lamb and goat supply with your supplier, and plan staffing for the busiest day of your year. Confirm the exact day locally — it depends on the moon sighting.",
    why: "Eid al-Adha is the single biggest day for a halal butcher — whole-lamb and goat orders for Qurbani. Supply must be booked weeks ahead, so the earliest possible heads-up protects the most important takings of the year.",
    prepTasks: [
      "Confirm livestock/whole-lamb and goat suppliers",
      "Review freezer and fridge capacity",
      "Open and prepare the pre-order list",
      "Plan staffing for the rush",
      "Agree the collection process and time slots",
    ],
  },
  {
    id: "spring-bh-2027",
    name: "Spring bank holiday (BBQ weekend)",
    date: "2027-05-29",
    leadDays: 7,
    dateConfidence: "fixed",
    advice: "Restock BBQ packs and marinated lines and order extra burgers, sausages and chicken for the long weekend.",
    why: "Another BBQ bank holiday — high demand for ready-to-grill packs.",
  },
  {
    id: "summer-bh-2027",
    name: "August bank holiday (BBQ weekend)",
    date: "2027-08-28",
    leadDays: 7,
    dateConfidence: "fixed",
    advice: "Final big BBQ weekend of the summer — push BBQ packs and order extra ahead of the weekend.",
    why: "The last summer bank holiday is a strong BBQ trading weekend.",
  },
  {
    id: "christmas-2027",
    name: "Christmas",
    date: "2027-12-24",
    leadDays: 21,
    dateConfidence: "fixed",
    advice: "Open Christmas pre-orders, order extra joints and turkey, and set Christmas Eve collection slots with an order cut-off.",
    why: "Christmas Eve is one of the busiest collection days of the year. Early pre-orders lock in sales and guide how much to buy.",
  },
  // 2028 (Islamic dates estimated — extend this list yearly)
  {
    id: "ramadan-2028",
    name: "Start of Ramadan",
    date: "2028-01-28",
    leadDays: 14,
    dateConfidence: "estimated",
    advice:
      "Build up everyday cuts, chicken and mince for daily iftar shopping and consider an evening collection slot. Confirm the exact start date locally.",
    why: "A month of rising evening demand for iftar cooking.",
  },
  {
    id: "eid-al-fitr-2028",
    name: "Eid al-Fitr",
    date: "2028-02-27",
    leadDays: 28,
    dateConfidence: "estimated",
    advice: "Take Eid pre-orders, order extra early and plan extra staff. Confirm the exact day locally.",
    why: "One of the biggest celebration-meal days of the year for a halal butcher.",
  },
  {
    id: "eid-al-adha-2028",
    name: "Eid al-Adha (Qurbani)",
    date: "2028-05-05",
    leadDays: 35,
    dateConfidence: "estimated",
    advice: "Start Qurbani pre-orders early, confirm whole-lamb and goat supply, and plan staffing. Confirm the exact day locally.",
    why: "The single biggest day for a halal butcher — whole-lamb and goat Qurbani orders booked weeks ahead.",
  },
] as const;

/** Whole days from `now` to an ISO date (`YYYY-MM-DD`), counting calendar days in UTC. */
export function daysUntil(isoDate: string, now: Date): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/**
 * Events whose prep window is currently open: the event is in the future (or
 * today) and `now` is within `leadDays` of it. Sorted soonest-first.
 */
export function getActiveSeasonalEvents(now: Date): Array<SeasonalEvent & { daysUntil: number }> {
  return SEASONAL_EVENTS.map((event) => ({ ...event, daysUntil: daysUntil(event.date, now) }))
    .filter((event) => event.daysUntil >= 0 && event.daysUntil <= event.leadDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}
