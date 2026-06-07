import Link from "next/link";
import { ArrowRight, BookOpen, GraduationCap } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { requireStaffContext } from "@/lib/server/staff-context";
import { allPlaybookContent } from "@/lib/shop-intelligence/playbook-content";

export const dynamic = "force-dynamic";

export default async function PlaybooksPage() {
  await requireStaffContext("manager");

  const playbooks = allPlaybookContent();

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="playbooks-page">
        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">How to run the shop</p>
          <h1 className="mt-2 text-3xl font-black">Operational playbooks</h1>
          <p className="mt-2 text-sm leading-6 text-[#5c5148]">
            Short, plain-English how-to guides for each job. The briefing links you straight to the right one when
            something needs doing.
          </p>
        </header>

        <Link
          href="/admin/playbooks/butcher-words"
          className="mt-4 flex items-center gap-4 rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-5 shadow-sm transition hover:-translate-y-0.5 hover:bg-[#eafaf0] hover:shadow-md"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-white">
            <GraduationCap className="h-6 w-6" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-black text-[#0f5132]">New to butchery? Start here</span>
            <span className="block text-sm text-[#27543c]">Butcher words explained in plain English — yield, margin, trim and the rest.</span>
          </span>
          <ArrowRight className="ml-auto hidden h-5 w-5 shrink-0 text-[#0f5132] sm:block" aria-hidden />
        </Link>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {playbooks.map((playbook) => (
            <Link
              key={playbook.slug}
              href={`/admin/playbooks/${playbook.slug}`}
              className="group flex flex-col rounded-2xl border border-[#ded6ca] bg-[#fbfaf7] p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
            >
              <BookOpen className="h-6 w-6 text-[#0f5132]" aria-hidden />
              <p className="mt-3 text-lg font-black text-[#241f1a]">{playbook.title}</p>
              <p className="mt-1 text-sm text-[#6c5e52]">{playbook.summary}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#0f5132]">
                Read
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}
