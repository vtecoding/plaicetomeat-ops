import { Beef, ClipboardCheck, LayoutDashboard, ListChecks, Settings, ShieldCheck, ShoppingBag, ShoppingBasket } from "lucide-react";

import type { StaffRole } from "@/lib/domain/route-access";

export type NavLink = { href: string; label: string; icon: typeof Beef };

/** Customer storefront links. Shown as the main nav to visitors only. */
export const PUBLIC_LINKS: NavLink[] = [
  { href: "/shop", label: "Shop", icon: Beef },
  { href: "/our-halal-promise", label: "Halal Promise", icon: ClipboardCheck },
  { href: "/basket", label: "Basket", icon: ShoppingBasket },
];

export const STAFF_LINKS: NavLink[] = [
  { href: "/counter", label: "Counter", icon: LayoutDashboard },
  { href: "/counter/compliance", label: "Food safety", icon: ShieldCheck },
];

// The owner sees four stable destinations. Task routes such as opening, closing,
// stock count and order correction stay contextual so the navigation reflects
// business intent instead of the app's internal route structure.
export const MANAGER_LINKS: NavLink[] = [
  { href: "/admin/today", label: "Today", icon: ListChecks },
  { href: "/admin/menu", label: "Work", icon: ShoppingBag },
  { href: "/admin", label: "Review", icon: LayoutDashboard },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export type ResolvedNav = {
  /** The main nav row: the operator's tools when staff are logged in, else the shop. */
  primary: NavLink[];
  /**
   * The one storefront link a staff member still needs — kept reachable but pulled out
   * of the operator nav so it can't compete with Counter / Today / Food safety.
   */
  shopView: NavLink | null;
};

/**
 * Decide the header navigation for a given role. The butcher behind the counter doesn't
 * shop his own counter — so once staff are logged in, customer storefront links (Shop,
 * Halal Promise, Basket) leave the main nav and the storefront stays reachable through a
 * single, clearly separated "Shop view" entry instead.
 */
export function resolveNav(role: StaffRole | null | undefined): ResolvedNav {
  const isStaff = role === "staff" || role === "manager" || role === "owner";
  const isManager = role === "manager" || role === "owner";

  if (!isStaff) {
    return { primary: PUBLIC_LINKS, shopView: null };
  }

  const primary = isManager ? MANAGER_LINKS : STAFF_LINKS;
  const shopView = PUBLIC_LINKS.find((link) => link.href === "/shop") ?? null;
  return { primary, shopView };
}
