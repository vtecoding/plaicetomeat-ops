/**
 * First-run teaching (improvement for a brand-new, non-technical owner).
 *
 * A first-time butcher opening the app on day one shouldn't see an empty screen —
 * they should see a short, encouraging "here's how to get going" list with the
 * *butchery reason* for each step. It disappears once the shop is set up, so an
 * established owner never sees nagging.
 */
import type { ShopSnapshot } from "./snapshot";
import type { GettingStarted, GettingStartedStep } from "./types";

export function buildGettingStarted(snapshot: ShopSnapshot): GettingStarted {
  const hasProducts = snapshot.products.total > 0;
  const everyProductCosted = hasProducts && snapshot.products.missingCost === 0;
  const hasStock = snapshot.stock.activeBatchCount > 0;
  const hasCertificates = snapshot.compliance.rows.length > 0;

  const steps: GettingStartedStep[] = [
    {
      id: "list-products",
      text: "List what you sell",
      why: "Add each cut and joint you'll offer — like lamb chops or chicken breast. Everything else builds on this list.",
      href: "/admin/products",
      actionLabel: "Add products",
      done: hasProducts,
    },
    {
      id: "add-costs",
      text: "Tell the shop what your meat costs",
      why: "Without a cost, the shop can't show your profit. Easiest way: record a carcass and let the cutting guide work out the cost of each cut for you.",
      href: "/admin/cutting-guide",
      actionLabel: "Open cutting guide",
      done: everyProductCosted,
    },
    {
      id: "record-stock",
      text: "Book in your first delivery or carcass",
      why: "Recording stock as it arrives is how the shop knows what you have and warns you before anything runs low or goes off.",
      href: "/admin/cutting-guide",
      actionLabel: "Record stock",
      done: hasStock,
    },
    {
      id: "save-certificate",
      text: "Save a supplier's halal certificate",
      why: "Your halal promise rests on these. The shop tracks the expiry date and reminds you before it lapses.",
      href: "/admin/compliance",
      actionLabel: "Add certificate",
      done: hasCertificates,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;

  return {
    // Still setting up if any of the four foundations is missing.
    show: doneCount < steps.length,
    title: "Getting your shop ready",
    intro:
      doneCount === 0
        ? "Welcome. You don't need any butchery or computer experience — just work down this short list. As you do, this page fills with real, plain-English advice."
        : "You're on your way. Finish these and your briefing starts giving you proper guidance every morning.",
    steps,
    doneCount,
    totalCount: steps.length,
  };
}
