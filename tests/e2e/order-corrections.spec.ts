import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";
import { resetStateBeforeEach } from "./reset-state";

const BRANCH = "00000000-0000-4000-8000-000000000001";

function localEnv() {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
}

test.describe("V18 order corrections", () => {
  resetStateBeforeEach();

  test("catch-weight handover then discarded refund stays one guided journey", async ({ page }) => {
    const env = localEnv();
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const suffix = crypto.randomUUID().slice(0, 8);
    const productId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    const orderRef = `V18-${suffix.toUpperCase()}`;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

    const { error: productError } = await admin.from("products").insert({
      id: productId,
      branch_id: BRANCH,
      name: `V18 catch weight ${suffix}`,
      slug: `v18-catch-${suffix}`,
      unit_type: "kg",
      price_per_unit: 10,
      is_available: true,
      stock_status: "in_stock",
    });
    expect(productError?.message).toBeUndefined();
    const { error: batchError } = await admin.from("inventory_batches").insert({
      id: batchId,
      branch_id: BRANCH,
      product_id: productId,
      received_date: today,
      expiry_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      received_weight_kg: 10,
      remaining_weight_kg: 10,
      cost_per_kg: 5,
    });
    expect(batchError?.message).toBeUndefined();
    const { error: orderError } = await admin.from("orders").insert({
      id: orderId,
      branch_id: BRANCH,
      order_ref: orderRef,
      customer_name: "V18 Journey",
      customer_phone: "+447700900555",
      status: "ready",
      pickup_date: today,
      subtotal: 10,
      idempotency_key: `v18-e2e-${suffix}`,
      is_test: true,
    });
    expect(orderError?.message).toBeUndefined();
    const { error: lineError } = await admin.from("order_items").insert({
      id: lineId,
      branch_id: BRANCH,
      order_id: orderId,
      product_id: productId,
      product_name_snapshot: `V18 catch weight ${suffix}`,
      quantity: 1,
      unit_type: "kg",
      unit_price_snapshot: 10,
      line_total: 10,
    });
    expect(lineError?.message).toBeUndefined();

    await login(page, USERS.manager, { expectLanding: /\/operator/ });
    await page.goto("/counter");
    let card = page.locator("article", { hasText: orderRef });
    await expect(card).toBeVisible();

    await card.getByTestId("order-adjust-start").click();
    await card.getByTestId("amend-actual-weight").fill("1.2");
    await card
      .getByRole("checkbox", { name: "Customer is here and agrees to the new final price" })
      .check();
    await card.getByTestId("amend-save").click();
    await expect(card.getByText("Saved. Final price and stock now use this adjustment.")).toBeVisible();
    await expect(card).toContainText("1.2 kg");

    await card.getByTestId("counter-collect-start").click();
    await card.getByTestId("counter-tender-card").click();
    card = page.locator("article", { hasText: orderRef });
    await expect(card.getByTestId("refund-start")).toBeVisible();

    await card.getByTestId("refund-start").click();
    await card.locator('input[type="checkbox"]').first().check();
    await card.locator("select").last().selectOption("returned_discarded");
    await card.getByRole("button", { name: "Next", exact: true }).click();
    await card.getByPlaceholder(/Customer return/).fill("Returned quality issue");
    await card.getByRole("button", { name: "Review refund" }).click();
    await expect(card.getByText(/to card — the way they paid/)).toBeVisible();
    await card.getByTestId("refund-confirm").click();
    await expect(card.getByTestId("refund-receipt")).toContainText("Refund recorded");

    const [{ data: payment }, { data: depletion }, { data: waste }] = await Promise.all([
      admin.from("payment_events").select("direction,method,amount_pence").eq("order_id", orderId).order("created_at"),
      admin.from("order_inventory_depletions").select("amendment_seq,total_depleted_kg").eq("order_id", orderId).single(),
      admin.from("inventory_waste_events").select("waste_kg").eq("order_item_id", lineId),
    ]);
    expect(payment).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "sale", method: "card", amount_pence: 1200 }),
      expect.objectContaining({ direction: "refund", method: "card", amount_pence: 1200 }),
    ]));
    expect(depletion).toMatchObject({ amendment_seq: 1, total_depleted_kg: 1.2 });
    expect(waste).toEqual([expect.objectContaining({ waste_kg: 1.2 })]);
  });
});
