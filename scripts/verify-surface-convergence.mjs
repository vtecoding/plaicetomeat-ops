// V16 · Surface Convergence — Stream A lock.
//
// Static guard (no app, no browser) that keeps the secondary admin surfaces inside the one
// craft-butcher visual language the V16 compression pass established, so the long tail can't
// quietly drift back to the old dense, system-font look. "If a page deviates, fail review."
//
// Scope: the server-rendered ADMIN ROUTE PAGES (`src/app/admin/**/page.tsx`) — the headers the
// compression pass actually swept. It does NOT yet claim to cover the client components those
// pages mount (admin-*-client.tsx); those are tracked as remaining debt in docs/v16.
//
// Rules:
//   A. No `font-black` in any admin page — that weight is the tell of the old "AI" system-font
//      header. The whole sweep replaced it with font-semibold/bold. No exceptions.
//   B. Any page that hand-rolls a title (`<h1>`) must build it with the shared <Masthead>, so
//      every page reads the same. Pages that delegate their UI to a client component (the common
//      wrapper pattern) have no inline <h1> and pass freely. Two genuinely bespoke editorial
//      surfaces are allow-listed with a reason.
//
// Usage: node scripts/verify-surface-convergence.mjs   (no app required)

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const ADMIN_DIR = resolve(process.cwd(), "src", "app", "admin");
const OUT_DIR = resolve(process.cwd(), "docs", "v16");
mkdirSync(OUT_DIR, { recursive: true });

// Bespoke editorial surfaces that intentionally do not use the shared <Masthead>:
//  - today/page.tsx  — the TODAY home, a fully bespoke editorial masthead (the product's face).
//  - today/walk/page.tsx — the focused guided-walk surface, its own minimal header.
const BESPOKE = new Set(["today/page.tsx", "today/walk/page.tsx"]);

const failures = [];
const observations = [];
function record(ok, name, detail) {
  observations.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push({ name, detail });
}

function adminPages() {
  return readdirSync(ADMIN_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((rel) => rel.endsWith(`page.tsx`))
    .map((rel) => ({ key: rel.split(sep).join("/"), abs: join(ADMIN_DIR, rel) }));
}

function main() {
  const pages = adminPages();
  let masthead = 0;
  let delegated = 0;
  let bespoke = 0;

  for (const { key, abs } of pages) {
    const src = readFileSync(abs, "utf8");

    // Rule A — no system-font weight anywhere in an admin page.
    record(!/font-black/.test(src), `no legacy font-black — ${key}`, /font-black/.test(src) ? "found font-black" : "clean");

    // Rule B — an inline <h1> must come from <Masthead> (unless a bespoke surface).
    const hasInlineH1 = /<h1[\s>]/.test(src);
    const usesMasthead = /\bMasthead\b/.test(src);
    if (BESPOKE.has(key)) {
      bespoke += 1;
      continue;
    }
    if (usesMasthead) masthead += 1;
    else if (!hasInlineH1) delegated += 1;

    if (hasInlineH1 && !usesMasthead) {
      record(false, `title uses the shared Masthead — ${key}`, "hand-rolled <h1> without <Masthead>");
    }
  }

  console.log(
    `\nScanned ${pages.length} admin page(s): ${masthead} on Masthead, ${delegated} delegate to a client component, ${bespoke} bespoke (allow-listed).`,
  );

  const lines = [
    "# V16 · Surface Convergence — Stream A Lock",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Static guard over `src/app/admin/**/page.tsx`. Keeps the secondary admin surfaces inside the",
    "one craft-butcher visual language the V16 compression pass established — no return to the old",
    "dense, system-font headers.",
    "",
    `- Pages scanned: **${pages.length}**`,
    `- On the shared \`<Masthead>\`: **${masthead}**`,
    `- Delegate their UI (and header) to a client component: **${delegated}**`,
    `- Bespoke editorial surfaces (allow-listed): **${bespoke}** — \`today/page.tsx\`, \`today/walk/page.tsx\``,
    "",
    "## Rules enforced",
    "- **A.** No `font-black` in any admin page (the system-font tell).",
    "- **B.** A hand-rolled `<h1>` must be built with the shared `<Masthead>`.",
    "",
    "## Out of scope (tracked debt)",
    "The client components these pages mount (`admin-*-client.tsx`) are not yet swept and are not",
    "checked here. Converging them is the remaining Stream A work.",
    "",
    "## Result",
    failures.length === 0 ? "All admin route pages converged. PASS." : `${failures.length} deviation(s). FAIL.`,
    "",
  ];
  for (const f of failures) lines.push(`- FAIL: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  writeFileSync(resolve(OUT_DIR, "Surface-Convergence.md"), lines.join("\n"), "utf8");

  console.log(failures.length === 0 ? "\nSurface-convergence guard PASSED" : `\nSurface-convergence guard FAILED (${failures.length})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
