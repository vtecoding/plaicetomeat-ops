/**
 * Knowledge Layer (V8.6).
 *
 * A registry of plain-English operational playbooks. Findings link to the right
 * playbook so that when the system raises an issue, the owner can also learn *how*
 * to deal with it. The markdown lives in `docs/operational-playbooks/`.
 */
import type { IntelArea, PlaybookRef } from "./types";

export type Playbook = PlaybookRef & {
  /** One-line description shown next to the link. */
  summary: string;
};

export const PLAYBOOKS = {
  "butcher-words": {
    slug: "butcher-words",
    title: "Butcher words explained",
    summary: "Plain meanings for the trade terms you'll see around the app.",
  },
  "receiving-stock": {
    slug: "receiving-stock",
    title: "Receiving stock",
    summary: "Check, weigh and record meat as it comes in.",
  },
  "carcass-intake": {
    slug: "carcass-intake",
    title: "Carcass intake",
    summary: "Break a whole animal into priced cuts and put them into stock.",
  },
  "recording-waste": {
    slug: "recording-waste",
    title: "Recording waste",
    summary: "Log what you throw away so the shop can spot what's losing money.",
  },
  "correcting-inventory": {
    slug: "correcting-inventory",
    title: "Correcting stock",
    summary: "Keep recorded stock matching what's really in the fridge.",
  },
  "managing-orders": {
    slug: "managing-orders",
    title: "Managing orders",
    summary: "Prepare and hand over customer orders at the counter.",
  },
  "supplier-compliance": {
    slug: "supplier-compliance",
    title: "Supplier compliance",
    summary: "Keep halal certificates current and on file.",
  },
  "handling-low-stock": {
    slug: "handling-low-stock",
    title: "Handling low stock",
    summary: "Decide what to re-order before you run out.",
  },
  "reading-your-briefing": {
    slug: "reading-your-briefing",
    title: "Reading your briefing",
    summary: "How to use the morning briefing and trust its confidence levels.",
  },
} as const satisfies Record<string, Playbook>;

export type PlaybookSlug = keyof typeof PLAYBOOKS;

/** The default playbook for each finding area. */
const AREA_PLAYBOOK: Record<IntelArea, PlaybookSlug | null> = {
  stock: "handling-low-stock",
  expiry: "recording-waste",
  waste: "recording-waste",
  margin: "carcass-intake",
  compliance: "supplier-compliance",
  yield: "carcass-intake",
  consistency: "correcting-inventory",
  discipline: "correcting-inventory",
  orders: "managing-orders",
  system: null,
};

export function playbookForArea(area: IntelArea): PlaybookRef | null {
  const slug = AREA_PLAYBOOK[area];
  if (!slug) return null;
  const { title } = PLAYBOOKS[slug];
  return { slug, title };
}

export function playbook(slug: PlaybookSlug): PlaybookRef {
  const { title } = PLAYBOOKS[slug];
  return { slug, title };
}

export function allPlaybooks(): Playbook[] {
  return Object.values(PLAYBOOKS);
}
