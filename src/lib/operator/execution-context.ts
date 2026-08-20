export type ExecutionMode = "live" | "dry-run";

export type ExecutionContext = {
  mode: ExecutionMode;
};

export const LIVE_EXECUTION_CONTEXT: ExecutionContext = Object.freeze({ mode: "live" });

export class ProductionMutationBlockedError extends Error {
  constructor(operation: string) {
    super(`Production mutation blocked outside live execution context: ${operation}`);
    this.name = "ProductionMutationBlockedError";
  }
}

/**
 * Every client-reachable production adapter must call this before touching truth.
 * Missing, malformed and future execution modes deliberately fail closed.
 */
export function assertProductionMutationAllowed(
  context: ExecutionContext | null | undefined,
  operation: string,
): asserts context is { mode: "live" } {
  if (!context || context.mode !== "live") {
    throw new ProductionMutationBlockedError(operation);
  }
}
