import { NextResponse } from "next/server";

import { submitCheckout } from "@/lib/server/orders";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = await submitCheckout(payload);

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  // Note: this programmatic endpoint returns the publicAccessId so an API caller
  // can build the status URL, but it does NOT set the browser access-session
  // cookie (that is established by the interactive checkout server action).
  return NextResponse.json(
    {
      orderRef: result.orderRef,
      publicAccessId: result.publicAccessId,
      message: result.message,
    },
    { status: 201 },
  );
}
