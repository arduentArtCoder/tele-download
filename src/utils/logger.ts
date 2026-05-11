import { inspect } from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function serializeMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${inspect(meta, {
    breakLength: Infinity,
    compact: true,
    depth: 6,
    sorted: true,
  })}`;
}

export function createLogger(level: LogLevel): Logger {
  const activeLevel = LOG_LEVEL_PRIORITIES[level];

  const write = (messageLevel: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LOG_LEVEL_PRIORITIES[messageLevel] < activeLevel) {
      return;
    }

    const line = `[${new Date().toISOString()}] ${messageLevel.toUpperCase()} ${message}${serializeMeta(meta)}`;

    if (messageLevel === "error") {
      console.error(line);
      return;
    }

    if (messageLevel === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}
