import { NextResponse } from "next/server";
import { ownerNotificationRpc } from "@/lib/server/notification-devices";
export async function POST(_: Request, context: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await context.params;
  const result = await ownerNotificationRpc("create_owner_notification_verification_v18", { p_device_id: deviceId });
  return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
}
