type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = /(token|secret|password|api[_-]?key|authorization|cookie)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") {
    if (/^(sk-or-v1-|EAA|gho_)[A-Za-z0-9_-]{8,}/.test(value)) return "[redacted]";
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}

function write(level: Level, component: string, message: string, fields?: Record<string, unknown>) {
  const line = {
    time: new Date().toISOString(),
    level,
    component,
    message,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const text = JSON.stringify(line);
  if (level === "error") process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);
}

/** Structured JSON logger. Keys that look like secrets and values that look like tokens are redacted. */
export function logger(component: string) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) => write("debug", component, message, fields),
    info: (message: string, fields?: Record<string, unknown>) => write("info", component, message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write("warn", component, message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write("error", component, message, fields),
  };
}

export type Logger = ReturnType<typeof logger>;
export { redact };
