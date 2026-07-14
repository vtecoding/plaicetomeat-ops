"use server";

import { revalidatePath } from "next/cache";

import { isUuid, simpleText } from "@/app/actions/operator/escalation";
import { formatServeMoney } from "@/lib/operator/workflows/serve-presentation";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type PayKind = "cash" | "card";

type ServeLineInput = {
  productId?: string | null;
  name?: string | null;
  quantity?: number;
  // Kept as a compatibility alias for an in-flight V17 browser session.
  quantityKg?: number;
  priceGbp?: number | null;
};

export type ServeSaleResult =
  | { ok: true; message: string; id: string; totalGbp: number; needsOwner?: boolean }
  | { ok: false; message: string };

type OrderRow = {
  id: string;
  order_ref: string;
  status: "incoming" | "prepping" | "ready" | "collected" | "cancelled";
  subtotal: string | number;
};

type AtomicServeReceipt = {
  outcome?: "owner_review";
  message?: string;
  order_id: string;
  order_ref: string;
  status: OrderRow["status"];
  subtotal: string | number;
  needs_check: boolean;
  replayed: boolean;
};

async function requireOperator() {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true as const } : ctx;
}

function cleanPay(value: string): PayKind | null {
  return value === "cash" || value === "card" ? value : null;
}

function cleanLines(lines: ServeLineInput[]) {
  return lines
    .map((line) => ({
      productId: isUuid(line.productId) ? line.productId! : null,
      name: simpleText(line.name, 80),
      quantity: Number(line.quantity ?? line.quantityKg),
      priceGbp: line.priceGbp == null ? null : Number(line.priceGbp),
    }));
}

function toPence(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round((value + Number.EPSILON) * 100)
    : null;
}

function serveFailureMessage(raw: string | undefined) {
  const message = raw?.toLowerCase() ?? "";
  if (message.includes("different details")) {
    return "This sale was already saved with different details. Do not enter it again.";
  }
  if (message.includes("start fresh") || message.includes("replaced")) {
    return "This sale was replaced. Use the current sale.";
  }
  const safe = [
    "not available",
    "whole number",
    "weight",
    "quantity",
    "price",
    "sale line",
    "cash or card",
  ];
  return raw && safe.some((part) => message.includes(part)) ? `${raw.replace(/\.$/, "")}.` : "Try again.";
}

function successfulSale(order: OrderRow, message = "Saved.", needsOwner = false): ServeSaleResult {
  const totalGbp = Math.round(Number(order.subtotal) * 100) / 100;
  return {
    ok: true,
    message: `${message} Total ${formatServeMoney(totalGbp)}.`,
    id: order.id,
    totalGbp,
    needsOwner: needsOwner || undefined,
  };
}

export async function saveSimpleSale(input: {
  runId: string;
  lines: ServeLineInput[];
  payKind: PayKind;
}): Promise<ServeSaleResult> {
  const auth = await requireOperator();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };
  if (!isUuid(input.runId)) return { ok: false, message: "Go back and try again." };

  const payKind = cleanPay(input.payKind);
  if (!payKind) return { ok: false, message: "How did they pay?" };

  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 12) {
    return { ok: false, message: "Choose between 1 and 12 sale lines." };
  }
  const lines = cleanLines(input.lines);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_operator_serve_order_v18", {
    p_run_id: input.runId,
    p_lines: lines.map((line) => ({
      product_id: line.productId,
      name: line.name,
      quantity: line.quantity,
      custom_total_pence: line.productId ? null : toPence(line.priceGbp),
    })),
    p_payment_method: payKind,
  });
  if (error) return { ok: false, message: serveFailureMessage(error.message) };

  const receipt = data as AtomicServeReceipt | null;
  if (receipt?.outcome === "owner_review") {
    return { ok: false, message: receipt.message ?? "This sale needs owner review. Do not enter it again." };
  }
  if (
    !receipt ||
    !isUuid(receipt.order_id) ||
    !receipt.order_ref ||
    receipt.status !== "collected" ||
    !Number.isFinite(Number(receipt.subtotal))
  ) {
    return { ok: false, message: "Try again." };
  }

  const order: OrderRow = {
    id: receipt.order_id,
    order_ref: receipt.order_ref,
    status: receipt.status,
    subtotal: receipt.subtotal,
  };
  const needsCheck = receipt.needs_check === true;

  revalidatePath("/operator");
  revalidatePath("/operator/serve");
  revalidatePath("/counter");
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/purchasing");

  return successfulSale(
    order,
    needsCheck ? "Saved. Owner will check it." : "Saved.",
    needsCheck,
  );
}
