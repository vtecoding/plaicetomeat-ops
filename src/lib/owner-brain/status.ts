/**
 * V9 — "How the shop is doing".
 *
 * The score-removal initiative: the owner never sees 81/100. They see a word — Good,
 * Needs attention, or Unknown — with the plain reasons behind it. We reuse the V8 health
 * score's honest banding and its strong / needs-attention category labels, and simply
 * drop every number.
 */
import type { HealthScore } from "@/lib/shop-intelligence/types";
import { deJargon } from "./language";
import type { ShopStatus, ShopStatusBand } from "./types";

function bandFrom(health: HealthScore): ShopStatusBand {
  if (health.band === "unknown") return "unknown";
  if (health.band === "strong") return "good";
  return "needs_attention"; // fair + needs_attention both read as "needs attention"
}

const HEADLINE: Record<ShopStatusBand, string> = {
  good: "The shop is in good shape today.",
  needs_attention: "A few things need a look — nothing the day can't handle.",
  unknown: "There isn't enough recorded yet to judge how the shop is doing.",
};

export function buildShopStatus(health: HealthScore): ShopStatus {
  const band = bandFrom(health);
  return {
    band,
    headline: HEADLINE[band],
    good: health.strong.map(deJargon),
    watch: health.needsAttention.map(deJargon),
  };
}
