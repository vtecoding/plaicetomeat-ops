import { ClipboardCheck, Thermometer } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { demoComplianceLog, demoComplianceReadings } from "@/lib/data/demo";
import { validateComplianceCompletion } from "@/lib/domain/compliance";

export default function CounterCompliancePage() {
  const validation = validateComplianceCompletion(demoComplianceLog, demoComplianceReadings);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Compliance vault</p>
          <h1 className="mt-2 text-3xl font-black">Daily log</h1>
          <p className="mt-2 text-sm text-[#6c5e52]">PlaiceToMeat Ops supports compliance record-keeping.</p>
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-lg border border-[#ded6ca] bg-white p-6">
            <div className="flex items-center gap-3">
              <Thermometer className="h-6 w-6 text-[#0f5132]" aria-hidden />
              <h2 className="text-xl font-black">Temperature reading</h2>
            </div>

            <form className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-semibold" htmlFor="readingType">
                  Reading type
                </label>
                <Select id="readingType" name="readingType" defaultValue="midday">
                  <option value="opening">Opening</option>
                  <option value="midday">Midday</option>
                  <option value="closing">Closing</option>
                  <option value="ad_hoc">Ad hoc</option>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold" htmlFor="chiller">
                  Chiller temp C
                </label>
                <Input id="chiller" name="chiller" type="number" step="0.1" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold" htmlFor="freezer">
                  Freezer temp C
                </label>
                <Input id="freezer" name="freezer" type="number" step="0.1" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold" htmlFor="display">
                  Display temp C
                </label>
                <Input id="display" name="display" type="number" step="0.1" />
              </div>
              <div className="sm:col-span-2">
                <Button type="button">
                  <Thermometer className="h-4 w-4" aria-hidden />
                  Add reading
                </Button>
              </div>
            </form>

            <div className="mt-8">
              <h3 className="font-black">Recorded today</h3>
              <div className="mt-3 divide-y divide-[#eee5d8] rounded-lg border border-[#eee5d8]">
                {demoComplianceReadings.map((reading) => (
                  <div key={reading.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4">
                    <p className="font-bold capitalize">{reading.readingType.replace("_", " ")}</p>
                    <p>Chiller {reading.chillerTempC}C</p>
                    <p>Freezer {reading.freezerTempC}C</p>
                    <p>Display {reading.displayTempC ?? "-"}C</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="rounded-lg border border-[#ded6ca] bg-white p-5">
            <div className="flex items-center gap-3">
              <ClipboardCheck className="h-6 w-6 text-[#0f5132]" aria-hidden />
              <h2 className="text-xl font-black">Completion checks</h2>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              {["Cleaning completed", "Sanitisation completed", "Waste checked"].map((label) => (
                <label key={label} className="flex items-center gap-3 rounded-md bg-[#fbfaf7] p-3">
                  <input type="checkbox" className="h-5 w-5 accent-[#0f5132]" />
                  <span className="font-semibold">{label}</span>
                </label>
              ))}
            </div>
            {!validation.valid && (
              <div className="mt-5 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]">
                {validation.errors[0]}
              </div>
            )}
            <Button type="button" className="mt-5 w-full" disabled={!validation.valid}>
              Mark completed
            </Button>
          </aside>
        </section>
      </main>
    </PageFrame>
  );
}
