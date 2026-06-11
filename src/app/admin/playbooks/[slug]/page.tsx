import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { requireStaffContext } from "@/lib/server/staff-context";
import { allPlaybookContent, getPlaybookContent } from "@/lib/shop-intelligence/playbook-content";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return allPlaybookContent().map((playbook) => ({ slug: playbook.slug }));
}

export default async function PlaybookPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireStaffContext("manager");

  const { slug } = await params;
  const playbook = getPlaybookContent(slug);
  if (!playbook) {
    notFound();
  }

  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="playbook-detail">
        <Masthead
          back={<BackLink href="/admin/playbooks">All playbooks</BackLink>}
          eyebrow="Playbook"
          title={playbook.title}
          subtitle={playbook.intro}
        />

        <section className="mt-6 rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-5">
          <p className="eyebrow text-[var(--brand)]">Why it matters</p>
          <p className="mt-2 text-sm leading-6 text-[#27543c]">{playbook.whenItMatters}</p>
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Step by step</h2>
          <ol className="mt-3 grid gap-3">
            {playbook.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <span className="text-sm leading-7 text-[var(--ink)]">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-4 rounded-2xl border border-[#f4d7a1] bg-[#fff9ef] p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[#8b5e00]" aria-hidden />
            <h2 className="text-lg font-semibold text-[#8b5e00]">Watch out for</h2>
          </div>
          <ul className="mt-3 grid gap-2">
            {playbook.watchFor.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[#5c4a1f]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#8b5e00]" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </PageFrame>
  );
}
