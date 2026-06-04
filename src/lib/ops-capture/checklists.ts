/**
 * V10 Phase 2 — the fixed ritual checklists.
 *
 * Short, food-safety-anchored, plain English. These are deliberately the *same every
 * day* (rituals, not decisions) — the opposite ergonomics to the V9 decision list. The
 * closing list is where the day's waste and a quick stock glance get captured, which is
 * what makes tomorrow's intelligence real.
 */
import type { ChecklistDefinition, OpsKind } from "./types";

const OPENING: ChecklistDefinition = {
  kind: "opening",
  title: "Opening the shop",
  intro: "A few checks before you open the doors. Tap each one as you go.",
  steps: [
    {
      key: "fridge_temp",
      title: "Check the fridge & display are cold",
      why: "Meat must stay cold to be safe to sell. A quick temperature check protects your customers and your stock.",
      input: { kind: "number", unit: "°C", label: "Coldest reading" },
      critical: true,
    },
    {
      key: "certs_visible",
      title: "Halal & food-safety certificates on show",
      why: "Customers trust what they can see. Make sure the certificates are up and in date.",
      input: { kind: "confirm" },
      critical: true,
    },
    {
      key: "display_ready",
      title: "Counter and display set up",
      why: "A full, tidy counter sells more and tells customers you're open and ready.",
      input: { kind: "confirm" },
      critical: false,
    },
    {
      key: "float_ready",
      title: "Till float counted and ready",
      why: "Starting with a known float means the end-of-day count actually means something.",
      input: { kind: "number", unit: "£", label: "Opening float" },
      critical: false,
    },
    {
      key: "open_sign",
      title: "Open sign on, lights up",
      why: "The last step before trading — let people know you're open.",
      input: { kind: "confirm" },
      critical: false,
    },
  ],
};

const CLOSING: ChecklistDefinition = {
  kind: "closing",
  title: "Closing the shop",
  intro: "Lock up safely and capture today, so tomorrow's numbers are real.",
  steps: [
    {
      key: "waste_logged",
      title: "Log today's waste",
      why: "Writing off what didn't sell is how the shop learns where money leaks — and keeps your stock honest.",
      input: { kind: "confirm" },
      critical: false,
      action: { href: "/admin/inventory", label: "Log waste" },
    },
    {
      key: "stock_glance",
      title: "Quick stock check",
      why: "A 60-second look at what's left keeps the system matching the fridge, so 'running low' warnings can be trusted.",
      input: { kind: "confirm" },
      critical: false,
      action: { href: "/admin/stock-count", label: "Do a stock count" },
    },
    {
      key: "cash_counted",
      title: "Count the till",
      why: "Counting up against today's takings catches mistakes while the day is still fresh.",
      input: { kind: "number", unit: "£", label: "Counted total" },
      critical: false,
    },
    {
      key: "fridges_closed",
      title: "Fridges shut and still cold",
      why: "Stock has to stay cold overnight to be safe to sell tomorrow.",
      input: { kind: "number", unit: "°C", label: "Coldest reading" },
      critical: true,
    },
    {
      key: "clean_done",
      title: "Surfaces cleaned down",
      why: "A clean close keeps you the right side of food hygiene and ready for the morning.",
      input: { kind: "confirm" },
      critical: true,
    },
    {
      key: "lock_up",
      title: "Locked up and alarm set",
      why: "The last job — secure the shop before you leave.",
      input: { kind: "confirm" },
      critical: false,
    },
  ],
};

export const CHECKLISTS: Record<Exclude<OpsKind, "stock_count">, ChecklistDefinition> = {
  opening: OPENING,
  closing: CLOSING,
};

export function getChecklist(kind: Exclude<OpsKind, "stock_count">): ChecklistDefinition {
  return CHECKLISTS[kind];
}
