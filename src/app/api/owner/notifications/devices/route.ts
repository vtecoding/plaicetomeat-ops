import { NextResponse } from "next/server";
import { listOwnerNotificationDevices, registerOwnerNotificationDevice } from "@/lib/server/notification-devices";

export async function GET() { return NextResponse.json({ devices: await listOwnerNotificationDevices() }); }
export async function POST(request: Request) {
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const result = await registerOwnerNotificationDevice(body);
  return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
}
