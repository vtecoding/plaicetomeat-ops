import { AdminSettingsClient } from "@/components/admin-settings-client";
import Link from "next/link";
import { Bell, CalendarDays, ChevronRight, PackageSearch } from "lucide-react";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getBranchById, getBranchSettings } from "@/lib/server/catalog";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const { branchId, profile } = await requireStaffContext("manager", { branchScoped: true });
  const [settings, currentBranch] = await Promise.all([
    getBranchSettings(branchId),
    getBranchById(branchId),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin/today">Back to Today</BackLink>}
          eyebrow="Settings"
          title="Settings"
          subtitle="The things that change occasionally, kept away from the daily work."
        />

        <section className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Settings areas">
          <SettingsLink
            href="/admin/products"
            icon={PackageSearch}
            title="Catalog & prices"
            detail="Products, prices, units and availability."
          />
          <SettingsLink
            href="/admin/schedule"
            icon={CalendarDays}
            title="Shop schedule"
            detail="Collection times and closed days."
          />
          {profile.role === "owner" ? (
            <SettingsLink
              href="/admin/settings/notifications"
              icon={Bell}
              title="Owner alerts"
              detail="Devices that receive urgent shop alerts."
            />
          ) : null}
        </section>

        {profile.role === "owner" ? (
          <Surface className="mt-6 p-6">
            <h2 className="font-display text-2xl font-semibold text-[var(--ink)]">Shop details</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Address, customer messages and cancellation rules.</p>
            <div className="mt-5">
              <AdminSettingsClient branch={currentBranch} settings={settings} />
            </div>
          </Surface>
        ) : null}
      </main>
    </PageFrame>
  );
}

function SettingsLink({
  href,
  icon: Icon,
  title,
  detail,
}: {
  href: string;
  icon: typeof PackageSearch;
  title: string;
  detail: string;
}) {
  return (
    <Link href={href} className="flex min-h-24 items-center gap-4 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm transition hover:border-[#c5ddd0] hover:bg-[var(--brand-50)]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--cream)] text-[var(--brand)] ring-1 ring-[var(--line)]">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-semibold text-[var(--ink)]">{title}</span>
        <span className="mt-1 block text-sm text-[var(--muted)]">{detail}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[var(--brand)]" aria-hidden />
    </Link>
  );
}
