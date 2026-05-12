import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeConfig } from "../config/index.js";
import type { Logger } from "../utils/logger.js";
import { processRegistry } from "./processRegistry.js";

const REQUIRED_SYSTEM_BINARIES = ["yt-dlp", "ffmpeg", "ffprobe"] as const;

async function ensureCommandRuns(command: string): Promise<void> {
  const versionArgument = getVersionArgument(command);

  await new Promise<void>((resolve, reject) => {
    const childProcess = processRegistry.track(
      spawn(command, [versionArgument], {
        stdio: ["ignore", "ignore", "pipe"],
      }),
    );

    let stderr = "";

    childProcess.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    childProcess.once("error", reject);
    childProcess.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Failed to execute ${command}: ${stderr.trim() || `exit code ${code ?? "unknown"}`}`));
    });
  });
}

async function ensureSecretStorageAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childProcess = processRegistry.track(
      spawn("python3", ["-c", "import secretstorage"], {
        stdio: ["ignore", "ignore", "pipe"],
      }),
    );

    let stderr = "";

    childProcess.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    childProcess.once("error", (error) => {
      reject(
        new Error(
          `Failed to execute python3: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    childProcess.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Chromium cookie extraction requires the system Python secretstorage module. Install python3-secretstorage.${stderr.trim() ? ` ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

function getVersionArgument(command: string): string {
  const binaryName = path.basename(command).toLowerCase();

  if (binaryName === "python3") {
    return "--version";
  }

  if (binaryName === "ffmpeg" || binaryName === "ffprobe") {
    return "-version";
  }

  return "--version";
}

export async function validateRuntime(config: RuntimeConfig, logger: Logger): Promise<void> {
  await mkdir(config.DOWNLOAD_DIR, { recursive: true });

  for (const command of REQUIRED_SYSTEM_BINARIES) {
    await ensureCommandRuns(command);
  }

  await ensureCommandRuns("python3");
  await ensureSecretStorageAvailable();

  if (config.CHROME_PROFILE) {
    const chromeCookiesPath = resolveChromeCookiesPath(config.CHROME_PROFILE);

    try {
      await access(chromeCookiesPath);
    } catch {
      throw new Error(buildChromeProfileValidationError(config.CHROME_PROFILE, chromeCookiesPath));
    }
  }

  logger.info("Runtime validation complete", {
    downloadDir: config.DOWNLOAD_DIR,
  });
}

export function resolveChromeCookiesPath(chromeProfile: string): string {
  return path.join(os.homedir(), ".config", "google-chrome", chromeProfile, "Cookies");
}

export function buildChromeProfileValidationError(
  chromeProfile: string,
  chromeCookiesPath: string,
): string {
  return [
    `CHROME_PROFILE="${chromeProfile}" does not point to a readable Chrome cookies database.`,
    `Checked path: ${chromeCookiesPath}`,
    'Use the real on-disk Chrome profile directory, usually "Default" or "Profile 2".',
    "Chrome UI profile names may not match the directory names under ~/.config/google-chrome/.",
  ].join(" ");
}
