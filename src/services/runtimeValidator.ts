import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeConfig } from "../config/index.js";
import type { Logger } from "../utils/logger.js";
import { processRegistry } from "./processRegistry.js";

async function ensureExecutable(binaryPath: string): Promise<void> {
  await access(binaryPath, constants.X_OK);
}

async function ensureBinaryRuns(binaryPath: string): Promise<void> {
  const versionArgument = getVersionArgument(binaryPath);

  await new Promise<void>((resolve, reject) => {
    const childProcess = processRegistry.track(
      spawn(binaryPath, [versionArgument], {
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

      reject(new Error(`Failed to execute ${binaryPath}: ${stderr.trim() || `exit code ${code ?? "unknown"}`}`));
    });
  });
}

function getVersionArgument(binaryPath: string): string {
  const binaryName = path.basename(binaryPath).toLowerCase();

  if (binaryName === "ffmpeg" || binaryName === "ffprobe") {
    return "-version";
  }

  return "--version";
}

export async function validateRuntime(config: RuntimeConfig, logger: Logger): Promise<void> {
  await mkdir(config.DOWNLOAD_DIR, { recursive: true });

  const binaries = [config.YTDLP_PATH, config.FFMPEG_PATH, config.FFPROBE_PATH];

  for (const binaryPath of binaries) {
    await ensureExecutable(binaryPath);
    await ensureBinaryRuns(binaryPath);
  }

  if (config.CHROME_PATH) {
    await ensureExecutable(config.CHROME_PATH);
  }

  if (config.CHROME_PROFILE) {
    const chromeCookiesPath = resolveChromeCookiesPath(config.CHROME_PROFILE);

    try {
      await access(chromeCookiesPath, constants.R_OK);
    } catch {
      throw new Error(buildChromeProfileValidationError(config.CHROME_PROFILE, chromeCookiesPath));
    }
  }

  logger.info("Runtime validation complete", {
    chromePath: config.CHROME_PATH ?? "auto",
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
