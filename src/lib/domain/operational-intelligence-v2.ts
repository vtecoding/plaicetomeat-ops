/**
 * V8.1 — Operational Intelligence Engine (spec-named entry point).
 *
 * The spec asks for `src/lib/domain/operational-intelligence-v2.ts` as "the
 * intelligence layer". The implementation lives in the cohesive
 * `src/lib/shop-intelligence/` module (alongside the existing `action-intelligence/`
 * precedent); this file is the named door into it so the spec path resolves.
 *
 *   import { buildShopIntelligence } from "@/lib/domain/operational-intelligence-v2";
 */
export * from "@/lib/shop-intelligence/engine";
export { buildShopIntelligence } from "@/lib/shop-intelligence/engine";
