import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getRecentAuditEvents } from "@/lib/server/audit-events";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

type AuditSearchParams = {
  user?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
};

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<AuditSearchParams> }) {
  // Owner-only: re-checked here in the data path, not merely in middleware.
  await requireStaffContext("owner");

  const filters = await searchParams;
  const events = await getRecentAuditEvents(filters);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin">Back to dashboard</BackLink>}
          eyebrow="Admin"
          title="Audit log"
          subtitle="Immutable operational events for accountability."
        />

        <form className="mt-6 grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 md:grid-cols-5" action="/admin/audit">
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
            <button className="h-11 rounded-md bg-[var(--brand)] px-4 text-sm font-bold text-white" type="submit">
              Search
            </button>
          </div>
        </form>

        <section className="mt-8 grid gap-3">
          {events.length === 0 ? (
            <Surface className="p-5 text-sm text-[var(--muted)]">
              No audit events yet. Important admin writes will appear here after the V3 migration is applied.
            </Surface>
          ) : (
            events.map((event) => (
              <article key={event.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_1px_0_rgba(255,255,255,0.7),0_18px_40px_-34px_rgba(40,28,16,0.4)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{event.summary}</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {event.eventType} - {event.entityType}
                      {event.entityId ? ` - ${event.entityId}` : ""}
                    </p>
                  </div>
                  <time className="text-sm text-[var(--muted)]" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString("en-GB")}
                  </time>
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Actor: {event.actorEmail ?? "system"} {event.actorRole ? `(${event.actorRole})` : ""}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--faint)]">
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
