/**
 * V9 — the language firewall.
 *
 * The platform must teach the owner how the *business* works, not how the software
 * works. Every string that reaches the owner passes through `deJargon`, which rewrites
 * known technical phrases into plain butcher English. `FORBIDDEN_TERMS` powers an
 * enforcement test that fails the build if any jargon leaks onto the Owner Brain.
 */

/**
 * Technical phrases that must never appear on the Owner Brain, paired with their plain
 * replacement. Order matters: longer / more specific phrases first so they win before a
 * shorter substring (e.g. "yield variance" before "yield").
 */
export const TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\byield variance\b/gi, "less sellable meat than expected"],
  [/\bforecast degradation\b/gi, "less reliable predictions"],
  [/\bmargin compression\b/gi, "shrinking profit"],
  [/\binventory discrepancy\b/gi, "stock count that doesn't match"],
  [/\binventory adjustment\b/gi, "stock count correction"],
  [/\boperational health\b/gi, "how the shop is doing"],
  [/\bpurchasing discipline\b/gi, "buying decisions"],
  [/\bcoverage ratio\b/gi, "days until stock runs out"],
  [/\bstock coverage\b/gi, "days until stock runs out"],
  [/\bdata quality score\b/gi, "how much information we have"],
  [/\bdata confidence\b/gi, "based on limited information"],
  [/\bconfidence score\b/gi, "how sure we are"],
  [/\bdepletion forecast\b/gi, "when stock will run out"],
  [/\bgross margin percentage\b/gi, "profit after meat costs"],
  [/\bgross margin\b/gi, "profit after meat costs"],
  [/\bgross profit\b/gi, "profit after meat costs"],
  [/\bprofit margin\b/gi, "profit"],
  [/\bmargin\b/gi, "profit after meat costs"],
  [/\byield\b/gi, "sellable meat"],
];

/**
 * Phrases that must not survive `deJargon`. The enforcement test scans rendered Owner
 * Brain text against these. Kept in sync with `TRANSLATIONS` (every forbidden term has a
 * translation above).
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  "yield variance",
  "inventory discrepancy",
  "inventory adjustment",
  "operational health",
  "purchasing discipline",
  "coverage ratio",
  "stock coverage",
  "confidence score",
  "data quality score",
  "data confidence",
  "margin compression",
  "forecast degradation",
  "depletion forecast",
  "gross margin",
  "gross profit",
];

/** Rewrite known technical phrases into plain English. Idempotent. */
export function deJargon(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TRANSLATIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Return any forbidden terms found in a piece of text (case-insensitive). Empty when
 * clean. Used by the enforcement test to prove no jargon reaches the owner.
 */
export function findForbiddenTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_TERMS.filter((term) => lower.includes(term));
}
