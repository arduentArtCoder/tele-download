import "dotenv/config";

import os from "node:os";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

function readRequiredString(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }

  return parsedValue;
}

function readLogLevel(name: string, fallback: LogLevel): LogLevel {
  const value = readOptionalString(name);

  if (!value) {
    return fallback;
  }

  if (LOG_LEVELS.includes(value as LogLevel)) {
    return value as LogLevel;
  }

  throw new Error(`Environment variable ${name} must be one of: ${LOG_LEVELS.join(", ")}`);
}

export interface RuntimeConfig {
  BOT_TOKEN: string;
  CHROME_PROFILE?: string;
  DOWNLOAD_DIR: string;
  PUBLIC_BASE_URL: string;
  HTTP_PORT: number;
  LOG_LEVEL: LogLevel;
  MAX_CONCURRENT_JOBS: number;
  MAX_URLS_PER_BATCH: number;
  JOB_TIMEOUT_MS: number;
  MAX_UPLOAD_BYTES: number;
  TEMP_FILE_TTL_MS: number;
  SELECTION_TTL_MS: number;
}

export const env: RuntimeConfig = {
  BOT_TOKEN: readRequiredString("BOT_TOKEN"),
  ...(readChromeProfile() ?? {}),
  DOWNLOAD_DIR: readOptionalString("DOWNLOAD_DIR") ?? `${os.tmpdir()}/tele-download`,
  PUBLIC_BASE_URL: readPublicBaseUrl("PUBLIC_BASE_URL"),
  HTTP_PORT: readNumber("HTTP_PORT", 3000),
  LOG_LEVEL: readLogLevel("LOG_LEVEL", "info"),
  MAX_CONCURRENT_JOBS: readNumber("MAX_CONCURRENT_JOBS", 2),
  MAX_URLS_PER_BATCH: readNumber("MAX_URLS_PER_BATCH", 5),
  JOB_TIMEOUT_MS: readNumber("JOB_TIMEOUT_MS", 10 * 60 * 1000),
  MAX_UPLOAD_BYTES: readNumber("MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
  TEMP_FILE_TTL_MS: readNumber("TEMP_FILE_TTL_MS", 60 * 60 * 1000),
  SELECTION_TTL_MS: readNumber("SELECTION_TTL_MS", 15 * 60 * 1000),
};

function readPublicBaseUrl(name: string): string {
  const value = readRequiredString(name);

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid absolute URL`);
  }

  parsedUrl.pathname = parsedUrl.pathname.endsWith("/") ? parsedUrl.pathname : `${parsedUrl.pathname}/`;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/$/u, "");
}

function readChromeProfile():
  | {
      CHROME_PROFILE: string;
    }
  | undefined {
  const chromeProfile = readOptionalString("CHROME_PROFILE");

  if (!chromeProfile) {
    return undefined;
  }

  return {
    CHROME_PROFILE: chromeProfile,
  };
}
