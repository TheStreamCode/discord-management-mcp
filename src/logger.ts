import { safeErrorMessage } from "./errors.js";

export type LogLevel = "error" | "warn" | "info" | "debug";

export type LogFields = Record<string, unknown>;

export type Logger = {
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
};

export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const MAX_SANITIZE_DEPTH = 4;

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Creates a JSON-lines logger. Every record goes to stderr only: stdout is
 * reserved for the MCP stdio protocol, so a log line written there would
 * corrupt the client connection.
 */
export function createLogger(level: LogLevel): Logger {
  // Defensive fallback: a runtime value outside the enum must not disable
  // filtering entirely (it would emit debug records in production).
  const threshold = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;

  const write = (entryLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_PRIORITY[entryLevel] > threshold) {
      return;
    }

    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message: safeErrorMessage(message),
    };

    for (const [key, value] of Object.entries(fields ?? {})) {
      if (value === undefined) {
        continue;
      }
      record[key] = sanitizeLogValue(value);
    }

    process.stderr.write(`${serializeRecord(record, message, entryLevel)}\n`);
  };

  return {
    error: (message, fields) => write("error", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    info: (message, fields) => write("info", message, fields),
    debug: (message, fields) => write("debug", message, fields),
  };
}

function serializeRecord(record: Record<string, unknown>, message: string, level: LogLevel): string {
  try {
    return JSON.stringify(record);
  } catch {
    // Logging must never throw: a failed serialization would mask the original
    // failure, and a partially written line would corrupt the log stream.
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: safeErrorMessage(message),
      fields: "[unserializable]",
    });
  }
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return safeErrorMessage(value);
  }

  if (value instanceof Error) {
    return safeErrorMessage(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_SANITIZE_DEPTH) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeLogValue(nested, depth + 1)]),
  );
}
