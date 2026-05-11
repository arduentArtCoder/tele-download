import { rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { RuntimeConfig } from "../config/index.js";
import type { PreparedMedia } from "../types/download.js";
import { UserVisibleError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { FfprobeService } from "./ffprobe.js";
import { processRegistry } from "./processRegistry.js";

export class MediaNormalizer {
  public constructor(
    private readonly config: RuntimeConfig,
    private readonly ffprobeService: FfprobeService,
    private readonly logger: Logger,
  ) {}

  public async prepareForTelegram(filePath: string): Promise<PreparedMedia> {
    const initialProbe = await this.ffprobeService.probe(filePath);

    if (!initialProbe.hasVideo) {
      throw new UserVisibleError("The downloaded file does not contain a video stream.");
    }

    const isMp4File =
      path.extname(filePath).toLowerCase() === ".mp4" && initialProbe.containerName.includes("mp4");

    const preparedFilePath = isMp4File ? filePath : await this.remuxToMp4(filePath);
    const finalProbe = isMp4File ? initialProbe : await this.ffprobeService.probe(preparedFilePath);

    if (!finalProbe.containerName.includes("mp4")) {
      throw new UserVisibleError("The downloaded video could not be converted into an MP4 upload.");
    }

    if (finalProbe.sizeBytes > this.config.MAX_UPLOAD_BYTES) {
      const maxSizeInMegabytes = Math.floor(this.config.MAX_UPLOAD_BYTES / (1024 * 1024));
      throw new UserVisibleError(
        `This video is ${formatMegabytes(finalProbe.sizeBytes)} MB, which exceeds the ${maxSizeInMegabytes} MB Telegram bot upload limit.`,
      );
    }

    return {
      ...finalProbe,
      fileName: path.basename(preparedFilePath),
    };
  }

  private async remuxToMp4(inputPath: string): Promise<string> {
    const outputPath = path.join(path.dirname(inputPath), "telegram-ready.mp4");
    await rm(outputPath, { force: true });

    await new Promise<void>((resolve, reject) => {
      const childProcess = processRegistry.track(
        spawn(
          this.config.FFMPEG_PATH,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            inputPath,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            outputPath,
          ],
          {
            stdio: ["ignore", "ignore", "pipe"],
          },
        ),
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

        this.logger.warn("ffmpeg remux failed", {
          code,
          inputPath,
          stderr,
        });

        reject(
          new UserVisibleError(
            "The downloaded file is not in an uploadable MP4 format and remuxing failed.",
            "FFMPEG_REMUX_FAILED",
          ),
        );
      });
    });

    return outputPath;
  }
}

function formatMegabytes(sizeBytes: number): string {
  return (sizeBytes / (1024 * 1024)).toFixed(1);
}
