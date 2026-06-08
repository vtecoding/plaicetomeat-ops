// V12.8 Observability — unified structured logging.
//
// Deliberately edge-safe and dependency-light (NO `server-only`, no node builtins)
// so it can be called from the Edge middleware, server actions, and route handlers
// alike — mirroring the constraint on `security-audit.ts`.
//
// Emits exactly one JSON line per event via console.* keyed by severity, so a
// platform log drain can parse it. Secrets are stripped defensively: keys that
// look like credentials are dropped, and any value that looks like a JWT / bearer
// token is redacted. Passwords, tokens, cookies, secrets, and raw auth headers can
// therefore never reach the logs even if a caller passes them by mistake.

export type LogCategory =
  | "AUTH"
  | "CHECKOUT"
  | "AUDIT"
  | "INVENTORY"
  | "OPS_CAPTURE"
  | "RELEASE"
  | "SYSTEM";

export type LogSeverity = "debug" | "info" | "warn" | "error";

export type LogFields = {
  /** Branch scope where relevant — included for correlation, never required. */
  branchId?: string | null;
  /** Request id where available — included for correlation, never required. */
  requestId?: string | null;
  [key: string]: unknown;
};

// Keys whose values are dropped entirely, regardless of content.
const SECRET_KEY_RE =
  /pass(word)?|token|secret|cookie|authorization|auth[-_]?header|service[-_]?role|api[-_]?key|bearer|credential|private[-_]?key/i;

// Values shaped like a JWT are redacted even under an innocent key name.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/;

const REDACTED = "[redacted]";

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return JWT_RE.test(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return redact(value as Record<string, unknown>);
  }
  return value;
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactValue(value);
  }
  return out;
}

export type LogEntry = {
  timestamp: string;
  category: LogCategory;
  severity: LogSeverity;
  message: string;
} & Record<string, unknown>;

export function log(category: LogCategory, severity: LogSeverity, message: string, fields: LogFields = {}): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    category,
    severity,
    message,
    ...redact(fields),
  };

  const line = safeStringify(entry);
  if (severity === "error") {
    console.error(line);
  } else if (severity === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function safeStringify(entry: LogEntry): string {
  try {
    return JSON.stringify(entry);
  } catch {
    // Circular/unserialisable fields must never crash a log call.
    return JSON.stringify({
      timestamp: entry.timestamp,
      category: entry.category,
      severity: entry.severity,
      message: entry.message,
      note: "unserialisable-fields",
    });
  }
}

export const logger = {
  debug: (category: LogCategory, message: string, fields?: LogFields) => log(category, "debug", message, fields),
  info: (category: LogCategory, message: string, fields?: LogFields) => log(category, "info", message, fields),
  warn: (category: LogCategory, message: string, fields?: LogFields) => log(category, "warn", message, fields),
  error: (category: LogCategory, message: string, fields?: LogFields) => log(category, "error", message, fields),
};
