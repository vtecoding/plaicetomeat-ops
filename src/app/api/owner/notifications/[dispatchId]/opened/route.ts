import { NextResponse } from "next/server";
import { ownerNotificationRpc } from "@/lib/server/notification-devices";
export async function POST(_: Request, context: { params: Promise<{ dispatchId: string }> }) {
  const { dispatchId } = await context.params;
  const result = await ownerNotificationRpc("record_owner_notification_opened_v18", { p_dispatch_id: dispatchId });
  return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
}
