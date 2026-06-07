import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2 } from "lucide-react";

import { PageFrame } from "@/components/site-header";
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
        <Link href="/admin/playbooks" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All playbooks
        </Link>

        <header className="mt-3 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-[#0f5132]" aria-hidden />
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Playbook</p>
          </div>
          <h1 className="mt-2 text-3xl font-black">{playbook.title}</h1>
          <p className="mt-2 text-base leading-7 text-[#3f372f]">{playbook.intro}</p>
        </header>

        <section className="mt-4 rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-5">
          <p className="text-xs font-black uppercase tracking-[0.1em] text-[#0f5132]">Why it matters</p>
          <p className="mt-2 text-sm leading-6 text-[#27543c]">{playbook.whenItMatters}</p>
        </section>

        <section className="mt-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Step by step</h2>
          <ol className="mt-3 grid gap-3">
            {playbook.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-sm font-black text-white">
                  {index + 1}
                </span>
                <span className="text-sm leading-7 text-[#3f372f]">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-4 rounded-2xl border border-[#f4d7a1] bg-[#fff9ef] p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[#8b5e00]" aria-hidden />
            <h2 className="text-lg font-black text-[#8b5e00]">Watch out for</h2>
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
