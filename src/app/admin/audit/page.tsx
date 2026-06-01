import { redirect } from "next/navigation";

import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getRecentAuditEvents } from "@/lib/server/audit-events";
import { getCurrentProfile } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

type AuditSearchParams = {
  user?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
};

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<AuditSearchParams> }) {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const filters = await searchParams;
  const events = await getRecentAuditEvents(filters);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Audit log</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">Immutable operational events for accountability.</p>

        <form className="mt-6 grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5 md:grid-cols-5" action="/admin/audit">
          <label className="grid gap-1 text-sm font-semibold">
            User
            <input
              className="h-11 rounded-md border border-[#cfc7bb] px-3 text-sm"
              name="user"
              defaultValue={filters.user ?? ""}
              placeholder="email"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Event type
            <input
              className="h-11 rounded-md border border-[#cfc7bb] px-3 text-sm"
              name="eventType"
              defaultValue={filters.eventType ?? ""}
              placeholder="waste_recorded"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            From
            <input className="h-11 rounded-md border border-[#cfc7bb] px-3 text-sm" type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ""} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            To
            <input className="h-11 rounded-md border border-[#cfc7bb] px-3 text-sm" type="date" name="dateTo" defaultValue={filters.dateTo ?? ""} />
          </label>
          <div className="flex items-end">
            <button className="h-11 rounded-md bg-[#0f5132] px-4 text-sm font-bold text-white" type="submit">
              Search
            </button>
          </div>
        </form>

        <section className="mt-8 grid gap-3">
          {events.length === 0 ? (
            <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">
              No audit events yet. Important admin writes will appear here after the V3 migration is applied.
            </p>
          ) : (
            events.map((event) => (
              <article key={event.id} className="rounded-lg border border-[#ded6ca] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-black">{event.summary}</h2>
                    <p className="mt-1 text-sm text-[#6c5e52]">
                      {event.eventType} - {event.entityType}
                      {event.entityId ? ` - ${event.entityId}` : ""}
                    </p>
                  </div>
                  <time className="text-sm text-[#6c5e52]" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString("en-GB")}
                  </time>
                </div>
                <p className="mt-3 text-sm text-[#6c5e52]">
                  Actor: {event.actorEmail ?? "system"} {event.actorRole ? `(${event.actorRole})` : ""}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.08em] text-[#8a7d70]">
                  Investigation timeline event
                </p>
              </article>
            ))
          )}
        </section>
      </main>
    </PageFrame>
  );
}
