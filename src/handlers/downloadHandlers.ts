import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { Bot, Context } from "grammy";

import { renderBatchProgress } from "../bot/progress.js";
import type { RuntimeConfig } from "../config/index.js";
import { DownloadQueue } from "../services/downloadQueue.js";
import { MediaNormalizer } from "../services/mediaNormalizer.js";
import { TelegramDeliveryService } from "../services/telegramDelivery.js";
import { YtDlpService } from "../services/ytDlp.js";
import type { BatchItemState, BatchState, StatusMessageRef } from "../types/download.js";
import { getErrorMessage, getErrorStack } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { extractUrls } from "../utils/urls.js";

interface DownloadHandlerDependencies {
  config: RuntimeConfig;
  logger: Logger;
  queue: DownloadQueue;
  delivery: TelegramDeliveryService;
  ytDlp: YtDlpService;
  mediaNormalizer: MediaNormalizer;
}

export function registerDownloadHandlers(
  bot: Bot<Context>,
  dependencies: DownloadHandlerDependencies,
): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(getHelpText(dependencies.config.MAX_URLS_PER_BATCH));
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(getHelpText(dependencies.config.MAX_URLS_PER_BATCH));
  });

  bot.command("download", async (ctx) => {
    const text = ctx.msg?.text ?? "";
    await submitBatchFromText(ctx, text, dependencies);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg.text.trim();

    if (text.startsWith("/")) {
      return;
    }

    const urls = extractUrls(text);

    if (urls.length === 0) {
      return;
    }

    await submitBatch(ctx, urls, dependencies);
  });
}

async function submitBatchFromText(
  ctx: Context,
  text: string,
  dependencies: DownloadHandlerDependencies,
): Promise<void> {
  const urls = extractUrls(text);

  if (urls.length === 0) {
    await ctx.reply("Send one or more links after /download, or paste links in a normal message.");
    return;
  }

  await submitBatch(ctx, urls, dependencies);
}

async function submitBatch(
  ctx: Context,
  urls: string[],
  dependencies: DownloadHandlerDependencies,
): Promise<void> {
  if (!ctx.chat?.id) {
    return;
  }

  if (urls.length > dependencies.config.MAX_URLS_PER_BATCH) {
    await ctx.reply(`Please send at most ${dependencies.config.MAX_URLS_PER_BATCH} links in one batch.`);
    return;
  }

  const batch = createBatchState({
    chatId: ctx.chat.id,
    ...(typeof ctx.msg?.message_thread_id === "number"
      ? { messageThreadId: ctx.msg.message_thread_id }
      : {}),
    urls,
  });
  const statusMessage = await dependencies.delivery.sendStatus(
    batch.target,
    renderBatchProgress(batch),
  );

  dependencies.queue.enqueue({
    id: batch.id,
    chatId: batch.target.chatId,
    run: async () => {
      await processBatch(batch, statusMessage, dependencies);
    },
  });

  dependencies.logger.info("Accepted download batch", {
    batchId: batch.id,
    chatId: batch.target.chatId,
    size: batch.items.length,
  });
}

async function processBatch(
  batch: BatchState,
  statusMessage: StatusMessageRef,
  dependencies: DownloadHandlerDependencies,
): Promise<void> {
  for (const item of batch.items) {
    const temporaryDirectory = await mkdtemp(
      path.join(dependencies.config.DOWNLOAD_DIR, `${batch.id}-${item.index}-`),
    );

    try {
      setItemStatus(batch, item.index, "downloading");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      const downloadedMedia = await dependencies.ytDlp.download(item.url, temporaryDirectory);
      item.title = downloadedMedia.title;
      item.sourceHost = downloadedMedia.sourceHost;

      setItemStatus(batch, item.index, "probing");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      const preparedMedia = await dependencies.mediaNormalizer.prepareForTelegram(
        downloadedMedia.filePath,
      );
      item.fileSizeBytes = preparedMedia.sizeBytes;

      setItemStatus(batch, item.index, "uploading");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      await dependencies.delivery.sendVideo(
        batch.target,
        preparedMedia,
        buildCaption(downloadedMedia.title, downloadedMedia.sourceHost),
      );

      setItemStatus(batch, item.index, "done");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);
    } catch (error: unknown) {
      item.status = "failed";
      item.error = getErrorMessage(error);

      dependencies.logger.warn("Failed to process download item", {
        batchId: batch.id,
        error: item.error,
        itemIndex: item.index,
        stack: getErrorStack(error),
        url: item.url,
      });

      await syncStatusMessage(batch, statusMessage, dependencies.delivery);
    } finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      });
    }
  }
}

function createBatchState(options: { chatId: number; messageThreadId?: number; urls: string[] }): BatchState {
  return {
    id: createBatchId(),
    target: {
      chatId: options.chatId,
      ...(typeof options.messageThreadId === "number"
        ? { messageThreadId: options.messageThreadId }
        : {}),
    },
    createdAt: new Date(),
    items: options.urls.map<BatchItemState>((url, index) => ({
      index: index + 1,
      url,
      status: "queued",
    })),
  };
}

function setItemStatus(
  batch: BatchState,
  itemIndex: number,
  status: BatchItemState["status"],
): void {
  const item = batch.items.find((entry) => entry.index === itemIndex);

  if (!item) {
    return;
  }

  item.status = status;

  if (status !== "failed") {
    delete item.error;
  }
}

async function syncStatusMessage(
  batch: BatchState,
  statusMessage: StatusMessageRef,
  delivery: TelegramDeliveryService,
): Promise<void> {
  await delivery.editStatus(statusMessage, renderBatchProgress(batch));
}

function buildCaption(title: string, sourceHost: string): string {
  return `${truncate(title, 900)}\nSource: ${sourceHost}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function createBatchId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function getHelpText(maxUrlsPerBatch: number): string {
  return [
    "Send one or more supported video links and I will download them for you.",
    "",
    "Commands:",
    "/start - show this message",
    "/help - show this message again",
    "/download <url1> <url2> ... - explicitly start a batch",
    "",
    "Tips:",
    `- Paste up to ${maxUrlsPerBatch} links in one message`,
    "- Links are processed sequentially per chat",
    "- Only allowed user IDs can use this bot",
  ].join("\n");
}
