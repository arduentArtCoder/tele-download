import "dotenv/config";

import os from "node:os";
import path from "node:path";

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

function resolveFromProjectRoot(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), filePath);
}

const binDirectory = path.resolve(process.cwd(), "bin");

export interface RuntimeConfig {
  BOT_TOKEN: string;
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
  YTDLP_PATH: string;
  FFMPEG_PATH: string;
  FFPROBE_PATH: string;
}

export const env: RuntimeConfig = {
  BOT_TOKEN: readRequiredString("BOT_TOKEN"),
  DOWNLOAD_DIR: resolveFromProjectRoot(
    readOptionalString("DOWNLOAD_DIR") ?? path.join(os.tmpdir(), "tele-download"),
  ),
  PUBLIC_BASE_URL: readPublicBaseUrl("PUBLIC_BASE_URL"),
  HTTP_PORT: readNumber("HTTP_PORT", 3000),
  LOG_LEVEL: readLogLevel("LOG_LEVEL", "info"),
  MAX_CONCURRENT_JOBS: readNumber("MAX_CONCURRENT_JOBS", 2),
  MAX_URLS_PER_BATCH: readNumber("MAX_URLS_PER_BATCH", 5),
  JOB_TIMEOUT_MS: readNumber("JOB_TIMEOUT_MS", 10 * 60 * 1000),
  MAX_UPLOAD_BYTES: readNumber("MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
  TEMP_FILE_TTL_MS: readNumber("TEMP_FILE_TTL_MS", 60 * 60 * 1000),
  SELECTION_TTL_MS: readNumber("SELECTION_TTL_MS", 15 * 60 * 1000),
  YTDLP_PATH: resolveFromProjectRoot(readOptionalString("YTDLP_PATH") ?? path.join(binDirectory, "yt-dlp")),
  FFMPEG_PATH: resolveFromProjectRoot(
    readOptionalString("FFMPEG_PATH") ?? path.join(binDirectory, "ffmpeg"),
  ),
  FFPROBE_PATH: resolveFromProjectRoot(
    readOptionalString("FFPROBE_PATH") ?? path.join(binDirectory, "ffprobe"),
  ),
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
