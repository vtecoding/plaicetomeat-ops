import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  PackageSearch,
  PoundSterling,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Sunrise,
  Sunset,
  Truck,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

type MenuItem = {
  href: string;
  label: string;
  detail?: string;
  icon: typeof Store;
  ownerOnly?: boolean;
  testid?: string;
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
};

const GROUPS: MenuGroup[] = [
  {
    title: "Shop",
    items: [
      { href: "/admin/open", label: "Open shop", detail: "Morning checklist", icon: Sunrise },
      { href: "/admin/close", label: "Close shop", detail: "End-of-day checklist", icon: Sunset },
      { href: "/counter", label: "Counter", detail: "Serve and prepare orders", icon: LayoutDashboard },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/admin/stock-count", label: "Stock count", detail: "Count what is really there", icon: ClipboardCheck },
      { href: "/admin/inventory", label: "Stock and deliveries", detail: "Stock on hand, dates and movements", icon: PackageCheck },
      { href: "/admin/purchasing", label: "Purchasing", detail: "What may need ordering", icon: Truck },
      { href: "/admin/products", label: "Products and prices", icon: PackageSearch },
    ],
  },
  {
    title: "Orders",
    items: [
      { href: "/admin/orders", label: "Orders", detail: "Find orders and exceptions", icon: ShoppingBag },
      { href: "/admin/pickup-windows", label: "Collection times", icon: CalendarDays },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin", label: "Sales and till", detail: "Takings, payments and shop performance", icon: PoundSterling, testid: "business-insights-link" },
      { href: "/admin/reconcile", label: "Checks to resolve", detail: "Review open shop differences", icon: ListChecks },
    ],
  },
  {
    title: "Food safety",
    items: [
      { href: "/admin/compliance", label: "Food safety and certificates", icon: ShieldCheck },
      { href: "/admin/evidence", label: "Photos and documents", icon: ClipboardCheck },
    ],
  },
  {
    title: "Reports",
    items: [
      { href: "/admin#business-insights", label: "Week at a glance", detail: "Sales, stock and trends", icon: Store },
      { href: "/admin/audit", label: "Activity history", detail: "Who changed what and when", icon: FileClock, ownerOnly: true },
    ],
  },
  {
    title: "Owner Away",
    items: [
      { href: "/admin/away", label: "Owner Away", detail: "Check the shop while you are out", icon: AlertTriangle, ownerOnly: true, testid: "owner-away-link" },
    ],
  },
  {
    title: "Help",
    items: [
      { href: "/admin/today/walk", label: "Walk me through today", detail: "Take today's priorities one at a time", icon: ListChecks },
      { href: "/admin/guide", label: "Help", detail: "Quick answers and guidance", icon: BookOpen },
      { href: "/admin/playbooks", label: "How to do each job", icon: BookOpen },
      { href: "/admin/tutorial", label: "Owner practice", detail: "A short decision dry run", icon: ClipboardCheck },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/admin/settings", label: "Shop settings", icon: Settings },
      { href: "/admin/shop-closures", label: "Closed days", icon: CalendarDays },
    ],
  },
];

export default async function OwnerMenuPage() {
  const { profile } = await requireStaffContext("manager", { branchScoped: true });
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.ownerOnly || profile.role === "owner"),
  })).filter((group) => group.items.length > 0);

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="owner-menu">
        <Masthead
          back={<BackLink href="/admin/today">Back to Today</BackLink>}
          eyebrow="Menu"
          title="Where do you need to go?"
          subtitle="Today holds your priorities. Everything else is here."
        />

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`menu-${group.title.toLowerCase().replaceAll(" ", "-")}`}>
              <h2 id={`menu-${group.title.toLowerCase().replaceAll(" ", "-")}`} className="px-1 text-sm font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
                {group.title}
              </h2>
              <ul className="mt-2 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
                {group.items.map((item) => (
                  <li key={`${item.href}-${item.label}`} className="border-b border-[var(--line)] last:border-b-0">
                    <Link
                      href={item.href}
                      data-testid={item.testid}
                      className="group flex min-h-16 items-center gap-3 px-4 py-3 transition hover:bg-[var(--brand-50)]"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--cream)] text-[var(--brand)] ring-1 ring-[var(--line)]">
                        <item.icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-[var(--ink)]">{item.label}</span>
                        {item.detail && <span className="mt-0.5 block text-sm text-[var(--muted)]">{item.detail}</span>}
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}
