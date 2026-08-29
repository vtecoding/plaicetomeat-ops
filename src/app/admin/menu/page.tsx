import Link from "next/link";
import {
  ChevronRight,
  ClipboardCheck,
  LayoutDashboard,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Sunrise,
  Sunset,
  Truck,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

const WORK_AREAS = [
  {
    title: "Money & orders",
    detail: "Takings, customer orders, amendments and refunds.",
    icon: ShoppingBag,
    href: "/admin/orders",
    action: "Open money & orders",
    secondary: { href: "/counter", label: "Open counter" },
  },
  {
    title: "Stock",
    detail: "Receive stock, use short-dated batches, record waste and correct counts.",
    icon: PackageCheck,
    href: "/admin/inventory",
    action: "Open stock",
    secondary: { href: "/admin/stock-count", label: "Count stock" },
  },
  {
    title: "Buying",
    detail: "See what may need ordering and what to check before calling a supplier.",
    icon: Truck,
    href: "/admin/purchasing",
    action: "Open buying",
  },
  {
    title: "Suppliers & safety",
    detail: "Supplier certificates, expiry checks and the documents behind them.",
    icon: ShieldCheck,
    href: "/admin/compliance",
    action: "Open suppliers & safety",
    secondary: { href: "/admin/compliance#supporting-files", label: "Review supporting files" },
  },
] as const;

export default async function OwnerWorkPage() {
  await requireStaffContext("manager", { branchScoped: true });

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 lg:px-8" data-testid="owner-menu">
        <Masthead
          back={<BackLink href="/admin/today">Back to Today</BackLink>}
          eyebrow="Work"
          title="Choose the job"
          subtitle="Four business areas. The system keeps the specialist steps underneath them."
        />

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Owner work areas">
          {WORK_AREAS.map((area) => (
            <article key={area.href} className="flex flex-col rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)] ring-1 ring-[#c5ddd0]">
                <area.icon className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="mt-4 font-display text-2xl font-semibold text-[var(--ink)]">{area.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-[var(--muted)]">{area.detail}</p>
              <Link href={area.href} className="mt-5 flex min-h-12 items-center justify-between rounded-xl bg-[var(--brand)] px-4 font-bold text-white">
                {area.action}
                <ChevronRight className="h-5 w-5" aria-hidden />
              </Link>
              {"secondary" in area ? (
                <Link href={area.secondary.href} className="mt-2 inline-flex min-h-11 items-center justify-center text-sm font-bold text-[var(--brand)] hover:underline">
                  {area.secondary.label}
                </Link>
              ) : null}
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--cream)] p-5" aria-labelledby="daily-routines-title">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-5 w-5 text-[var(--brand)]" aria-hidden />
            <div>
              <h2 id="daily-routines-title" className="font-display text-xl font-semibold text-[var(--ink)]">Daily routines</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Today normally opens the right routine automatically. These are the direct doors.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <RoutineLink href="/admin/open" label="Open shop" icon={Sunrise} />
            <RoutineLink href="/admin/close" label="Close shop" icon={Sunset} />
            <RoutineLink href="/counter" label="Counter" icon={LayoutDashboard} />
          </div>
        </section>
      </main>
    </PageFrame>
  );
}

function RoutineLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Sunrise }) {
  return (
    <Link href={href} className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 font-bold text-[var(--brand)]">
      <Icon className="h-5 w-5" aria-hidden />
      {label}
    </Link>
  );
}
