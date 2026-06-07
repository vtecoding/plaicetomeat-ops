// V12.8 Observability — vendor-neutral alert dispatch.
//
// Edge-safe. An alert always goes to the structured log (console sink, which
// already redacts secrets). When ALERT_WEBHOOK_URL is configured, a minimal,
// redacted JSON payload is POSTed to it. A Sentry sink is intentionally stubbed
// for a future phase — no production provider is required yet, and nothing here
// throws (a failed alert must never break the caller).

import { log, type LogCategory } from "./log";

export type AlertSeverity = "warning" | "critical";

export type Alert = {
  title: string;
  severity: AlertSeverity;
  category: LogCategory;
  message: string;
  /** Safe, non-PII context. Logged (redacted); NOT sent to the webhook. */
  context?: Record<string, unknown>;
};

export async function dispatchAlert(alert: Alert): Promise<void> {
  // Console sink (always on). The structured logger redacts secret-like fields.
  log(alert.category, alert.severity === "critical" ? "error" : "warn", `ALERT ${alert.title}: ${alert.message}`, {
    alert: true,
    alertSeverity: alert.severity,
    ...(alert.context ?? {}),
  });

  await sendWebhook(alert);

  // Future: Sentry sink. Intentionally not wired in this phase — provider
  // selection is deferred (see docs/v12.8-discovery-report.md).
}

async function sendWebhook(alert: Alert): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    return;
  }
  try {
    // Deliberately omit `context` from the wire payload: keep the external
    // surface minimal and free of anything beyond the alert taxonomy.
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: alert.title,
        severity: alert.severity,
        category: alert.category,
        message: alert.message,
      }),
    });
  } catch (error) {
    log("SYSTEM", "error", "alert webhook dispatch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
