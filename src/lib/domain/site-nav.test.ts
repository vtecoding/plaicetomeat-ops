import { describe, expect, it } from "vitest";

import { MANAGER_LINKS, PUBLIC_LINKS, resolveNav, STAFF_LINKS } from "./site-nav";

const PUBLIC_HREFS = PUBLIC_LINKS.map((link) => link.href);

describe("resolveNav", () => {
  it("shows the storefront as the main nav to visitors (no role)", () => {
    const nav = resolveNav(null);
    expect(nav.primary).toEqual(PUBLIC_LINKS);
    expect(nav.shopView).toBeNull();
  });

  it("does not mix customer links into the operator nav for staff", () => {
    const nav = resolveNav("staff");
    const hrefs = nav.primary.map((link) => link.href);
    // Operator tools only — Shop / Halal Promise / Basket must not appear inline.
    for (const customerHref of PUBLIC_HREFS) {
      expect(hrefs).not.toContain(customerHref);
    }
    expect(hrefs).toEqual(STAFF_LINKS.map((link) => link.href));
  });

  it("keeps the storefront reachable via a single, separated 'Shop view' entry", () => {
    const nav = resolveNav("staff");
    expect(nav.shopView).not.toBeNull();
    expect(nav.shopView?.href).toBe("/shop");
  });

  it("adds manager destinations but still no customer links for managers/owners", () => {
    for (const role of ["manager", "owner"] as const) {
      const nav = resolveNav(role);
      const hrefs = nav.primary.map((link) => link.href);
      expect(hrefs).toEqual([...STAFF_LINKS, ...MANAGER_LINKS].map((link) => link.href));
      for (const customerHref of PUBLIC_HREFS) {
        expect(hrefs).not.toContain(customerHref);
      }
      expect(nav.shopView?.href).toBe("/shop");
    }
  });
});
