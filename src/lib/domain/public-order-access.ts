// V11.1 — Public order access boundary (pure domain).
//
// The safe DTO is the ONLY shape a public/anon caller may ever receive for an
// order. It must never carry customer phone/email, raw ids, branch internals,
// notes, staff notes or SMS diagnostics (spec §6.1, §8.1.1).

export type PublicOrderStatusValue = "incoming" | "prepping" | "ready" | "collected" | "cancelled";

export type PublicOrderItem = {
  name: string;
  quantity: number;
  unitType: string;
  lineTotal: number;
};

export type PublicOrderStatus = {
  orderRef: string;
  customerDisplayName: string; // first name / masked only
  status: PublicOrderStatusValue;
  pickupDate: string;
  pickupWindowLabel: string;
  items: PublicOrderItem[];
  subtotal: number;
  canCancel: boolean;
  cancellationDeadline: string | null;
};

// Exactly the keys allowed on the public DTO. Used by the architecture/adversarial
// test to prove no internal field can leak through.
export const PUBLIC_ORDER_STATUS_KEYS = [
  "orderRef",
  "customerDisplayName",
  "status",
  "pickupDate",
  "pickupWindowLabel",
  "items",
  "subtotal",
  "canCancel",
  "cancellationDeadline",
] as const;

export const PUBLIC_ORDER_ITEM_KEYS = ["name", "quantity", "unitType", "lineTotal"] as const;

// Field names that must NEVER appear in any public response.
export const FORBIDDEN_PUBLIC_FIELDS = [
  "customerPhone",
  "customer_phone",
  "customerEmail",
  "customer_email",
  "phone",
  "email",
  "notes",
  "staffNotes",
  "staff_notes",
  "id",
  "branchId",
  "branch_id",
  "pickupWindowId",
  "pickup_window_id",
  "smsStatus",
  "sms_status",
  "smsFailureReason",
  "sms_failure_reason",
  "readySmsSentAt",
  "ready_sms_sent_at",
  "idempotencyKey",
  "idempotency_key",
  "publicAccessId",
  "public_access_id",
  "isTest",
  "is_test",
  "createdAt",
  "created_at",
] as const;

/**
 * UK phone normalisation, mirrored exactly by public.normalize_phone in SQL.
 * Returns the national significant number: digits only, with a leading country
 * code (44) or trunk 0 removed. Returns "" when no digits are present.
 */
export function normalizeUkPhone(raw: string | null | undefined): string {
  if (raw == null) return "";
  let d = String(raw).replace(/[^0-9]/g, "");
  if (d.startsWith("44")) {
    d = d.slice(2);
  } else if (d.startsWith("0")) {
    d = d.slice(1);
  }
  return d;
}

/**
 * Validate that an arbitrary object is a structurally-safe public DTO: every key
 * is on the allow-list and no forbidden field is present (recursively). Returns
 * the list of violations (empty = safe). Used as a runtime tripwire and in tests.
 */
export function findForbiddenFields(value: unknown, path = "$"): string[] {
  const violations: string[] = [];
  const forbidden = new Set<string>(FORBIDDEN_PUBLIC_FIELDS as readonly string[]);

  const walk = (node: unknown, p: string, allowedKeys: Set<string> | null) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${p}[${i}]`, allowedKeys));
      return;
    }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        if (forbidden.has(key)) {
          violations.push(`${p}.${key}`);
        }
        if (allowedKeys && !allowedKeys.has(key)) {
          violations.push(`${p}.${key} (not in allow-list)`);
        }
      }
    }
  };

  // Top level: enforce the status allow-list; items: enforce the item allow-list.
  walk(value, path, new Set(PUBLIC_ORDER_STATUS_KEYS as readonly string[]));
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    (value as { items: unknown[] }).items.forEach((item, i) =>
      walk(item, `${path}.items[${i}]`, new Set(PUBLIC_ORDER_ITEM_KEYS as readonly string[])),
    );
  }
  return violations;
}
