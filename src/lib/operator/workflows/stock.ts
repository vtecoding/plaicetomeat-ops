export const STORAGE_CHOICES = [
  { id: "fridge", label: "Fridge" },
  { id: "freezer", label: "Freezer" },
  { id: "counter", label: "Counter" },
  { id: "back_store", label: "Back store" },
  { id: "not_sure", label: "Not sure" },
] as const;

export const EXPIRY_CHOICES = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "two_days", label: "In 2 days" },
  { id: "not_sure", label: "Not sure" },
] as const;

export type StorageChoice = (typeof STORAGE_CHOICES)[number]["id"];
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]["id"];

export function storageLabel(id: StorageChoice | null | undefined) {
  return STORAGE_CHOICES.find((choice) => choice.id === id)?.label ?? "Not sure";
}

/** Reverse of storageLabel: map a stored location label back to a choice id (for defaults). */
export function storageChoiceFromLabel(label: string | null | undefined): StorageChoice | null {
  if (!label) return null;
  const match = STORAGE_CHOICES.find((choice) => choice.label.toLowerCase() === label.trim().toLowerCase());
  return match ? match.id : null;
}

export function expiryLabel(id: ExpiryChoice | null | undefined) {
  return EXPIRY_CHOICES.find((choice) => choice.id === id)?.label ?? "Not sure";
}

export function expiryDateFromChoice(choice: ExpiryChoice, now = new Date()) {
  const days = choice === "tomorrow" ? 1 : choice === "two_days" ? 2 : 0;
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return date.toISOString().slice(0, 10);
}

export function deliveryNeedsOwnerCheck(input: {
  supplierKnown: boolean;
  expiryChoice: ExpiryChoice;
  storageChoice: StorageChoice;
  photoProvided: boolean;
}) {
  return !input.supplierKnown || input.expiryChoice === "not_sure" || input.storageChoice === "not_sure" || !input.photoProvided;
}
