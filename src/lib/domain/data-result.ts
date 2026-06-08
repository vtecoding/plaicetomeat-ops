export type DataState =
  | "HEALTHY"
  | "NO_DATA"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "UNAUTHORISED"
  | "CONFIGURATION_REQUIRED";

export type DataResult<T> = {
  state: DataState;
  data: T | null;
  message: string;
  issues: string[];
  asOf: string;
};

function result<T>(state: DataState, data: T | null, message: string, issues: string[] = []): DataResult<T> {
  return { state, data, message, issues, asOf: new Date().toISOString() };
}

export function healthy<T>(data: T, message = "Data loaded."): DataResult<T> {
  return result("HEALTHY", data, message);
}

export function noData<T>(data: T | null, message: string, issues: string[] = []): DataResult<T> {
  return result<T>("NO_DATA", data, message, issues);
}

export function degraded<T>(data: T | null, message: string, issues: string[] = []): DataResult<T> {
  return result<T>("DEGRADED", data, message, issues);
}

export function unavailable<T>(message: string, issues: string[] = []): DataResult<T> {
  return result<T>("UNAVAILABLE", null, message, issues);
}

export function unauthorised<T>(message: string, issues: string[] = []): DataResult<T> {
  return result<T>("UNAUTHORISED", null, message, issues);
}

export function configurationRequired<T>(message: string, issues: string[] = []): DataResult<T> {
  return result<T>("CONFIGURATION_REQUIRED", null, message, issues);
}

export function isUsable<T>(result: DataResult<T>): result is DataResult<T> & { data: T } {
  return result.data !== null && (result.state === "HEALTHY" || result.state === "NO_DATA" || result.state === "DEGRADED");
}
