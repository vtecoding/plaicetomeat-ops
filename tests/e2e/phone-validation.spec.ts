import { expect, test } from "@playwright/test";

// Phase 7: inline client phone validation that mirrors the server rule, without
// relying on the HTML pattern attribute (which was broken in Chromium).
test.describe("checkout phone validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/checkout");
  });

  const invalid = [
    { value: "aaaaaaaaaaa", label: "letters" },
    { value: "0770", label: "too short" },
    { value: "01217001234", label: "UK landline" },
    { value: "   ", label: "whitespace only" },
  ];

  for (const { value, label } of invalid) {
    test(`rejects ${label}`, async ({ page }) => {
      const phone = page.getByLabel("UK mobile number");
      await phone.fill(value);
      await phone.blur();
      await expect(page.getByTestId("phone-error")).toBeVisible();
      // The error is wired to the input for assistive tech.
      await expect(phone).toHaveAttribute("aria-describedby", "customerPhone-error");
      await expect(phone).toHaveAttribute("aria-invalid", "true");
    });
  }

  test("accepts 07700900123 and clears the error", async ({ page }) => {
    const phone = page.getByLabel("UK mobile number");
    await phone.fill("0770");
    await phone.blur();
    await expect(page.getByTestId("phone-error")).toBeVisible();

    await phone.fill("07700900123");
    await expect(page.getByTestId("phone-error")).toHaveCount(0);
    await expect(phone).toHaveAttribute("aria-invalid", "false");
  });

  test("accepts +447700900123", async ({ page }) => {
    const phone = page.getByLabel("UK mobile number");
    await phone.fill("+447700900123");
    await phone.blur();
    await expect(page.getByTestId("phone-error")).toHaveCount(0);
  });
});
