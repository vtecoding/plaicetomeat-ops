import { NextResponse } from "next/server";
import { resolveStaffContext } from "@/lib/server/staff-context";
export async function GET() {
  const ctx = await resolveStaffContext("owner", { branchScoped: true });
  if (!ctx.ok) return NextResponse.json({ error: ctx.message }, { status: ctx.reason === "unauthenticated" ? 401 : 403 });
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) return NextResponse.json({ error: "Notifications are not configured." }, { status: 503 });
  return NextResponse.json({ publicKey });
}
