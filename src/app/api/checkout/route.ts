import { NextResponse } from "next/server";

import { submitCheckout } from "@/lib/server/orders";
import { MAX_CHECKOUT_BODY_BYTES } from "@/lib/validation/checkout";

// Public programmatic checkout. V12.3: this is NOT a second, looser mutation path.
// It enforces the SAME body cap, then runs the identical hardened checkout service
// (schema + payload caps + duplicate-SKU merge + rate limit + server-only test gate
// + service-role RPC) as the storefront action. It deliberately does NOT set the
// browser access cookie — an API caller recovers the order via ref + phone.
export async function POST(request: Request) {
  const raw = await request.text();

  if (Buffer.byteLength(raw, "utf8") > MAX_CHECKOUT_BODY_BYTES) {
    return NextResponse.json({ message: "Request body is too large." }, { status: 413 });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
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
      publicAccessId: result.publicAccessId,
      message: result.message,
    },
    { status: 201 },
  );
}
