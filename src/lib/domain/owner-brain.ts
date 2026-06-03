/**
 * Spec-named entry point for the V9 Owner Brain (mirrors
 * `src/lib/domain/operational-intelligence-v2.ts` for V8). The implementation lives in
 * `src/lib/owner-brain/`; this module simply re-exports it so callers can import the
 * Owner Brain from the domain layer.
 */
export * from "@/lib/owner-brain/brain";
