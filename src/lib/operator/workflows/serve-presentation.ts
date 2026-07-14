import type { UnitType } from "@/lib/domain/types";

export function roundServeMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatServeMoney(value: number) {
  return `£${roundServeMoney(value).toFixed(2)}`;
}

export function expectedServeLineTotal(quantity: number, pricePerUnit: number) {
  return roundServeMoney(quantity * pricePerUnit);
}

export function formatServePresetLabel(label: string, quantity: number, pricePerUnit: number | null) {
  return pricePerUnit == null
    ? label
    : `${label} — ≈ ${formatServeMoney(expectedServeLineTotal(quantity, pricePerUnit))}`;
}

export function formatServeLineName(name: string, quantity: number, unit: UnitType, weightLabel?: string) {
  return unit === "kg" ? `${name} ${weightLabel ?? `${quantity}kg`}` : `${name} ×${quantity}`;
}

export function savedServeTotalMessage(displayedTotal: number, savedTotal: number) {
  const prefix = Math.round(displayedTotal * 100) === Math.round(savedTotal * 100) ? "Saved." : "Price updated.";
  return `${prefix} Total ${formatServeMoney(savedTotal)}.`;
}
