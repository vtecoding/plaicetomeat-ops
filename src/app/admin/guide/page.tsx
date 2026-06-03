import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BookOpen, ClipboardCheck } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

type Guide = { title: string; steps: string[] };

const GUIDES: Guide[] = [
  {
    title: "How to handle an order",
    steps: [
      "Open Counter.",
      "Find the order in the Incoming column.",
      "Press Start Prep and pack it.",
      "Press Mark Ready when it's packed.",
      "Press Collected when the customer pays and takes it.",
    ],
  },
  {
    title: "How to add stock",
    steps: [
      "Open Add stock (Stock).",
      "Choose the product that came in.",
      "Enter the weight and what it cost.",
      "Save. The shop now knows what you have.",
    ],
  },
  {
    title: "How to check what needs doing",
    steps: [
      "Open Today.",
      "Read Today's jobs at the top — that's your list.",
      "Each job tells you why it matters and has a button.",
      "Press the button to deal with it.",
    ],
  },
  {
    title: "How to record waste",
    steps: [
      "Open Stock.",
      "Find the product you're throwing away.",
      "Record how much and why (out of date, damaged).",
      "Save. This is how the shop learns what to order less of.",
    ],
  },
  {
    title: "How to check certificates",
    steps: [
      "Open Compliance.",
      "Look for anything marked expiring or expired.",
      "Ask that supplier for an up-to-date certificate.",
      "Upload it so the warning clears.",
    ],
  },
  {
    title: "What to do if something looks wrong",
    steps: [
      "Don't panic — an order is never lost, even if a text fails.",
      "Open Counter and check the order is still there.",
      "If a number looks wrong, check Stock and Products.",
      "If you're stuck, write down what you saw and ask your helper.",
    ],
  },
];

type DryRunGroup = { title: string; items: string[] };

const DRY_RUN: DryRunGroup[] = [
  {
    title: "Full order test",
    items: [
      "Customer places an order",
      "Staff sees the order on Counter",
      "Staff presses Start Prep",
      "Staff presses Mark Ready",
      "Customer pays at collection",
      "Staff presses Collected",
    ],
  },
  {
    title: "Stock test",
    items: ["Receive stock", "Confirm intake", "Check the stock count updated", "Correct the stock if needed"],
  },
  {
    title: "Compliance test",
    items: ["Upload a certificate", "Check the expiry warning shows"],
  },
  {
    title: "Closed shop test",
    items: ["Try to order outside opening times", "Check it is blocked"],
  },
  {
    title: "Tablet test",
    items: ["Log in", "Leave it idle for a while", "Unlock or log back in", "Run the counter flow"],
  },
];

export default async function GuidePage() {
  const profile = await getCurrentProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="owner-guide">
        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <BookOpen className="mt-0.5 h-6 w-6 text-[#0f5132]" aria-hidden />
              <div>
                <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Help</p>
                <h1 className="mt-1 text-3xl font-black">How to run the shop</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6c5e52]">
                  Short steps for the everyday jobs. Each one is just a few presses.
                </p>
              </div>
            </div>
            <Link
              href="/admin/today"
              className="inline-flex h-11 items-center rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#efe8dd]"
            >
              Back to Today
            </Link>
          </div>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {GUIDES.map((guide) => (
            <Card key={guide.title} title={guide.title}>
              <ol className="mt-3 grid gap-2">
                {guide.steps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm leading-6 text-[#3f3a33]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-xs font-black text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>

        <section
          className="mt-8 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm print:border-0 print:shadow-none"
          data-testid="dry-run-script"
        >
          <div className="flex items-start gap-3">
            <ClipboardCheck className="mt-0.5 h-6 w-6 text-[#0f5132]" aria-hidden />
            <div>
              <h2 className="text-xl font-black">Shop dry-run before opening</h2>
              <p className="mt-1 text-sm text-[#6c5e52]">
                Print this and tick each step. Do it once before your first real day.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {DRY_RUN.map((group) => (
              <div key={group.title} className="rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
                <p className="text-sm font-black">{group.title}</p>
                <ul className="mt-2 grid gap-2">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[#3f3a33]">
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#0f5132]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
    </PageFrame>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">{title}</h2>
      {children}
    </section>
  );
}
