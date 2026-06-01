/**
 * Launch readiness: an honest, owner-facing "are we ready to open?" view.
 *
 * Every status is derived from real shop data — never optimistic. Items we can
 * verify from the database are marked `ready`/`attention`; items only a human can
 * confirm (e.g. "is the owner password strong and private?") are marked `manual`
 * so the app never claims confidence it cannot back up.
 */
export type LaunchItemStatus = "ready" | "attention" | "manual";
export type LaunchOverall = "ready" | "attention" | "not_started";

export type LaunchSignals = {
  /** Total products entered for the branch (available or not). */
  productCount: number;
  /** Products with no usable price (£0 or less) — they must be fixed before launch. */
  zeroPriceProductCount: number;
  /** Active collection windows customers can choose at checkout. */
  activePickupWindowCount: number;
  /** Whether any supplier certificate records exist. */
  certificatesConfigured: boolean;
  /** Supplier certificates already expired. */
  expiredCertificates: number;
  /** Whether at least one order (real or practice) has ever been placed. */
  anyOrderPlaced: boolean;
  /** Active non-owner staff/manager accounts. */
  staffAccountCount: number;
  /** Whether customer texts are switched on (off is a perfectly safe launch state). */
  smsSendingEnabled: boolean;
};

export type LaunchItem = {
  key: string;
  label: string;
  detail: string;
  status: LaunchItemStatus;
};

export type LaunchReadiness = {
  overall: LaunchOverall;
  items: LaunchItem[];
  readyCount: number;
  /** Items the app can actually check (excludes `manual` confirmations). */
  autoCheckedCount: number;
};

export function deriveLaunchReadiness(signals: LaunchSignals): LaunchReadiness {
  const items: LaunchItem[] = [];

  items.push({
    key: "products",
    label: "Products added",
    detail:
      signals.productCount > 0
        ? `${signals.productCount} product${signals.productCount === 1 ? "" : "s"} in your shop.`
        : "No products yet. Add everything you sell under Products & Prices.",
    status: signals.productCount > 0 ? "ready" : "attention",
  });

  items.push({
    key: "prices",
    label: "Prices set",
    detail:
      signals.productCount === 0
        ? "Add your products first, then set their prices."
        : signals.zeroPriceProductCount > 0
          ? `${signals.zeroPriceProductCount} product${signals.zeroPriceProductCount === 1 ? " has" : "s have"} no price set — fix before opening.`
          : "Every product has a price.",
    status: signals.productCount > 0 && signals.zeroPriceProductCount === 0 ? "ready" : "attention",
  });

  items.push({
    key: "collection_times",
    label: "Collection times set",
    detail:
      signals.activePickupWindowCount > 0
        ? `${signals.activePickupWindowCount} collection time${signals.activePickupWindowCount === 1 ? "" : "s"} customers can choose.`
        : "No collection times yet. Customers can't order until at least one is set.",
    status: signals.activePickupWindowCount > 0 ? "ready" : "attention",
  });

  items.push({
    key: "certificates",
    label: "Supplier certificates recorded",
    detail: !signals.certificatesConfigured
      ? "No supplier certificates recorded yet. These back up your halal promise."
      : signals.expiredCertificates > 0
        ? `${signals.expiredCertificates} certificate${signals.expiredCertificates === 1 ? " is" : "s are"} expired — contact the supplier.`
        : "Supplier certificates recorded and in date.",
    status: signals.certificatesConfigured && signals.expiredCertificates === 0 ? "ready" : "attention",
  });

  items.push({
    key: "dry_run",
    label: "Test order completed",
    detail: signals.anyOrderPlaced
      ? "At least one order has been placed and worked end-to-end."
      : "Place one practice order from a phone to prove checkout works.",
    status: signals.anyOrderPlaced ? "ready" : "attention",
  });

  items.push({
    key: "staff_account",
    label: "Staff account created",
    detail:
      signals.staffAccountCount > 0
        ? `${signals.staffAccountCount} staff/manager account${signals.staffAccountCount === 1 ? "" : "s"} ready for the counter.`
        : "Create a separate login for counter staff (don't share the owner login).",
    status: signals.staffAccountCount > 0 ? "ready" : "attention",
  });

  items.push({
    key: "texts",
    label: "Text messages",
    detail: signals.smsSendingEnabled
      ? "Customer texts are ON. A failed text never blocks an order."
      : "Customer texts are OFF — a safe way to launch. Staff phone customers when an order is ready.",
    status: "ready",
  });

  items.push({
    key: "owner_account",
    label: "Owner login reviewed",
    detail: "Confirm yourself: the owner login uses a strong, private password that isn't written down or shared.",
    status: "manual",
  });

  items.push({
    key: "public_pages",
    label: "Customer pages reviewed",
    detail: "Confirm yourself: read the Shop, Halal Promise and Privacy pages as a customer would.",
    status: "manual",
  });

  const readyCount = items.filter((item) => item.status === "ready").length;
  const autoItems = items.filter((item) => item.status !== "manual");
  const autoCheckedCount = autoItems.length;
  const anyAttention = autoItems.some((item) => item.status === "attention");

  const nothingStarted =
    signals.productCount === 0 &&
    signals.activePickupWindowCount === 0 &&
    !signals.anyOrderPlaced &&
    signals.staffAccountCount === 0;

  const overall: LaunchOverall = nothingStarted ? "not_started" : anyAttention ? "attention" : "ready";

  return { overall, items, readyCount, autoCheckedCount };
}

export const LAUNCH_OVERALL_LABEL: Record<LaunchOverall, string> = {
  ready: "Ready to open",
  attention: "Needs attention",
  not_started: "Not started",
};
