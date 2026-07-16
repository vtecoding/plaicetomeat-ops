"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

import { notificationOpenDispatchId } from "@/lib/notifications/open-evidence";

export function NotificationOpenRecorder() {
  const searchParams = useSearchParams();
  const lastAttempted = useRef<string | null>(null);

  useEffect(() => {
    const dispatchId = notificationOpenDispatchId(searchParams.toString());
    if (!dispatchId || lastAttempted.current === dispatchId) return;
    lastAttempted.current = dispatchId;

    const url = new URL(window.location.href);
    url.searchParams.delete("notification");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    fetch(`/api/owner/notifications/${encodeURIComponent(dispatchId)}/opened`, { method: "POST" })
      .catch(() => undefined); // Evidence failure is observable server-side but never blocks opening PTM.
  }, [searchParams]);
  return null;
}
