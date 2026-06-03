import { describe, expect, it } from "vitest";
import { deJargon, findForbiddenTerms, FORBIDDEN_TERMS, TRANSLATIONS } from "./language";

describe("language firewall", () => {
  it("translates every forbidden term out of existence", () => {
    for (const term of FORBIDDEN_TERMS) {
      const sentence = `The ${term} is high.`;
      const cleaned = deJargon(sentence);
      expect(findForbiddenTerms(cleaned), `"${term}" should be translated`).toEqual([]);
    }
  });

  it("rewrites the spec's required translations", () => {
    expect(deJargon("yield variance detected")).toContain("less sellable meat than expected");
    expect(deJargon("operational health is good")).toContain("how the shop is doing");
    expect(deJargon("stock coverage is 3 days")).toContain("days until stock runs out");
    expect(deJargon("the margin is thin")).toContain("profit after meat costs");
  });

  it("is idempotent — running twice changes nothing further", () => {
    const once = deJargon("operational health and yield variance and margin compression");
    expect(deJargon(once)).toEqual(once);
  });

  it("does not produce a doubled phrase for 'profit margin'", () => {
    expect(deJargon("a healthy profit margin")).toBe("a healthy profit");
  });

  it("leaves plain butcher English untouched", () => {
    const plain = "Beef mince is running low — order more this week.";
    expect(deJargon(plain)).toBe(plain);
  });

  it("keeps FORBIDDEN_TERMS covered by a translation rule", () => {
    for (const term of FORBIDDEN_TERMS) {
      const matched = TRANSLATIONS.some(([pattern]) => {
        pattern.lastIndex = 0;
        return pattern.test(term);
      });
      expect(matched, `"${term}" needs a translation rule`).toBe(true);
    }
  });
});
