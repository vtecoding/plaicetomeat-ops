/**
 * Setup & launch-safety checklist (V7.0 Parts 6, 8, 9).
 *
 * A plain-English "are we ready to open the shop?" list for the owner. Items the
 * app can verify from real data are marked `done`/`todo`; items only a human can
 * confirm (security back-doors, hosting config, physical tablet tests) are marked
 * `manual` so the app never claims confidence it cannot back up. No database
 * writes and no schema — everything here is derived or human-confirmed.
 */

export type SetupItemStatus = "done" | "todo" | "manual";

export type SetupItem = {
  key: string;
  label: string;
  /** Why it matters, in plain English. */
  why: string;
  status: SetupItemStatus;
  /** Where to go to deal with it. */
  href?: string;
  actionLabel?: string;
};

export type SetupSection = {
  key: string;
  title: string;
  items: SetupItem[];
};

export type SetupSignals = {
  productCount: number;
  zeroPriceProductCount: number;
  /** True while any seeded demo product is still in the catalogue. */
  demoProductsPresent: boolean;
  activePickupWindowCount: number;
  certificatesConfigured: boolean;
  expiredCertificates: number;
  expiringCertificates: number;
  staffAccountCount: number;
  anyOrderPlaced: boolean;
  /** True when the checkout "test order" mode is switched on (must be OFF live). */
  checkoutTestModeEnabled: boolean;
  /** True when admin/counter routes are middleware-protected (always true here). */
  adminRoutesProtected: boolean;
};

const STATUS_LABEL: Record<SetupItemStatus, string> = {
  done: "Done",
  todo: "Not done",
  manual: "Check yourself",
};

export function setupStatusLabel(status: SetupItemStatus): string {
  return STATUS_LABEL[status];
}

/** Auto status helper: `done` when the condition holds, otherwise `todo`. */
function auto(done: boolean): SetupItemStatus {
  return done ? "done" : "todo";
}

export function buildSetupChecklist(signals: SetupSignals): SetupSection[] {
  return [
    {
      key: "business",
      title: "Business setup",
      items: [
        {
          key: "shop-name",
          label: "Shop name confirmed",
          why: "It shows to every customer on the website and their order.",
          status: "manual",
          href: "/admin/settings",
          actionLabel: "Open settings",
        },
        {
          key: "address",
          label: "Address confirmed",
          why: "Customers use it to find you and it prints on the collection note.",
          status: "manual",
          href: "/admin/settings",
          actionLabel: "Open settings",
        },
        {
          key: "opening-hours",
          label: "Opening hours confirmed",
          why: "Customers should only be able to order when you can actually prepare it.",
          status: "manual",
          href: "/admin/pickup-windows",
          actionLabel: "Open collection times",
        },
        {
          key: "pickup-windows",
          label: "Collection times set",
          why: "Customers can't place an order until at least one collection time exists.",
          status: auto(signals.activePickupWindowCount > 0),
          href: "/admin/pickup-windows",
          actionLabel: "Open collection times",
        },
      ],
    },
    {
      key: "product",
      title: "Product setup",
      items: [
        {
          key: "real-products",
          label: "Real products added",
          why: "Your real range needs to be in the shop before customers can order it.",
          status: auto(signals.productCount > 0),
          href: "/admin/products",
          actionLabel: "Open products",
        },
        {
          key: "prices",
          label: "Prices checked",
          why: "A product with no price can't be sold and looks broken to customers.",
          status: signals.productCount > 0 ? auto(signals.zeroPriceProductCount === 0) : "todo",
          href: "/admin/products",
          actionLabel: "Open products",
        },
        {
          key: "demo-removed",
          label: "Demo products removed",
          why: "The starter sample products must go before real customers see them.",
          status: auto(!signals.demoProductsPresent),
          href: "/admin/products",
          actionLabel: "Open products",
        },
        {
          key: "costs",
          label: "Costs entered for key products",
          why: "A cost lets the app show real profit instead of 'add a cost to see profit'.",
          status: "manual",
          href: "/admin/cutting-guide",
          actionLabel: "Open cutting & pricing",
        },
      ],
    },
    {
      key: "security",
      title: "Security setup",
      items: [
        {
          key: "temp-owner",
          label: "Temporary owner login removed or changed",
          why: "The setup login is a back door — change its password to one only you know.",
          status: "manual",
        },
        {
          key: "test-accounts",
          label: "Test accounts removed",
          why: "Practice logins (the .test accounts) must not exist on the live shop.",
          status: "manual",
        },
        {
          key: "reset-url",
          label: "Password reset link checked",
          why: "A 'forgot password' email must point at the real shop web address.",
          status: "manual",
        },
        {
          key: "staff-roles",
          label: "Staff logins created",
          why: "Counter staff should have their own login, separate from the owner.",
          status: auto(signals.staffAccountCount > 0),
          href: "/admin/settings",
          actionLabel: "Open settings",
        },
      ],
    },
    {
      key: "compliance",
      title: "Compliance setup",
      items: [
        {
          key: "halal-cert",
          label: "Halal certificate recorded",
          why: "It backs up the halal promise customers see on the website.",
          status: auto(signals.certificatesConfigured),
          href: "/admin/compliance",
          actionLabel: "Open compliance",
        },
        {
          key: "supplier-certs",
          label: "Supplier certificates recorded",
          why: "Proof your meat came from approved suppliers.",
          status: auto(signals.certificatesConfigured),
          href: "/admin/compliance",
          actionLabel: "Open compliance",
        },
        {
          key: "expiry",
          label: "Expiry warnings checked",
          why: "An expired certificate must be replaced before you sell that meat.",
          status:
            signals.certificatesConfigured && signals.expiredCertificates === 0
              ? signals.expiringCertificates > 0
                ? "todo"
                : "done"
              : "todo",
          href: "/admin/compliance",
          actionLabel: "Open compliance",
        },
      ],
    },
    {
      key: "operations",
      title: "Operations setup",
      items: [
        {
          key: "tablet",
          label: "Tablet tested",
          why: "The counter runs on the tablet — log in and try it before opening.",
          status: "manual",
          href: "/admin/guide",
          actionLabel: "Open the guide",
        },
        {
          key: "counter-flow",
          label: "Counter flow tested",
          why: "Walk one order through Start prep → Ready → Collected.",
          status: "manual",
          href: "/counter",
          actionLabel: "Open counter",
        },
        {
          key: "order-dry-run",
          label: "First order dry-run completed",
          why: "Place a practice order from a phone to prove checkout works end to end.",
          status: auto(signals.anyOrderPlaced),
          href: "/shop",
          actionLabel: "Open the shop",
        },
        {
          key: "stock-dry-run",
          label: "Stock intake dry-run completed",
          why: "Record one delivery so you know how to add stock on a busy day.",
          status: "manual",
          href: "/admin/inventory",
          actionLabel: "Open stock",
        },
      ],
    },
  ];
}

/** Owner-only launch-safety panel (Part 8) — prevents obvious launch mistakes. */
export function buildLaunchSafety(signals: SetupSignals): SetupItem[] {
  return [
    {
      key: "temp-owner-present",
      label: "Temporary owner account dealt with",
      why: "The bootstrap login must be removed or have a private password before opening.",
      status: "manual",
    },
    {
      key: "test-accounts-present",
      label: "Practice (.test) accounts removed from the live shop",
      why: "Seeded test logins should never exist on the real database.",
      status: "manual",
    },
    {
      key: "auth-redirect",
      label: "Password-reset web address is correct",
      why: "Supabase Auth must point reset emails at the real shop address, not an old preview.",
      status: "manual",
    },
    {
      key: "checkout-test-mode",
      label: "Checkout test mode is OFF",
      why: "If left on, customers see a 'place as test order' option at checkout.",
      status: auto(!signals.checkoutTestModeEnabled),
    },
    {
      key: "routes-protected",
      label: "Admin pages are locked to staff",
      why: "Customers must never reach the back office.",
      status: auto(signals.adminRoutesProtected),
    },
    {
      key: "hosted-smoke",
      label: "Latest hosted smoke test passed",
      why: "Confirms the live site still works after the last deploy.",
      status: "manual",
    },
    {
      key: "release-report",
      label: "Latest release report passed",
      why: "The release report checks types, tests, build and database drift before deploy.",
      status: "manual",
    },
  ];
}

/** Count of items the app could auto-verify as done, for a progress summary. */
export function setupProgress(sections: SetupSection[]): { done: number; auto: number } {
  const items = sections.flatMap((section) => section.items).filter((item) => item.status !== "manual");
  return {
    done: items.filter((item) => item.status === "done").length,
    auto: items.length,
  };
}
