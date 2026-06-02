import { expect, test } from "@playwright/test";

test.describe("password reset", () => {
  test("login page offers a forgot-password flow", async ({ page }) => {
    await page.goto("/login");
    const forgot = page.getByRole("button", { name: "Forgot your password?" });
    await expect(forgot).toBeVisible();
    await forgot.click();
    await expect(page.getByLabel("Email for the reset link")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  });

  test("update-password page asks for a valid link when opened without a token", async ({ page }) => {
    await page.goto("/auth/update-password");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(
      page.getByText("Open the link from your password-reset email to set a new password."),
    ).toBeVisible();
  });
});
