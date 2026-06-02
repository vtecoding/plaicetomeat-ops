"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { findCutMapRegion, getCutMap, getToolGuidance } from "@/lib/domain/cut-map-data";
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
  const guidance = selectedCutId ? getToolGuidance(selectedCutId) ?? (selectedCutName ? getToolGuidance(selectedCutName) : null) : null;

  if (!map) {
    return (
      <section className="rounded-xl border border-[#f0d8a8] bg-[#fdf6e9] p-4" data-testid="cut-map-panel">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#92510a]" aria-hidden />
          <p className="text-sm text-[#92510a]">No animal map configured for this animal type.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#ded6ca] bg-white p-4" data-testid="cut-map-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#1f1b16]">V6.2 visual cut map</p>
          <p className="text-xs leading-5 text-[#6c5e52]">{map.sourceNote}</p>
        </div>
        <Badge tone={selectedRegionByName ? "green" : "amber"}>
          {selectedRegionByName ? `Region: ${selectedRegionByName.label}` : "No map region configured"}
        </Badge>
      </div>

      <svg className="mt-3 h-auto w-full" viewBox={map.viewBox} role="img" aria-label={map.title}>
        <path d={map.outlinePath} fill="#fbfaf7" stroke="#8a7d70" strokeWidth="3" />
        {map.regions.map((region) => {
          const active = selectedRegionByName?.id === region.id;
          return (
            <g key={region.id}>
              <path
                d={region.path}
                role="button"
                tabIndex={0}
                aria-label={`Highlight ${region.label}`}
                data-testid={`cut-map-region-${region.id}`}
                className="cursor-pointer transition"
                fill={active ? "#0f5132" : "#efe8dd"}
                stroke={active ? "#083a23" : "#b7aa9c"}
                strokeWidth={active ? 3 : 1.5}
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
                className={cn("pointer-events-none select-none fill-[#3b332c] text-[13px] font-black", active && "fill-white")}
              >
                {region.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-4 rounded-lg bg-[#f7f3ed] p-3">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Novice guardrail</p>
        <p className="mt-1 text-sm font-black text-[#1f1b16]">{selectedCutName ?? "No cut selected"}</p>
        <p className="mt-1 text-sm leading-6 text-[#5c5148]">
          {guidance
            ? `${guidance.sourceRegion} - ${guidance.difficulty}. ${guidance.caution}`
            : "Tool guidance unavailable. Ask an experienced butcher before changing the cut plan."}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {guidance ? guidance.tools.map((tool) => <Badge key={tool}>{tool}</Badge>) : <Badge tone="amber">Tool guidance unavailable</Badge>}
        </div>
        <p className="mt-2 text-xs leading-5 text-[#8a7d70]">
          Guidance only. This panel does not say a cut is safe to perform or replace trained butchery judgement.
        </p>
      </div>
    </section>
  );
}
