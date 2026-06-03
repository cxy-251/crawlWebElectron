type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY_RE = /(authorization|bearer|cookie|password|passwd|secret|token|session|credential)/i;
const URL_KEY_RE = /(url|href|uri)/i;

function now(): string {
  return new Date().toISOString();
}

export function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);

    if (parsed.protocol === "about:") {
      return parsed.href;
    }

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return value.slice(0, 120);
  }
}

function sanitize(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_RE.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    const stripped = value
      .replace(/(token|password|secret|cookie|authorization)=([^&\s]+)/gi, "$1=[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");

    return URL_KEY_RE.test(key) ? safeUrl(stripped) : stripped.slice(0, 300);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitize(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, entryKey)
      ])
    );
  }

  return value;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta) {
    return "";
  }

  try {
    return ` ${JSON.stringify(sanitize(meta))}`;
  } catch {
    return " [unserializable-meta]";
  }
}

function write(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): void {
  const line = `[${now()}] [${level.toUpperCase()}] [${scope}] ${message}${formatMeta(meta)}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(scope: string, message: string, meta?: Record<string, unknown>): void {
    write("info", scope, message, meta);
  },
  warn(scope: string, message: string, meta?: Record<string, unknown>): void {
    write("warn", scope, message, meta);
  },
  error(scope: string, message: string, meta?: Record<string, unknown>): void {
    write("error", scope, message, meta);
  }
};

