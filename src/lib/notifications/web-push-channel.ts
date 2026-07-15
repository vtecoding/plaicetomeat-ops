import type { ProviderSendResult } from "../domain/alert-dispatch.ts";
import type { DispatchChannelAdapter } from "../domain/alert-dispatcher-core.ts";
import { CHANNEL_DISABLED } from "../domain/alert-dispatcher-core.ts";
import { OwnerAlertProviderError } from "../domain/owner-alert-channel.ts";
import { validatePushPayload } from "./payload-schema.ts";

export type WebPushConfig = { publicKey: string; privateKey: string; subject: string };
export type PlainWebPushSubscription = { endpoint: string; keys: { auth: string; p256dh: string } };
export type WebPushResponse = { statusCode?: number; headers?: Record<string, string | string[] | undefined> };
export type WebPushSender = (subscription: PlainWebPushSubscription, payload: string) => Promise<WebPushResponse>;

export function resolveWebPushConfig(env: Record<string, string | undefined>): WebPushConfig {
  return {
    publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "",
    privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "",
    subject: env.WEB_PUSH_SUBJECT?.trim() ?? "",
  };
}
export function webPushConfigured(config: WebPushConfig): boolean {
  return Boolean(config.publicKey && config.privateKey && /^(mailto:|https:\/\/)/.test(config.subject));
}

export function classifyWebPushError(error: unknown): OwnerAlertProviderError {
  const status = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : null;
  if (status === 404 || status === 410) {
    return new OwnerAlertProviderError("Web Push subscription is no longer valid.", "rejected_permanent", "PUSH_SUBSCRIPTION_INVALID", true);
  }
  if (status === 401 || status === 403) {
    return new OwnerAlertProviderError("Web Push authentication is not configured correctly.", "rejected_permanent", CHANNEL_DISABLED, false);
  }
  if (status === 429) return new OwnerAlertProviderError("Web Push provider rate limited the request.", "failed_transient", "PUSH_RATE_LIMITED", false);
  if (status != null && status >= 500) return new OwnerAlertProviderError("Web Push provider failed after the request began.", "ambiguous", `PUSH_PROVIDER_${status}`, false);
  if (status != null && status >= 400) return new OwnerAlertProviderError("Web Push subscription was rejected.", "rejected_permanent", "PUSH_SUBSCRIPTION_INVALID", true);
  return new OwnerAlertProviderError("Web Push transport failed after the request began.", "ambiguous", "PUSH_TRANSPORT_FAILED", false);
}

export function createWebPushChannelAdapter(input: {
  config: WebPushConfig;
  loadSubscription: (deviceId: string) => Promise<PlainWebPushSubscription>;
  sendNotification: WebPushSender;
}): DispatchChannelAdapter {
  return {
    channel: "web_push",
    isConfigured: (row) => webPushConfigured(input.config) && Boolean(row.device_id),
    send: async (row): Promise<ProviderSendResult> => {
      if (!row.device_id) throw new OwnerAlertProviderError("Web Push dispatch has no device.", "rejected_permanent", "PUSH_SUBSCRIPTION_INVALID", true);
      let subscription: PlainWebPushSubscription;
      try {
        subscription = await input.loadSubscription(row.device_id);
        if (!subscription.endpoint.startsWith("https://") || !subscription.keys.auth || !subscription.keys.p256dh) {
          throw new Error("malformed");
        }
      } catch {
        throw new OwnerAlertProviderError("Stored Web Push subscription is invalid.", "rejected_permanent", "PUSH_SUBSCRIPTION_INVALID", true);
      }
      const payload = JSON.stringify(validatePushPayload(row.payload));
      try {
        const result = await input.sendNotification(subscription, payload);
        return { providerMessageId: null, providerStatusCode: result.statusCode ? String(result.statusCode) : "201" };
      } catch (error) {
        throw classifyWebPushError(error);
      }
    },
  };
}
