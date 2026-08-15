import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPERATOR_LOCALE,
  en,
  isOperatorLocale,
  operatorDirection,
  operatorMeasure,
  operatorMoney,
  ps,
  translateOperator,
  translateOperatorError,
  translateOperatorProduct,
} from "./resources";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "..");
const OPERATOR_APP = join(SRC, "app", "operator");
const OPERATOR_TSX = [
  ...collectTsx(OPERATOR_APP),
  join(SRC, "app", "login", "page.tsx"),
  join(SRC, "components", "login-form.tsx"),
  join(SRC, "components", "logout-button.tsx"),
  join(SRC, "components", "password-reset-request.tsx"),
];

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]!).sort();
}

function collectTsx(path: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsx(full));
    else if (extname(full) === ".tsx") out.push(full);
  }
  return out;
}

describe("operator localisation resources", () => {
  it("has exact English and Afghan Pashto key and interpolation parity", () => {
    expect(Object.keys(ps).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(ps[key].trim(), key).not.toBe("");
      expect(placeholders(ps[key]), key).toEqual(placeholders(en[key]));
      const values = Object.fromEntries(placeholders(en[key]).map((name) => [name, "TEST"]));
      expect(translateOperator("en", key, values), key).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      expect(translateOperator("ps-AF", key, values), key).not.toMatch(/\{[A-Za-z0-9_]+\}/);
    }
  });

  it("contains no duplicate source keys", () => {
    const source = readFileSync(join(HERE, "resources.ts"), "utf8");
    const blocks = [
      source.slice(source.indexOf("export const en = {"), source.indexOf("} as const;")),
      source.slice(source.indexOf("export const ps = {"), source.indexOf("} satisfies Record")),
    ];
    for (const block of blocks) {
      const keys = [...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]!);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("fails visibly when interpolation data is missing", () => {
    expect(() => translateOperator("ps-AF", "shell.hello")).toThrow(/Missing operator interpolation/);
  });

  it("defaults to English and applies Pashto RTL", () => {
    expect(DEFAULT_OPERATOR_LOCALE).toBe("en");
    expect(isOperatorLocale("en")).toBe(true);
    expect(isOperatorLocale("ps-AF")).toBe(true);
    expect(isOperatorLocale("ps")).toBe(false);
    expect(operatorDirection("en")).toBe("ltr");
    expect(operatorDirection("ps-AF")).toBe("rtl");
  });

  it("keeps mixed-direction prices and measurements isolated only in RTL", () => {
    expect(operatorMoney(12.5, "en")).toBe("£12.50");
    expect(operatorMoney(12.5, "ps-AF")).toBe("\u2066£12.50\u2069");
    expect(operatorMeasure(1.5, "kg", "ps-AF")).toBe("\u20661.5 kg\u2069");
  });

  it("never exposes an unexpected technical action error", () => {
    const shown = translateOperatorError("ps-AF", "RPC collect_order_with_tender failed: relation missing");
    expect(shown).toBe(ps["error.generic"]);
    expect(shown).not.toMatch(/RPC|collect_order|relation/i);
  });

  it("translates every current catalogue product used by Operator Mode", () => {
    const products = [
      "Chicken Breast Fillets", "Whole Chicken", "Lamb Leg Steaks", "Beef Diced",
      "Lean Lamb Mince", "Ribeye Steak", "Family Curry Pack",
    ];
    for (const name of products) expect(translateOperatorProduct("ps-AF", name), name).not.toBe(name);
  });

  it("contains all critical workflow presentation keys", () => {
    const critical = [
      "home.open", "home.serve", "serve.cash", "serve.card", "stock.deliveryArrived",
      "waste.confirm", "checklist.opening.fridge_temp.label", "help.whatWrong",
      "error.retry", "common.tryAgain", "certificate.take", "till.direction",
    ] as const;
    for (const key of critical) expect(ps[key], key).toBeTruthy();
  });
});

describe("operator raw-literal guard", () => {
  it("has no raw operator-facing JSX copy outside the locale boundary", () => {
    const violations: string[] = [];
    for (const file of OPERATOR_TSX) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/>\s*([A-Za-z][A-Za-z0-9 ,.?!&'’/—-]*)\s*</g)) {
        const text = match[1]!.trim();
        const nativeLanguageLabel = file.endsWith("operator-language.tsx") && text === "English";
        if (text !== "PlaiceToMeat" && !nativeLanguageLabel) violations.push(`${relative(SRC, file)}: ${text}`);
      }
      for (const match of source.matchAll(/(?:title|label|helper|placeholder|aria-label)=\"([A-Za-z][^\"]*)\"/g)) {
        violations.push(`${relative(SRC, file)}: ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps Pashto literals inside the locale layer", () => {
    const violations: string[] = [];
    for (const file of OPERATOR_TSX) {
      if (file.endsWith("operator-language.tsx")) continue; // the language name is its own native label
      const source = readFileSync(file, "utf8");
      if (/[\u0600-\u06ff]/.test(source)) violations.push(relative(SRC, file));
    }
    expect(violations).toEqual([]);
  });
});
