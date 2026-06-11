import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, ShieldCheck } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { setupStatusLabel, type SetupItem, type SetupItemStatus } from "@/lib/domain/setup-checklist";
import { getDashboardMetrics } from "@/lib/server/dashboard";
import { getSetupChecklist } from "@/lib/server/setup-checklist";
import { requireStaffContext } from "@/lib/server/staff-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const { profile, branchId } = await requireStaffContext("manager", { branchScoped: true });
  const metrics = await getDashboardMetrics(branchId);
  const { sections, launchSafety, progress } = await getSetupChecklist(branchId, metrics);
  const isOwner = profile.role === "owner";

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="setup-checklist">
        <Masthead
          back={<BackLink href="/admin/today">Back to Today</BackLink>}
          eyebrow="Get ready to open"
          title="Setup checklist"
          subtitle="Work down this list before opening. The app ticks what it can see; the rest are quick checks only you can confirm."
        />
        <p className="mt-4 rounded-xl bg-[#f2fbf5] p-3 text-sm font-semibold text-[var(--brand)]">
          {progress.done} of {progress.auto} checks the app can see are done.
        </p>

        {sections.map((section) => (
          <section key={section.key} className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm">
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <div className="mt-4 grid gap-3">
              {section.items.map((item) => (
                <ChecklistRow key={item.key} item={item} />
              ))}
            </div>
          </section>
        ))}

        {isOwner && (
          <section
            className="mt-6 rounded-2xl border border-[#e7c9a0] bg-[#fffaf2] p-5 shadow-sm"
            data-testid="launch-safety"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-6 w-6 text-[#92510a]" aria-hidden />
              <div>
                <h2 className="text-xl font-semibold">Launch safety</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  A last check for the boring jobs that stop a safe opening. Owner only.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {launchSafety.map((item) => (
                <ChecklistRow key={item.key} item={item} />
              ))}
            </div>
          </section>
        )}
      </main>
    </PageFrame>
  );
}

function ChecklistRow({ item }: { item: SetupItem }) {
  return (
    <article className="flex items-start gap-3 rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{item.label}</p>
          <StatusBadge status={item.status} />
        </div>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.why}</p>
        {item.href && (
          <Link
            href={item.href}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-full border border-[#d6cdc0] bg-white px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#f3efe8]"
          >
            {item.actionLabel ?? "Open"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
    </article>
  );
}

function StatusIcon({ status }: { status: SetupItemStatus }) {
  if (status === "done") return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5132]" aria-hidden />;
  if (status === "todo") return <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#b45309]" aria-hidden />;
  return <Circle className="mt-0.5 h-5 w-5 shrink-0 text-[#8a7d70]" aria-hidden />;
}

function StatusBadge({ status }: { status: SetupItemStatus }): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.08em]",
        status === "done" && "bg-[#e6f5ec] text-[#0f5132]",
        status === "todo" && "bg-[#fff4d8] text-[#8b5e00]",
        status === "manual" && "bg-[#eee7db] text-[#6c5e52]",
      )}
    >
      {setupStatusLabel(status)}
    </span>
  );
}
