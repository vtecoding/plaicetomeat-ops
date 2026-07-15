"use client";

import { useEffect } from "react";

export function NotificationOpenRecorder() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const dispatchId = url.searchParams.get("notification");
    if (!dispatchId || !/^[0-9a-f-]{36}$/i.test(dispatchId)) return;
    url.searchParams.delete("notification");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    fetch(`/api/owner/notifications/${encodeURIComponent(dispatchId)}/opened`, { method: "POST" })
      .catch(() => undefined); // Evidence failure is observable server-side but never blocks opening PTM.
  }, []);
  return null;
}
