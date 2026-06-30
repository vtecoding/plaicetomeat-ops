import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Phase 0 / F4 (closes C2): the operator-facing failure surfaces must exist and
// stay operator-safe. A low-literacy operator mid-service must never hit a raw
// Next.js error/404 — every surface needs a clear recovery path and must not
// leak technical detail. Static guard so these files can't silently regress.

const ROOT = process.cwd();

const SURFACES = [
  "src/app/global-error.tsx",
  "src/app/not-found.tsx",
  "src/app/operator/error.tsx",
  "src/app/counter/error.tsx",
  "src/app/admin/error.tsx",
];

describe("operator-friendly failure surfaces", () => {
  for (const file of SURFACES) {
    it(`${file} exists`, () => {
      expect(existsSync(join(ROOT, file)), `${file} must exist`).toBe(true);
    });
  }

  it("operator error screen offers retry + home + tell-owner recovery", () => {
    const src = readFileSync(join(ROOT, "src/app/operator/error.tsx"), "utf8");
    expect(src).toContain("Something went wrong");
    expect(src).toContain("reset()"); // try again
    expect(src).toContain('href="/operator"'); // go home
    expect(src).toContain('href="/operator/help"'); // tell owner
    // no raw error detail surfaced to the operator
    expect(src).not.toContain("error.message");
    expect(src).not.toContain("error.stack");
    expect(src).not.toContain("{error.digest}");
  });

  it("counter error screen offers retry + back to counter", () => {
    const src = readFileSync(join(ROOT, "src/app/counter/error.tsx"), "utf8");
    expect(src).toContain("Something went wrong");
    expect(src).toContain("reset()");
    expect(src).toContain('href="/counter"');
    expect(src).not.toContain("error.message");
    expect(src).not.toContain("error.stack");
  });

  it("global error replaces the document and never shows a stack trace", () => {
    const src = readFileSync(join(ROOT, "src/app/global-error.tsx"), "utf8");
    expect(src).toContain("<html");
    expect(src).toContain("<body");
    expect(src).toContain("Something went wrong");
    expect(src).toContain("reset()");
    expect(src).not.toContain("error.message");
    expect(src).not.toContain("error.stack");
  });

  it("not-found gives a calm recovery path home", () => {
    const src = readFileSync(join(ROOT, "src/app/not-found.tsx"), "utf8");
    expect(src).toContain('href="/operator"');
  });
});
