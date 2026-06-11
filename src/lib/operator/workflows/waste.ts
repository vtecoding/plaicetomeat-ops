export const WASTE_REASON_CHOICES = [
  { id: "expired", label: "Expired" },
  { id: "damaged", label: "Damaged" },
  { id: "customer_return", label: "Customer changed mind" },
  { id: "other", label: "Mistake" },
  { id: "review", label: "Other / not sure" },
] as const;

export type WasteReasonChoice = (typeof WASTE_REASON_CHOICES)[number]["id"];

export function wasteReasonLabel(id: WasteReasonChoice | null | undefined) {
  return WASTE_REASON_CHOICES.find((choice) => choice.id === id)?.label ?? "Other / not sure";
}
