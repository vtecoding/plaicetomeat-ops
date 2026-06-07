// V12.8 Observability — explicit health states.
//
// A small, plain contract shared by the /api/health endpoint and any future
// internal health surface. Intentionally mirrors the operational-truth vocabulary
// (CONFIGURATION_REQUIRED, UNAVAILABLE) so operators see one consistent language.

export type HealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "CONFIGURATION_REQUIRED";

export type HealthCheck = {
  name: string;
  state: HealthState;
  /** Operator-facing, non-secret detail. */
  detail?: string;
};

export type HealthReport = {
  state: HealthState;
  checks: HealthCheck[];
  asOf: string;
};

// Higher number = worse. Used to fold individual checks into an overall verdict.
const SEVERITY: Record<HealthState, number> = {
  HEALTHY: 0,
  DEGRADED: 1,
  CONFIGURATION_REQUIRED: 2,
  UNAVAILABLE: 3,
};

export function worstState(states: HealthState[]): HealthState {
  return states.reduce<HealthState>((worst, state) => (SEVERITY[state] > SEVERITY[worst] ? state : worst), "HEALTHY");
}

/** True when the system can still serve traffic (HEALTHY or DEGRADED). */
export function isServing(state: HealthState): boolean {
  return state === "HEALTHY" || state === "DEGRADED";
}
