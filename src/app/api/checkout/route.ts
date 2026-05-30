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

  return NextResponse.json(
    {
      orderRef: result.orderRef,
      message: result.message,
    },
    { status: 201 },
  );
}
