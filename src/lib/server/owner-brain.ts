import "server-only";

import { buildOwnerBrain } from "@/lib/owner-brain/brain";
import type { OwnerBrain } from "@/lib/owner-brain/types";
import { getShopIntelligence } from "@/lib/server/shop-intelligence";

export type { OwnerBrain } from "@/lib/owner-brain/types";

/**
 * Assemble the V9 Owner Brain. Reuses the existing V8 `getShopIntelligence` read (which
 * already aggregates every signal from existing tables) and runs the pure compression
 * engine over it. Adds no new reads, no new tables, and mutates nothing.
 */
export async function getOwnerBrain(branchId: string, now = new Date()): Promise<OwnerBrain> {
  const intel = await getShopIntelligence(branchId, now);
  return buildOwnerBrain(intel);
}
