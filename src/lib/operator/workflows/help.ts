// V17 · Operator "Help / Call owner" workflow definition.
//
// The operator surface for "something is wrong". Pure data + tiny helpers so the
// flow component and the adapter stay thin and the labels stay plain English.
// Fridge/freezer and broken-equipment problems are urgent external interrupts;
// the remaining choices are normal heads-ups.

export const HELP_PROBLEM_CHOICES = [
  { id: "fridge", label: "Fridge or freezer problem", severity: "critical" },
  { id: "ran_out", label: "Ran out of something", severity: "warning" },
  { id: "equipment", label: "A machine is broken", severity: "critical" },
  { id: "unsure", label: "I am not sure what to do", severity: "warning" },
  { id: "mistake", label: "I made a mistake just now", severity: "warning" },
  { id: "other", label: "Something else", severity: "warning" },
] as const;

export type HelpProblemId = (typeof HELP_PROBLEM_CHOICES)[number]["id"];
export type HelpSeverity = (typeof HELP_PROBLEM_CHOICES)[number]["severity"];

export function helpProblemChoice(id: HelpProblemId | string | null | undefined) {
  return HELP_PROBLEM_CHOICES.find((choice) => choice.id === id) ?? HELP_PROBLEM_CHOICES[5];
}

export function helpProblemLabel(id: HelpProblemId | string | null | undefined) {
  return helpProblemChoice(id).label;
}

export function helpProblemSeverity(id: HelpProblemId | string | null | undefined): HelpSeverity {
  return helpProblemChoice(id).severity;
}

export function isHelpOperationId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function helpOperationEntityRef(operationId: string): string {
  return `operator-help:${operationId}`;
}

// Plain-English line the owner reads in their "while you were away" alerts.
export function buildHelpSummary(id: HelpProblemId | string | null | undefined, note?: string | null) {
  const base = `Help from the shop: ${helpProblemLabel(id)}.`;
  const trimmed = note?.trim();
  return trimmed ? `${base} "${trimmed}"` : base;
}
