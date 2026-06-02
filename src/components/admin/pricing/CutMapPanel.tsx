"use client";

import { Badge } from "@/components/ui/badge";
import { findCutMapRegion, getCutMap } from "@/lib/domain/cut-map-data";
import { cn } from "@/lib/utils";

type CutMapPanelProps = {
  animalType: string;
  selectedCutId: string | null;
  selectedCutName: string | null;
  onSelectCut: (cutId: string) => void;
};

export function CutMapPanel({ animalType, selectedCutId, selectedCutName, onSelectCut }: CutMapPanelProps) {
  const map = getCutMap(animalType);
  const selectedRegion = selectedCutId ? findCutMapRegion(animalType, selectedCutId) : null;
  const selectedRegionByName = !selectedRegion && selectedCutName ? findCutMapRegion(animalType, selectedCutName) : selectedRegion;

  if (!map) {
    return (
      <section className="rounded-xl border border-[#f0d8a8] bg-[#fff8e8] p-4" data-testid="cut-map-panel">
        <p className="text-sm font-bold text-[#7a4b00]">Cut map unavailable for this animal yet.</p>
      </section>
    );
  }

  const selectedText = selectedRegionByName ? `Selected region: ${selectedRegionByName.label}` : "This cut is not mapped yet.";

  return (
    <section className="rounded-xl border border-[#ded6ca] bg-white p-4" data-testid="cut-map-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Cut map</p>
        <Badge tone={selectedRegionByName ? "green" : "amber"} data-testid="selected-cut-region">
          {selectedText}
        </Badge>
      </div>

      <svg className="mt-3 h-auto w-full" viewBox={map.viewBox} role="img" aria-label={map.title}>
        <defs>
          <filter id={`shadow-${map.animalType}`} x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#231f20" floodOpacity="0.1" />
          </filter>
        </defs>
        <path
          d={map.outlinePath}
          fill="#f4efe7"
          stroke="#6c5e52"
          strokeWidth="3"
          strokeLinejoin="round"
          filter={`url(#shadow-${map.animalType})`}
        />
        {map.regions.map((region) => {
          const active = selectedRegionByName?.id === region.id;
          return (
            <g key={region.id}>
              <path
                d={region.path}
                role="button"
                tabIndex={0}
                aria-label={`View ${region.label}`}
                aria-pressed={active}
                data-testid={`cut-map-region-${region.id}`}
                className="cursor-pointer transition-colors focus:outline-none focus-visible:stroke-[#0f5132]"
                fill={active ? "#0f5132" : "#e7dfd3"}
                fillOpacity={active ? 1 : 0.85}
                stroke={active ? "#072d1c" : "#b3a895"}
                strokeWidth={active ? 3 : 1.75}
                strokeLinejoin="round"
                onClick={() => onSelectCut(region.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectCut(region.id);
                  }
                }}
              />
              <text
                x={region.labelX}
                y={region.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className={cn("pointer-events-none select-none text-[14px] font-black", active ? "fill-white" : "fill-[#3a342d]")}
                paintOrder="stroke"
                stroke={active ? "#0f5132" : "#f4efe7"}
                strokeWidth={active ? 0 : 4}
              >
                {region.label}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="mt-3 text-xs leading-5 text-[#8a7d70]">
        {map.sourceNote} Ask an experienced butcher before changing seam lines.
      </p>
    </section>
  );
}
