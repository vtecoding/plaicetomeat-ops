"use server";

import { revalidatePath } from "next/cache";

import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminScheduleResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string };

const SAFE_MESSAGE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Window label is required",
  "Start time must be before end time",
  "Capacity must be",
  "Select at least one day",
  "Days of week must be",
  "Window type is invalid",
  "Pickup window conflicts with an existing window",
  "Closure date is required",
  "Pickup window not found",
  "Closure not found",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_MESSAGE_PATTERNS.some((p) => raw.includes(p))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireManager(): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveStaffContext("manager");
  return ctx.ok ? { ok: true } : { ok: false, message: ctx.message };
}

function revalidateSchedule() {
  revalidatePath("/admin/pickup-windows");
  revalidatePath("/admin/shop-closures");
  revalidatePath("/checkout");
}

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}

function sharesDay(a: number[], b: number[]) {
  return a.some((day) => b.includes(day));
}

export async function createPickupWindow(input: {
  branchId: string;
  label: string;
  startTime: string;
  endTime: string;
  cutoffTime?: string | null;
  maxOrders?: number | null;
  daysOfWeek: number[];
  windowType?: string;
}): Promise<AdminScheduleResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (input.startTime >= input.endTime) {
    return { ok: false, message: "Start time must be before end time." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existingWindows } = await supabase
    .from("pickup_windows")
    .select("start_time, end_time, days_of_week, is_active")
    .eq("branch_id", input.branchId)
    .eq("is_active", true);

  const hasConflict = (existingWindows ?? []).some((window) => {
    const start = String(window.start_time).slice(0, 5);
    const end = String(window.end_time).slice(0, 5);
    const days = Array.isArray(window.days_of_week) ? (window.days_of_week as number[]) : [];
    return sharesDay(input.daysOfWeek, days) && timesOverlap(input.startTime, input.endTime, start, end);
  });

  if (hasConflict) {
    return { ok: false, message: "Pickup window conflicts with an existing window." };
  }

  const { data, error } = await supabase.rpc("admin_create_pickup_window", {
    p_branch_id: input.branchId,
    p_label: input.label,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_cutoff_time: input.cutoffTime || null,
    p_max_orders: input.maxOrders ?? null,
    p_days_of_week: input.daysOfWeek,
    p_window_type: input.windowType ?? "standard",
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not create the window. Please try again.") };
  }

  revalidateSchedule();
  return { ok: true, message: "Pickup window created.", id: String(data) };
}

export async function updatePickupWindow(input: {
  windowId: string;
  label: string;
  startTime: string;
  endTime: string;
  cutoffTime?: string | null;
  maxOrders?: number | null;
  daysOfWeek?: number[] | null;
  windowType?: string | null;
}): Promise<AdminScheduleResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (input.startTime >= input.endTime) {
    return { ok: false, message: "Start time must be before end time." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: currentWindow } = await supabase
    .from("pickup_windows")
    .select("branch_id")
    .eq("id", input.windowId)
    .maybeSingle();

  if (currentWindow?.branch_id && input.daysOfWeek) {
    const { data: existingWindows } = await supabase
      .from("pickup_windows")
      .select("id, start_time, end_time, days_of_week, is_active")
      .eq("branch_id", currentWindow.branch_id)
      .eq("is_active", true);

    const hasConflict = (existingWindows ?? []).some((window) => {
      if (window.id === input.windowId) return false;
      const start = String(window.start_time).slice(0, 5);
      const end = String(window.end_time).slice(0, 5);
      const days = Array.isArray(window.days_of_week) ? (window.days_of_week as number[]) : [];
      return sharesDay(input.daysOfWeek ?? [], days) && timesOverlap(input.startTime, input.endTime, start, end);
    });

    if (hasConflict) {
      return { ok: false, message: "Pickup window conflicts with an existing window." };
    }
  }

  const { error } = await supabase.rpc("admin_update_pickup_window", {
    p_window_id: input.windowId,
    p_label: input.label,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_cutoff_time: input.cutoffTime || null,
    p_max_orders: input.maxOrders ?? null,
    p_days_of_week: input.daysOfWeek ?? null,
    p_window_type: input.windowType ?? null,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not save the window. Please try again.") };
  }

  revalidateSchedule();
  return { ok: true, message: "Pickup window updated." };
}

export async function setPickupWindowActive(input: {
  windowId: string;
  isActive: boolean;
}): Promise<AdminScheduleResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_pickup_window_active", {
    p_window_id: input.windowId,
    p_is_active: input.isActive,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not update the window. Please try again.") };
  }

  revalidateSchedule();
  return { ok: true, message: input.isActive ? "Pickup window enabled." : "Pickup window disabled." };
}

export async function createShopClosure(input: {
  branchId: string;
  closeDate: string;
  reason?: string | null;
}): Promise<AdminScheduleResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.closeDate)) {
    return { ok: false, message: "Closure date is required." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_create_shop_closure", {
    p_branch_id: input.branchId,
    p_close_date: input.closeDate,
    p_reason: input.reason ?? null,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not add the closure. Please try again.") };
  }

  revalidateSchedule();
  return { ok: true, message: "Closure added.", id: String(data) };
}

export async function removeShopClosure(input: { closureId: string }): Promise<AdminScheduleResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_remove_shop_closure", {
    p_closure_id: input.closureId,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "Could not remove the closure. Please try again.") };
  }

  revalidateSchedule();
  return { ok: true, message: "Closure removed." };
}
