import { PageFrame } from "@/components/site-header";
import { demoComplianceLog, demoComplianceReadings } from "@/lib/data/demo";
import { formatDisplayDate } from "@/lib/utils";

export default function AdminCompliancePage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Compliance history</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">PlaiceToMeat Ops supports compliance record-keeping.</p>
        <article className="mt-8 rounded-lg border border-[#ded6ca] bg-white p-5">
          <p className="text-lg font-black">{formatDisplayDate(demoComplianceLog.logDate)}</p>
          <p className="mt-1 text-sm capitalize text-[#6c5e52]">{demoComplianceLog.status}</p>
          <div className="mt-5 divide-y divide-[#eee5d8] rounded-lg border border-[#eee5d8]">
            {demoComplianceReadings.map((reading) => (
              <div key={reading.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4">
                <p className="font-bold capitalize">{reading.readingType.replace("_", " ")}</p>
                <p>Chiller {reading.chillerTempC}C</p>
                <p>Freezer {reading.freezerTempC}C</p>
                <p>Display {reading.displayTempC ?? "-"}C</p>
              </div>
            ))}
          </div>
        </article>
      </main>
    </PageFrame>
  );
}
