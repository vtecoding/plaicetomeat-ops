import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

describe("'Walk me through it' CTA contrast", () => {
  it("scopes base element resets under @layer base so utilities win (root cause)", () => {
    const css = read("src/app/globals.css");
    const layerIndex = css.indexOf("@layer base");
    expect(layerIndex).toBeGreaterThan(-1);
    // The `a { color: inherit }` reset must sit *inside* the base layer — otherwise it
    // overrides utility text colours and the green-on-white CTA renders white-on-white.
    expect(css.indexOf("color: inherit")).toBeGreaterThan(layerIndex);
  });

  it("renders the walk CTA as visible green text on white, not white-on-white", () => {
    const page = read("src/app/admin/today/page.tsx");
    // Isolate the opening tag of the CTA: from the <Link that owns `walk-start` up to its `>`.
    const marker = page.indexOf("walk-start");
    expect(marker).toBeGreaterThan(-1);
    const opening = page.slice(page.lastIndexOf("<Link", marker), page.indexOf(">", marker) + 1);
    expect(opening).toContain("bg-white");
    expect(opening).toContain("text-[#0f5132]");
    expect(opening).not.toContain("text-white");
  });
});
