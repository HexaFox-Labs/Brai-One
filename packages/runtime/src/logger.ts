import pino, { type Logger, type LoggerOptions } from "pino";

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  base?: Record<string, unknown>;
}

const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "authorization",
  "password",
  "pass",
  "token",
  "dsn",
  "*.password",
  "*.pass",
  "*.token",
  "*.dsn",
] as const;

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? "info",
    base: {
      service: options.name,
      ...options.base,
    },
    redact: {
      paths: [...REDACTED_LOG_PATHS],
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return pino(loggerOptions);
}

export type { Logger };
