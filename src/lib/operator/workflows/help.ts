// V17 · Operator "Help / Call owner" workflow definition.
//
// The operator surface for "something is wrong". Pure data + tiny helpers so the
// flow component and the adapter stay thin and the labels stay plain English.
// A fridge/freezer problem is treated as urgent (the owner is told straight away,
// even when present); everything else is a normal heads-up.

export const HELP_PROBLEM_CHOICES = [
  { id: "fridge", label: "Fridge or freezer problem", severity: "critical" },
  { id: "ran_out", label: "Ran out of something", severity: "warning" },
  { id: "equipment", label: "A machine is broken", severity: "warning" },
  { id: "unsure", label: "I am not sure what to do", severity: "warning" },
  { id: "other", label: "Something else", severity: "warning" },
] as const;

export type HelpProblemId = (typeof HELP_PROBLEM_CHOICES)[number]["id"];
export type HelpSeverity = (typeof HELP_PROBLEM_CHOICES)[number]["severity"];

export function helpProblemChoice(id: HelpProblemId | string | null | undefined) {
  return HELP_PROBLEM_CHOICES.find((choice) => choice.id === id) ?? HELP_PROBLEM_CHOICES[4];
}

export function helpProblemLabel(id: HelpProblemId | string | null | undefined) {
  return helpProblemChoice(id).label;
}

export function helpProblemSeverity(id: HelpProblemId | string | null | undefined): HelpSeverity {
  return helpProblemChoice(id).severity;
}

// Plain-English line the owner reads in their "while you were away" alerts.
export function buildHelpSummary(id: HelpProblemId | string | null | undefined, note?: string | null) {
  const base = `Help from the shop: ${helpProblemLabel(id)}.`;
  const trimmed = note?.trim();
  return trimmed ? `${base} "${trimmed}"` : base;
}
