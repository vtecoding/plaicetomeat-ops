import { NextResponse } from "next/server";
import { ownerNotificationRpc } from "@/lib/server/notification-devices";
export async function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await context.params; const body = await request.json().catch(() => ({}));
  const action = body.action;
  const result = action === "rename"
    ? await ownerNotificationRpc("rename_owner_notification_device_v18", { p_device_id: deviceId, p_device_label: body.deviceLabel })
    : await ownerNotificationRpc("set_owner_notification_device_enabled_v18", {
      p_device_id: deviceId, p_enabled: action === "enable", p_reason: body.reason ?? null,
    });
  return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
}
