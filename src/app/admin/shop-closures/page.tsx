import { CalendarOff } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { demoShopClosures } from "@/lib/data/demo";
import { formatDisplayDate } from "@/lib/utils";

export default function AdminShopClosuresPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
            <h1 className="mt-2 text-3xl font-black">Shop closures</h1>
          </div>
          <Button type="button">Add closure</Button>
        </div>
        <div className="mt-8 grid gap-4">
          {demoShopClosures.map((closure) => (
            <article key={closure.id} className="flex items-center gap-4 rounded-lg border border-[#ded6ca] bg-white p-5">
              <CalendarOff className="h-6 w-6 text-[#b42318]" aria-hidden />
              <div>
                <p className="font-black">{formatDisplayDate(closure.closeDate)}</p>
                <p className="text-sm text-[#6c5e52]">{closure.reason}</p>
              </div>
            </article>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}
