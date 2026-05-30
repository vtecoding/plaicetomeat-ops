import type { PickupWindow } from "./types";

export type PickupWindowValidationInput = {
  pickupWindow: PickupWindow;
  pickupDate: string;
  now?: Date;
};

export type PickupWindowValidationResult = {
  valid: boolean;
  reason?: string;
};

export function getDayOfWeek(pickupDate: string) {
  const [year, month, day] = pickupDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function timeToMinutes(time: string) {
  const parts = time.split(":");
  const hours = Number(parts[0] ?? "0");
  const minutes = Number(parts[1] ?? "0");

  return hours * 60 + minutes;
}

export function isBeforeCutoff(currentTime: string, cutoffTime: string) {
  return timeToMinutes(currentTime) < timeToMinutes(cutoffTime);
}

export function isSameCalendarDate(date: Date, pickupDate: string) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}` === pickupDate;
}

export function getCurrentTimeString(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function validatePickupWindowForDate({
  pickupWindow,
  pickupDate,
  now = new Date(),
}: PickupWindowValidationInput): PickupWindowValidationResult {
  if (!pickupWindow.isActive) {
    return { valid: false, reason: "Pickup window is not active." };
  }

  const dayOfWeek = getDayOfWeek(pickupDate);

  if (!pickupWindow.daysOfWeek.includes(dayOfWeek)) {
    return { valid: false, reason: "Pickup window is not available on that day." };
  }

  if (pickupWindow.cutoffTime && isSameCalendarDate(now, pickupDate)) {
    const currentTime = getCurrentTimeString(now);

    if (!isBeforeCutoff(currentTime, pickupWindow.cutoffTime)) {
      return { valid: false, reason: "Pickup cutoff has passed for this window." };
    }
  }

  return { valid: true };
}

export function findTodayCommuterWindow(windows: PickupWindow[], now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const dayOfWeek = getDayOfWeek(today);

  return windows
    .filter(
      (window) =>
        window.windowType === "commuter" &&
        window.isActive &&
        window.daysOfWeek.includes(dayOfWeek),
    )
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0];
}
