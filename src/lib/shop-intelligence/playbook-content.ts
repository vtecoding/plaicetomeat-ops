/**
 * Knowledge Layer content (V8.6) — the in-app playbooks.
 *
 * Stored as structured data so it's guaranteed to ship in the bundle and render
 * without a markdown library. The same content is mirrored as printable markdown
 * in `docs/operational-playbooks/` for the owner's binder.
 */
import { PLAYBOOKS, type PlaybookSlug } from "./playbooks";

export type PlaybookContent = {
  slug: PlaybookSlug;
  title: string;
  summary: string;
  /** One or two plain sentences on what this job is. */
  intro: string;
  /** Why getting it right matters to the shop. */
  whenItMatters: string;
  /** The actual steps, in order. */
  steps: string[];
  /** Easy mistakes to avoid. */
  watchFor: string[];
};

export const PLAYBOOK_CONTENT: Record<PlaybookSlug, PlaybookContent> = {
  "butcher-words": {
    ...PLAYBOOKS["butcher-words"],
    intro: "A plain-words guide to the butchery and shop terms you'll see around the app. No prior experience needed.",
    whenItMatters:
      "The app uses a few trade words. Knowing what they mean — especially yield and margin — lets you make confident decisions instead of guessing.",
    steps: [
      "Carcass — a whole animal after slaughter, before it's cut up. You buy these and break them into cuts.",
      "Cut (or joint) — a piece of meat ready to sell, like a leg, shoulder or chops.",
      "Yield — how much saleable meat you actually get from a carcass after bone, fat and trim come off. More yield means more to sell.",
      "Trim — the fat, sinew and offcuts removed while preparing a cut. Usually goes to mince or waste.",
      "Bone-in / boneless — whether a cut still has its bone. Boneless weighs less but is often easier to sell.",
      "Batch — one delivery or carcass recorded in the shop, with its own weight, cost and use-by date.",
      "Cost per kg — what the meat costs you to buy, per kilo. The app needs this to work out your profit.",
      "Margin — the profit left after costs, shown as a share of the price. A bigger margin is a healthier line.",
      "Days of cover — how many days your current stock will last at the rate it's selling.",
      "Cutting guide / cut sheet — the plan for how a carcass breaks into cuts, with expected weights and suggested prices.",
      "Use-by (expiry) — the date meat must be sold or used by. After it, treat it as waste.",
      "Halal certificate — a supplier's proof their meat is halal. It must be kept in date.",
    ],
    watchFor: [
      "You don't need to memorise these — come back whenever a word on screen is unfamiliar.",
      "The two that drive your profit most are yield and margin. Get comfortable with those first.",
    ],
  },
  "receiving-stock": {
    ...PLAYBOOKS["receiving-stock"],
    intro: "Booking in meat as it arrives from a supplier so the shop knows what you have, what it cost, and when it must sell by.",
    whenItMatters: "Every stock, cost and ordering figure starts here. Sloppy receiving means every number downstream is wrong.",
    steps: [
      "Check the delivery against the invoice — right products, right weights, right price.",
      "Look at it: colour, smell, packaging intact, temperature cold to the touch.",
      "Record the batch in Stock: product, weight received, cost, supplier, and the use-by date.",
      "Note the country of origin and halal certificate reference if the supplier provides one.",
      "Put it away fast — chiller for fresh, freezer for frozen — oldest stock at the front.",
    ],
    watchFor: [
      "Don't accept meat that's warm, off-colour or past date — refuse it and tell the supplier.",
      "Enter the real weight, not the ordered weight. They're often different.",
    ],
  },
  "carcass-intake": {
    ...PLAYBOOKS["carcass-intake"],
    intro: "Breaking a whole or half animal into saleable cuts, pricing each one, and putting them into stock.",
    whenItMatters: "This is where most of your margin is made or lost. The cut sheet estimates the yield; reality decides your real cost per kg.",
    steps: [
      "Weigh the whole carcass and record it against the intake.",
      "Use the cutting guide to see the expected cuts, yields and suggested prices.",
      "Cut, then weigh each saleable cut and the bone/fat/trim separately.",
      "Confirm the real weights in the intake — this is what teaches the shop your true yield.",
      "Review the suggested prices, adjust if you want, then commit the cuts to stock.",
    ],
    watchFor: [
      "Always confirm actual weights. The 'expected vs actual' learning only works if you do.",
      "If actual yield is regularly below the estimate, your suggested prices are too low — the briefing will tell you.",
    ],
  },
  "recording-waste": {
    ...PLAYBOOKS["recording-waste"],
    intro: "Logging anything you throw away — spoiled stock, trim, or a customer return.",
    whenItMatters: "Waste is money leaving the shop. If you don't log it, you can't see which products lose money or how much you're over-ordering.",
    steps: [
      "When something is thrown away, open Stock and record a waste event.",
      "Pick the product, the weight, and the reason (expired, damaged, trim, customer issue).",
      "Do it the moment it happens, while you remember the real amount.",
      "Review the weekly briefing to see your biggest waste source.",
    ],
    watchFor: [
      "Trim from butchering is normal — but logging it shows the true cost of a cut.",
      "A product wasted week after week usually means you're buying more than you sell.",
    ],
  },
  "correcting-inventory": {
    ...PLAYBOOKS["correcting-inventory"],
    intro: "Adjusting recorded stock so it matches what's really in the fridge.",
    whenItMatters: "Recorded stock drifts over time. If the books say 12kg and the fridge has 8kg, every order suggestion is wrong.",
    steps: [
      "Pick a product and physically weigh what you actually have.",
      "Open Stock, find the batch, and set the remaining weight to the real figure.",
      "If a batch is finished or binned, mark it depleted or disposed so it leaves sellable stock.",
      "Do a quick count of your main lines at least once a week.",
    ],
    watchFor: [
      "If the briefing flags 'stock marked gone but still shows weight', that batch needs correcting.",
      "Out-of-date stock still marked active is a food-safety risk — pull it straight away.",
    ],
  },
  "managing-orders": {
    ...PLAYBOOKS["managing-orders"],
    intro: "Preparing customer orders and handing them over at the counter.",
    whenItMatters: "A missed or muddled order loses a customer. The counter screen makes sure nothing slips through.",
    steps: [
      "Open the Counter screen at the start of service.",
      "Work orders top to bottom: start preparing, then mark ready when bagged.",
      "When the customer collects, mark it collected.",
      "If a text fails to send, phone the customer instead — a failed text never blocks the order.",
    ],
    watchFor: [
      "Keep the counter screen open during service so new orders appear live.",
      "Check weight-confirmed items carefully — the price depends on the real weight.",
    ],
  },
  "supplier-compliance": {
    ...PLAYBOOKS["supplier-compliance"],
    intro: "Keeping your suppliers' halal certificates current and on file.",
    whenItMatters: "Your halal promise depends on valid certificates. An expired one is a compliance and trust risk.",
    steps: [
      "Record each supplier with their certifying body, certificate number and expiry date.",
      "Upload or file the certificate document.",
      "Check the compliance screen weekly for anything expiring.",
      "Contact the supplier for a renewal at least two weeks before expiry.",
    ],
    watchFor: [
      "Don't sell meat from a supplier whose certificate has lapsed until it's renewed.",
      "Set a reminder — certificates always expire at the worst moment.",
    ],
  },
  "handling-low-stock": {
    ...PLAYBOOKS["handling-low-stock"],
    intro: "Deciding what to re-order before you run out.",
    whenItMatters: "Running out of a popular line sends customers elsewhere. Over-ordering ties up cash and creates waste.",
    steps: [
      "Check the Purchasing screen for 'order more' suggestions and days of cover left.",
      "Cross-check against any big day coming up (Eid, Christmas, a bank-holiday BBQ).",
      "Place the order with your supplier.",
      "Book the delivery in via Receiving Stock when it arrives.",
    ],
    watchFor: [
      "A product that keeps hitting low stock is selling faster than you buy — raise the order size.",
      "Don't order more of anything that shows up in your waste list.",
    ],
  },
  "reading-your-briefing": {
    ...PLAYBOOKS["reading-your-briefing"],
    intro: "How to use the morning briefing, the health score and the confidence levels.",
    whenItMatters: "The briefing is the shop talking to you. Knowing how much to trust it keeps you in control — it only ever suggests, you decide.",
    steps: [
      "Read the headline first: it tells you how many things genuinely need attention today.",
      "Work the attention list top to bottom — it's already in priority order.",
      "For each item, read Why, what happens If ignored, and the suggested Do-this step.",
      "Check the confidence: 'High confidence' is well-backed; 'Early signal' means take it with a pinch of salt.",
      "Glance at the health score to see which habit needs work this week.",
    ],
    watchFor: [
      "The system never changes stock, prices or orders by itself. Every suggestion waits for you.",
      "Low confidence isn't a bug — it's honesty about thin data. More records make it sharper.",
    ],
  },
};

export function getPlaybookContent(slug: string): PlaybookContent | null {
  return (PLAYBOOK_CONTENT as Record<string, PlaybookContent>)[slug] ?? null;
}

export function allPlaybookContent(): PlaybookContent[] {
  return Object.values(PLAYBOOK_CONTENT);
}
