import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { RuntimeConfig } from "../config/index.js";
import type { DeliveryMode, DownloadOption, DownloadedMedia, InspectedMedia } from "../types/download.js";
import { UserVisibleError } from "../utils/errors.js";
import { formatBinarySize } from "../utils/formatting.js";
import type { Logger } from "../utils/logger.js";
import { getSourceHost } from "../utils/urls.js";
import { processRegistry } from "./processRegistry.js";

const TITLE_PREFIX = "__TITLE__";
const FILE_PREFIX = "__FILE__";
const MAX_CURATED_OPTIONS = 5;

interface YtDlpFormatJson {
  format_id?: string;
  width?: number;
  height?: number;
  acodec?: string;
  vcodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

interface YtDlpInspectionJson {
  title?: string;
  formats?: YtDlpFormatJson[];
}

interface CandidateOption {
  formatId: string;
  formatSelector: string;
  estimatedSizeBytes?: number;
  hasAudio: boolean;
  height?: number;
  tbr?: number;
  width?: number;
}

export class YtDlpService {
  private supportedExtractorsCache?: string[];

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
  ) {}

  public async inspectFormats(url: string): Promise<InspectedMedia> {
    const stdout = await this.runCommand(url, [
      "--dump-single-json",
      "--no-download",
      "--no-playlist",
      "--no-warnings",
      url,
    ]);

    let parsedOutput: YtDlpInspectionJson;

    try {
      parsedOutput = JSON.parse(stdout) as YtDlpInspectionJson;
    } catch {
      throw new UserVisibleError("yt-dlp returned an unreadable format list.", "YTDLP_FORMAT_LIST_INVALID");
    }

    const sourceHost = getSourceHost(url);
    const options = curateDownloadOptions(parsedOutput.formats ?? [], this.config.MAX_UPLOAD_BYTES);

    if (options.length === 0) {
      throw new UserVisibleError("No downloadable video formats were found for this link.");
    }

    return {
      title: parsedOutput.title?.trim() || `${sourceHost} video`,
      sourceHost,
      sourceUrl: url,
      options,
    };
  }

  public async download(
    url: string,
    formatSelector: string,
    outputDirectory: string,
  ): Promise<DownloadedMedia> {
    const outputTemplate = `${outputDirectory}/media.%(ext)s`;
    const sourceHost = getSourceHost(url);
    const result = await this.run(url, formatSelector, outputTemplate);
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

  public async listSupportedExtractors(): Promise<string[]> {
    if (this.supportedExtractorsCache) {
      return this.supportedExtractorsCache;
    }

    const stdout = await this.runCommand(undefined, ["--list-extractors"]);

    const extractors = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    this.supportedExtractorsCache = extractors;
    return extractors;
  }

  private async run(
    url: string,
    formatSelector: string,
    outputTemplate: string,
  ): Promise<{ title?: string; filePath?: string }> {
    const stdout = await this.runCommand(url, [
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      "--format",
      formatSelector,
      "--merge-output-format",
      "mp4",
      "--output",
      outputTemplate,
      "--print",
      `before_dl:${TITLE_PREFIX}%(title)s`,
      "--print",
      `after_move:${FILE_PREFIX}%(filepath)s`,
      url,
    ]);

    return parseStructuredOutput(stdout);
  }

  private async runCommand(url: string | undefined, arguments_: string[]): Promise<string> {
    const finalArguments = [
      ...buildCookieArguments(url, this.config.CHROME_PROFILE),
      ...arguments_,
    ];

    return await new Promise<string>((resolve, reject) => {
      const childProcess = processRegistry.track(
        spawn("yt-dlp", finalArguments, {
          stdio: ["ignore", "pipe", "pipe"],
        }),
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
            arguments: finalArguments,
            code,
            signal,
            stderr,
          });

          reject(
            new UserVisibleError(
              buildYtDlpErrorMessage(stderr),
              "YTDLP_FAILED",
            ),
          );
          return;
        }

        resolve(stdout);
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

export function buildCookieArguments(
  url: string | undefined,
  chromeProfile: string | undefined = undefined,
): string[] {
  if (!shouldUseBrowserCookies(url)) {
    return [];
  }

  if (chromeProfile) {
    return ["--cookies-from-browser", `chrome:${chromeProfile}`];
  }

  return ["--cookies-from-browser", "chrome"];
}

export function curateDownloadOptions(
  formats: YtDlpFormatJson[],
  maxUploadBytes: number,
): DownloadOption[] {
  const bestAudioEstimate = getBestAudioEstimate(formats);
  const candidates = formats
    .filter(isVideoFormat)
    .map((format) => buildCandidateOption(format, bestAudioEstimate));

  const optionsByHeight = new Map<number, CandidateOption>();

  for (const candidate of candidates) {
    const heightKey = candidate.height ?? 0;
    const existing = optionsByHeight.get(heightKey);

    if (!existing || compareCandidateOptions(candidate, existing) < 0) {
      optionsByHeight.set(heightKey, candidate);
    }
  }

  return [...optionsByHeight.entries()]
    .sort((left, right) => right[0] - left[0])
    .slice(0, MAX_CURATED_OPTIONS)
    .map(([, candidate], index) => buildDownloadOption(candidate, index, maxUploadBytes));
}

export function getDeliveryModeForSize(
  sizeBytes: number | undefined,
  maxUploadBytes: number,
): DeliveryMode {
  if (typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > maxUploadBytes) {
    return "link";
  }

  return "telegram";
}

function buildCandidateOption(
  format: YtDlpFormatJson,
  bestAudioEstimate: number | undefined,
): CandidateOption {
  const hasAudio = format.acodec !== undefined && format.acodec !== "none";
  const ownSizeEstimate = sanitizeSize(format.filesize) ?? sanitizeSize(format.filesize_approx);
  const candidate: CandidateOption = {
    formatId: format.format_id ?? "best",
    formatSelector:
      format.format_id === undefined
        ? "bestvideo*+bestaudio/best"
        : hasAudio
          ? format.format_id
          : `${format.format_id}+bestaudio/best`,
    hasAudio,
    ...(typeof format.height === "number" ? { height: format.height } : {}),
    ...(typeof format.tbr === "number" ? { tbr: format.tbr } : {}),
    ...(typeof format.width === "number" ? { width: format.width } : {}),
  };

  const estimatedSizeBytes = estimateCombinedSize(ownSizeEstimate, hasAudio, bestAudioEstimate);

  if (typeof estimatedSizeBytes === "number") {
    candidate.estimatedSizeBytes = estimatedSizeBytes;
  }

  return candidate;
}

function buildDownloadOption(
  candidate: CandidateOption,
  index: number,
  maxUploadBytes: number,
): DownloadOption {
  const deliveryMode = getDeliveryModeForSize(candidate.estimatedSizeBytes, maxUploadBytes);
  const qualityLabel = typeof candidate.height === "number" ? `${candidate.height}p` : "Best available";
  const deliveryLabel = deliveryMode === "telegram" ? "Telegram" : "1h link";

  return {
    id: `option-${index + 1}`,
    label: `${qualityLabel} • ${formatBinarySize(candidate.estimatedSizeBytes)} • ${deliveryLabel}`,
    formatSelector: candidate.formatSelector,
    deliveryMode,
    ...(typeof candidate.estimatedSizeBytes === "number"
      ? { estimatedSizeBytes: candidate.estimatedSizeBytes }
      : {}),
    ...(typeof candidate.height === "number" ? { height: candidate.height } : {}),
    ...(typeof candidate.width === "number" ? { width: candidate.width } : {}),
  };
}

function compareCandidateOptions(left: CandidateOption, right: CandidateOption): number {
  if (left.hasAudio !== right.hasAudio) {
    return left.hasAudio ? -1 : 1;
  }

  const leftKnownSize = typeof left.estimatedSizeBytes === "number";
  const rightKnownSize = typeof right.estimatedSizeBytes === "number";
  if (leftKnownSize !== rightKnownSize) {
    return leftKnownSize ? -1 : 1;
  }

  if (left.estimatedSizeBytes !== right.estimatedSizeBytes) {
    return (right.estimatedSizeBytes ?? 0) - (left.estimatedSizeBytes ?? 0);
  }

  return (right.tbr ?? 0) - (left.tbr ?? 0);
}

function estimateCombinedSize(
  ownSizeEstimate: number | undefined,
  hasAudio: boolean,
  bestAudioEstimate: number | undefined,
): number | undefined {
  if (hasAudio) {
    return ownSizeEstimate;
  }

  if (typeof ownSizeEstimate === "number" && typeof bestAudioEstimate === "number") {
    return ownSizeEstimate + bestAudioEstimate;
  }

  return ownSizeEstimate;
}

function getBestAudioEstimate(formats: YtDlpFormatJson[]): number | undefined {
  const audioFormats = formats
    .filter((format) => format.vcodec === "none" && format.acodec !== undefined && format.acodec !== "none")
    .map((format) => sanitizeSize(format.filesize) ?? sanitizeSize(format.filesize_approx))
    .filter((sizeBytes): sizeBytes is number => typeof sizeBytes === "number");

  if (audioFormats.length === 0) {
    return undefined;
  }

  return Math.max(...audioFormats);
}

function isVideoFormat(format: YtDlpFormatJson): boolean {
  return Boolean(format.format_id) && format.vcodec !== undefined && format.vcodec !== "none";
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

function sanitizeSize(sizeBytes: number | undefined): number | undefined {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return undefined;
  }

  return sizeBytes;
}

export function buildYtDlpErrorMessage(stderr: string): string {
  const trimmedStderr = stderr.trim();
  const baseMessage = `yt-dlp command failed.${trimmedStderr ? ` ${trimmedStderr}` : ""}`;

  if (trimmedStderr.includes("could not find chrome cookies database")) {
    return `${baseMessage} CHROME_PROFILE must be the real on-disk Chrome profile directory, such as "Default" or "Profile 2".`;
  }

  if (trimmedStderr.includes("secretstorage not available")) {
    return `${baseMessage} Install the system Python secretstorage module, for example python3-secretstorage, before starting the app.`;
  }

  return baseMessage;
}

function shouldUseBrowserCookies(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    return (
      hostname === "instagram.com" ||
      hostname === "www.instagram.com" ||
      hostname === "m.instagram.com"
    );
  } catch {
    return false;
  }
}
