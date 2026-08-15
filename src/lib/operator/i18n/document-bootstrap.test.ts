import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { OPERATOR_DOCUMENT_LANGUAGE_BOOTSTRAP } from "./document-bootstrap";

function runBootstrap(pathname: string, cookie: string) {
  const attributes = new Map<string, string>();
  const documentElement = {
    lang: "en",
    dir: "ltr",
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
  };

  vm.runInNewContext(OPERATOR_DOCUMENT_LANGUAGE_BOOTSTRAP, {
    decodeURIComponent,
    document: { cookie, documentElement },
    window: { location: { pathname } },
  });

  return { attributes, documentElement };
}

describe("operator document language bootstrap", () => {
  it.each(["/login", "/operator", "/operator/serve"])(
    "declares Pashto before hydration on %s",
    (pathname) => {
      const result = runBootstrap(pathname, "theme=light; ptm_operator_locale=ps-AF");

      expect(result.documentElement.lang).toBe("ps-AF");
      expect(result.documentElement.dir).toBe("rtl");
      expect(result.attributes.get("translate")).toBe("yes");
    },
  );

  it("restores English metadata when English is selected", () => {
    const result = runBootstrap("/operator", "ptm_operator_locale=en");

    expect(result.documentElement.lang).toBe("en");
    expect(result.documentElement.dir).toBe("ltr");
    expect(result.attributes.get("translate")).toBe("yes");
  });

  it("does not relabel public or admin pages", () => {
    for (const pathname of ["/", "/shop", "/admin"]) {
      const result = runBootstrap(pathname, "ptm_operator_locale=ps-AF");
      expect(result.documentElement.lang).toBe("en");
      expect(result.documentElement.dir).toBe("ltr");
      expect(result.attributes.has("translate")).toBe(false);
    }
  });

  it("fails safely when the locale cookie is malformed", () => {
    const escape = String.fromCharCode(37);
    const malformedCookie = `ptm_operator_locale=${escape}E0${escape}A4${escape}A`;
    const result = runBootstrap("/operator", malformedCookie);

    expect(result.documentElement.lang).toBe("en");
    expect(result.documentElement.dir).toBe("ltr");
    expect(result.attributes.get("translate")).toBe("yes");
  });
});
