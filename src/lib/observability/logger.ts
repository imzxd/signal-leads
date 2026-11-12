/**
 * Minimal structured logger with PII redaction. Swap the sink for a real
 * observability backend (Axiom, Datadog, OTEL) without touching call sites.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = /(password|secret|token|authorization|api[_-]?key|cookie|service_role)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;

export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || depth > 5) return value;
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(PHONE, "[phone]").slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? "[redacted]" : sanitize(v, depth + 1)]),
    );
  }
  return value;
}

function write(level: Level, event: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...(data ? (sanitize(data) as object) : {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => process.env.SIGNAL_DEBUG && write("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => write("error", event, data),
};
