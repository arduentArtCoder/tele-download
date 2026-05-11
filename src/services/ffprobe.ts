import { spawn } from "node:child_process";

import type { RuntimeConfig } from "../config/index.js";
import type { MediaProbeResult } from "../types/download.js";
import { UserVisibleError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { processRegistry } from "./processRegistry.js";

interface FfprobeJson {
  format?: {
    duration?: string;
    format_name?: string;
    size?: string;
  };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
  }>;
}

export class FfprobeService {
  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
  ) {}

  public async probe(filePath: string): Promise<MediaProbeResult> {
    const rawOutput = await this.run(filePath);
    const parsedOutput = JSON.parse(rawOutput) as FfprobeJson;
    const streams = parsedOutput.streams ?? [];
    const videoStream = streams.find((stream) => stream.codec_type === "video");
    const audioStream = streams.find((stream) => stream.codec_type === "audio");
    const sizeBytes = Number.parseInt(parsedOutput.format?.size ?? "0", 10);
    const durationSeconds = Number.parseFloat(parsedOutput.format?.duration ?? "");

    return {
      filePath,
      containerName: parsedOutput.format?.format_name ?? "unknown",
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
      ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
      ...(typeof videoStream?.width === "number" ? { width: videoStream.width } : {}),
      ...(typeof videoStream?.height === "number" ? { height: videoStream.height } : {}),
    };
  }

  private async run(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const childProcess = processRegistry.track(
        spawn(
          this.config.FFPROBE_PATH,
          [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-print_format",
            "json",
            filePath,
          ],
          {
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      childProcess.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      childProcess.once("error", reject);
      childProcess.once("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        this.logger.warn("ffprobe failed", {
          code,
          filePath,
          stderr,
        });

        reject(new UserVisibleError("Could not inspect the downloaded file.", "FFPROBE_FAILED"));
      });
    });
  }
}
