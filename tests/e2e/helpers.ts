import { expect, type Page } from "@playwright/test";

export const TEST_PASSWORD = "PlaiceTest123!";

export const USERS = {
  owner: "owner@ptm.test",
  manager: "manager@ptm.test",
  staff: "staff@ptm.test",
  staffB: "staff.b@ptm.test",
  inactive: "inactive@ptm.test",
};

/** Log in through the real /login form and wait for the role landing page. */
export async function login(
  page: Page,
  email: string,
  { password = TEST_PASSWORD, expectLanding }: { password?: string; expectLanding?: RegExp } = {},
) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: "Sign in" }).click();

  if (expectLanding) {
    await page.waitForURL(expectLanding);
  }
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
}

/** Assert the public header shows no back-office navigation links. */
export async function expectNoBackOfficeNav(page: Page) {
  await expect(page.getByRole("link", { name: "Counter", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Today", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Compliance", exact: true })).toHaveCount(0);
}
