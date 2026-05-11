import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
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

  logger.info("Runtime validation complete", {
    downloadDir: config.DOWNLOAD_DIR,
  });
}
