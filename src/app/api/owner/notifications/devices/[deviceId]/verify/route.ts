import { NextResponse } from "next/server";
import { ownerNotificationRpc } from "@/lib/server/notification-devices";
export async function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await context.params; const body = await request.json().catch(() => ({}));
  const result = await ownerNotificationRpc("confirm_owner_notification_verification_v18", { p_device_id: deviceId, p_challenge_id: body.challengeId });
  return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
}
