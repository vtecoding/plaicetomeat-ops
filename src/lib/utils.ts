import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

export function formatDisplayDate(date: string | Date) {
  const resolvedDate = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(resolvedDate);
}

export function formatTimeRange(startTime: string, endTime: string) {
  return `${formatShortTime(startTime)} - ${formatShortTime(endTime)}`;
}

/**
 * Plain-English "time since" for the counter and order screens. Nobody thinks in
 * "3142 min ago" — so minutes only stay minutes for the first 90, then roll up into
 * hours (under 2 days) and finally whole days.
 */
export function formatRelativeTime(from: string | Date, now: Date = new Date()) {
  const fromMs = typeof from === "string" ? new Date(from).getTime() : from.getTime();
  const minutes = Math.max(0, Math.floor((now.getTime() - fromMs) / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 90) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function formatShortTime(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);

  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
