import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { RuntimeConfig } from "../config/index.js";
import type { DownloadedMedia } from "../types/download.js";
import { UserVisibleError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { getSourceHost } from "../utils/urls.js";
import { processRegistry } from "./processRegistry.js";

const TITLE_PREFIX = "__TITLE__";
const FILE_PREFIX = "__FILE__";

export class YtDlpService {
  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
  ) {}

  public async download(url: string, outputDirectory: string): Promise<DownloadedMedia> {
    const outputTemplate = path.join(outputDirectory, "media.%(ext)s");
    const sourceHost = getSourceHost(url);
    const result = await this.run(url, outputTemplate);
    const filePath = result.filePath ?? (await this.findDownloadedFile(outputDirectory));

    if (!filePath) {
      throw new UserVisibleError("Download finished, but no media file was found.");
    }

    return {
      title: result.title || `${sourceHost} video`,
      sourceHost,
      sourceUrl: url,
      filePath,
      fileName: path.basename(filePath),
    };
  }

  private async run(
    url: string,
    outputTemplate: string,
  ): Promise<{ title?: string; filePath?: string }> {
    return await new Promise<{ title?: string; filePath?: string }>((resolve, reject) => {
      const childProcess = processRegistry.track(
        spawn(
          this.config.YTDLP_PATH,
          [
            "--no-playlist",
            "--no-progress",
            "--no-warnings",
            "--format",
            "bv*+ba/b",
            "--merge-output-format",
            "mp4",
            "--ffmpeg-location",
            path.dirname(this.config.FFMPEG_PATH),
            "--output",
            outputTemplate,
            "--print",
            `before_dl:${TITLE_PREFIX}%(title)s`,
            "--print",
            `after_move:${FILE_PREFIX}%(filepath)s`,
            url,
          ],
          {
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );

      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        childProcess.kill("SIGTERM");
      }, this.config.JOB_TIMEOUT_MS);

      childProcess.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      childProcess.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      childProcess.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      childProcess.once("close", (code, signal) => {
        clearTimeout(timeout);

        if (code !== 0) {
          this.logger.warn("yt-dlp failed", {
            code,
            signal,
            stderr,
            url,
          });

          reject(
            new UserVisibleError(
              `yt-dlp could not download this link.${stderr.trim() ? ` ${stderr.trim()}` : ""}`,
              "YTDLP_FAILED",
            ),
          );
          return;
        }

        resolve(parseStructuredOutput(stdout));
      });
    });
  }

  private async findDownloadedFile(directoryPath: string): Promise<string | undefined> {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });

    const candidateFiles = directoryEntries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directoryPath, entry.name))
      .filter((filePath) => !isTemporaryFile(filePath));

    for (const candidateFile of candidateFiles) {
      try {
        await access(candidateFile, constants.R_OK);
        return candidateFile;
      } catch {
        continue;
      }
    }

    return undefined;
  }
}

function parseStructuredOutput(stdout: string): { title?: string; filePath?: string } {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const titleLine = lines.find((line) => line.startsWith(TITLE_PREFIX));
  const fileLine = [...lines].reverse().find((line) => line.startsWith(FILE_PREFIX));

  const title = titleLine?.slice(TITLE_PREFIX.length).trim();
  const filePath = fileLine?.slice(FILE_PREFIX.length).trim();

  return {
    ...(title ? { title } : {}),
    ...(filePath ? { filePath } : {}),
  };
}

function isTemporaryFile(filePath: string): boolean {
  const lowerCasePath = filePath.toLowerCase();

  return (
    lowerCasePath.endsWith(".part") ||
    lowerCasePath.endsWith(".ytdl") ||
    lowerCasePath.endsWith(".json") ||
    lowerCasePath.endsWith(".jpg") ||
    lowerCasePath.endsWith(".jpeg") ||
    lowerCasePath.endsWith(".png") ||
    lowerCasePath.endsWith(".webp")
  );
}
