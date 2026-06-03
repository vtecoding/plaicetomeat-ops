import type { OwnerAction } from "@/lib/action-intelligence/action-types";
import { formatCurrency } from "@/lib/utils";

/**
 * Dad Mode (V7.0) — the plain-English home screen for a non-technical owner.
 *
 * Pure helpers that turn the existing dashboard signals into "what happened →
 * what matters → what to press". The owner never sees raw severity words like
 * `info` / `warning` / `urgent`; everything is mapped to a human urgency.
 */

export type Urgency = "urgent" | "attention" | "important" | "ok";

export const URGENCY_LABEL: Record<Urgency, string> = {
  urgent: "Urgent",
  attention: "Needs attention",
  important: "Important",
  ok: "All good",
};

/** Map an internal action severity onto a human urgency the owner understands. */
export function severityToUrgency(severity: OwnerAction["severity"]): Urgency {
  if (severity === "urgent") return "urgent";
  if (severity === "warning") return "attention";
  return "important";
}

export type TodayAction = {
  id: string;
  title: string;
  /** Why it matters, in plain English. */
  why: string;
  /** The single suggested next step. */
  suggested: string;
  /** Big-button label and where it goes. */
  actionLabel: string;
  href: string;
  urgency: Urgency;
  urgencyLabel: string;
};

/** Sensible destination + button label for each action category. */
const CATEGORY_LINK: Record<OwnerAction["category"], { href: string; label: string }> = {
  stock: { href: "/admin/inventory", label: "Review stock" },
  waste: { href: "/admin/purchasing", label: "Review waste" },
  margin: { href: "/admin/products", label: "Check prices" },
  compliance: { href: "/admin/compliance", label: "Check certificates" },
  customer: { href: "/admin/orders", label: "View orders" },
  basket: { href: "/admin/purchasing", label: "Plan ahead" },
  system: { href: "/counter", label: "Open counter" },
};

/**
 * The most important section: at most `limit` plain actions, already ranked by
 * the action engine. We only re-shape them — no new prioritisation.
 */
export function buildTodayActions(actions: OwnerAction[], limit = 5): TodayAction[] {
  return actions.slice(0, limit).map((action) => {
    const link = CATEGORY_LINK[action.category] ?? { href: "/admin", label: "Open" };
    const urgency = severityToUrgency(action.severity);
    return {
      id: action.id,
      title: action.title,
      why: action.explanation,
      suggested: action.recommendedAction,
      actionLabel: link.label,
      href: link.href,
      urgency,
      urgencyLabel: URGENCY_LABEL[urgency],
    };
  });
}

export type TodayOrders = {
  total: number;
  awaitingPrep: number;
  ready: number;
  /** True when there is anything to do at the counter. */
  hasWork: boolean;
};

export function buildTodayOrders(input: {
  orderCount: number;
  awaitingPrep: number;
  readyCount: number;
}): TodayOrders {
  return {
    total: input.orderCount,
    awaitingPrep: input.awaitingPrep,
    ready: input.readyCount,
    hasWork: input.awaitingPrep > 0 || input.readyCount > 0,
  };
}

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  urgency: Urgency;
  urgencyLabel: string;
};

function attentionItem(id: string, title: string, detail: string, urgency: Urgency): AttentionItem {
  return { id, title, detail, urgency, urgencyLabel: URGENCY_LABEL[urgency] };
}

/** Stock problems only — nothing is shown when stock is healthy. */
export function buildStockAttention(input: {
  batchesExpiringWithin3Days: number;
  stockValueAtRisk: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.batchesExpiringWithin3Days > 0) {
    const n = input.batchesExpiringWithin3Days;
    items.push(
      attentionItem(
        "stock-expiring",
        "Stock is about to go off",
        `${n} stock ${n === 1 ? "batch is" : "batches are"} within 3 days of its date. Use or discount it first.`,
        "urgent",
      ),
    );
  }

  if (input.stockValueAtRisk > 0 && input.batchesExpiringWithin3Days === 0) {
    items.push(
      attentionItem(
        "stock-at-risk",
        "Stock to use first",
        `${formatCurrency(input.stockValueAtRisk)} of stock is getting close to its date. Sell this before fresh stock.`,
        "attention",
      ),
    );
  }

  return items;
}

/** Compliance problems only — empty when everything is in date. */
export function buildComplianceWarnings(input: {
  expiredCertificates: number;
  missingCertificates: number;
  expiringCertificates: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.expiredCertificates > 0) {
    const n = input.expiredCertificates;
    items.push(
      attentionItem(
        "cert-expired",
        "A certificate has expired",
        `${n} supplier ${n === 1 ? "certificate has" : "certificates have"} expired. Get an updated one before selling that meat.`,
        "urgent",
      ),
    );
  }

  if (input.missingCertificates > 0) {
    const n = input.missingCertificates;
    items.push(
      attentionItem(
        "cert-missing",
        "A supplier certificate is missing",
        `${n} supplier ${n === 1 ? "has" : "suppliers have"} no certificate on file. Ask them to send one.`,
        "urgent",
      ),
    );
  }

  if (input.expiringCertificates > 0) {
    const n = input.expiringCertificates;
    items.push(
      attentionItem(
        "cert-expiring",
        "A certificate is expiring soon",
        `${n} ${n === 1 ? "certificate expires" : "certificates expire"} within 30 days. Line up a replacement now.`,
        "attention",
      ),
    );
  }

  return items;
}

/** Overall tone for a list of attention items (used for the section badge). */
export function overallUrgency(items: AttentionItem[]): Urgency {
  if (items.some((item) => item.urgency === "urgent")) return "urgent";
  if (items.some((item) => item.urgency === "attention")) return "attention";
  if (items.length > 0) return "important";
  return "ok";
}
