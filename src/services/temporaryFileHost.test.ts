import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { RuntimeConfig } from "../config/index.js";
import { createTestLogger } from "../test/testLogger.js";
import { buildHostedFileUrl, TemporaryFileHost } from "./temporaryFileHost.js";

function createRuntimeConfig(tempFileTtlMs: number): RuntimeConfig {
  return {
    BOT_TOKEN: "test-token",
    DOWNLOAD_DIR: os.tmpdir(),
    PUBLIC_BASE_URL: "https://downloads.example.com",
    HTTP_PORT: 3000,
    LOG_LEVEL: "info",
    MAX_CONCURRENT_JOBS: 1,
    MAX_URLS_PER_BATCH: 5,
    JOB_TIMEOUT_MS: 1_000,
    MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
    TEMP_FILE_TTL_MS: tempFileTtlMs,
    SELECTION_TTL_MS: 1_000,
    YTDLP_PATH: "/tmp/yt-dlp",
    FFMPEG_PATH: "/tmp/ffmpeg",
    FFPROBE_PATH: "/tmp/ffprobe",
  };
}

test("buildHostedFileUrl creates a stable public download path", () => {
  const url = buildHostedFileUrl("https://downloads.example.com/base", "abc123", "video file.mp4");

  assert.equal(url, "https://downloads.example.com/base/downloads/abc123/video%20file.mp4");
});

test("TemporaryFileHost cleanup removes expired hosted files", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "tele-download-host-"));
  const filePath = path.join(temporaryDirectory, "video.mp4");
  await writeFile(filePath, "hello");

  const host = new TemporaryFileHost(createRuntimeConfig(5), createTestLogger());
  const hostedFileLink = host.register({
    cleanupPath: temporaryDirectory,
    fileName: "video.mp4",
    filePath,
  });

  assert.match(hostedFileLink.url, /^https:\/\/downloads\.example\.com\/downloads\//u);
  await host.cleanupExpiredEntries(new Date(Date.now() + 10));

  await assert.rejects(() => access(filePath));
});
