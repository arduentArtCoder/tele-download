import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { InputFile, type Bot, type Context } from "grammy";

import { renderBatchProgress } from "../bot/progress.js";
import type { RuntimeConfig } from "../config/index.js";
import { DownloadQueue } from "../services/downloadQueue.js";
import { MediaNormalizer } from "../services/mediaNormalizer.js";
import { SelectionRegistry } from "../services/selectionRegistry.js";
import { TelegramDeliveryService } from "../services/telegramDelivery.js";
import { TemporaryFileHost } from "../services/temporaryFileHost.js";
import { getDeliveryModeForSize, YtDlpService } from "../services/ytDlp.js";
import type {
  BatchItemState,
  BatchState,
  DownloadOption,
  HostedFileLink,
  StatusMessageRef,
} from "../types/download.js";
import { UserVisibleError, getErrorMessage, getErrorStack } from "../utils/errors.js";
import { formatBinarySize } from "../utils/formatting.js";
import type { Logger } from "../utils/logger.js";
import { extractUrls } from "../utils/urls.js";

interface DownloadHandlerDependencies {
  config: RuntimeConfig;
  logger: Logger;
  queue: DownloadQueue;
  delivery: TelegramDeliveryService;
  selectionRegistry: SelectionRegistry;
  temporaryFileHost: TemporaryFileHost;
  ytDlp: YtDlpService;
  mediaNormalizer: MediaNormalizer;
}

const MAJOR_SOURCE_RULES = [
  { label: "YouTube", matchers: ["youtube", "youtubelivestreamembed", "youtubeytbe"] },
  { label: "Instagram", matchers: ["instagram", "instagramios"] },
  { label: "TikTok", matchers: ["tiktok", "vm.tiktok"] },
  { label: "X / Twitter", matchers: ["twitter"] },
  { label: "Facebook", matchers: ["facebook"] },
  { label: "Reddit", matchers: ["reddit"] },
  { label: "Vimeo", matchers: ["vimeo"] },
  { label: "Dailymotion", matchers: ["dailymotion"] },
  { label: "Twitch", matchers: ["twitch"] },
  { label: "SoundCloud", matchers: ["soundcloud"] },
] as const;

const PICK_CALLBACK_PREFIX = "pick:";

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

  bot.command("supported", async (ctx) => {
    try {
      const extractors = await dependencies.ytDlp.listSupportedExtractors();
      await ctx.reply(buildSupportedSummary(extractors));
      await ctx.replyWithDocument(
        new InputFile(
          Buffer.from(buildSupportedDocument(extractors), "utf8"),
          "yt-dlp-supported-extractors.txt",
        ),
        {
          caption: "Live supported extractor list from the system yt-dlp installation.",
        },
      );
    } catch (error: unknown) {
      dependencies.logger.warn("Failed to load supported extractors", {
        error: getErrorMessage(error),
        stack: getErrorStack(error),
      });

      await ctx.reply("I could not load the supported source list from yt-dlp right now.");
    }
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

  bot.callbackQuery(new RegExp(`^${PICK_CALLBACK_PREFIX}`), async (ctx) => {
    const token = ctx.callbackQuery.data.slice(PICK_CALLBACK_PREFIX.length);
    const userId = ctx.from?.id;

    if (typeof userId !== "number") {
      return;
    }

    const result = dependencies.selectionRegistry.choose(token, userId);

    if (result.status === "selected") {
      await ctx.api.answerCallbackQuery(ctx.callbackQuery.id, {
        text: `Selected ${result.option.label}. Starting download.`,
      });
      return;
    }

    if (result.status === "forbidden") {
      await ctx.api.answerCallbackQuery(ctx.callbackQuery.id, {
        show_alert: true,
        text: "This format picker belongs to a different request.",
      });
      return;
    }

    await ctx.api.answerCallbackQuery(ctx.callbackQuery.id, {
      show_alert: true,
      text: "That format picker is no longer active. Send the link again for a fresh choice.",
    });
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
  if (!ctx.chat?.id || typeof ctx.from?.id !== "number") {
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
    requesterUserId: ctx.from.id,
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
    let selectionMessage: StatusMessageRef | undefined;
    let temporaryDirectory: string | undefined;
    let shouldDeleteTemporaryDirectory = true;

    try {
      setItemStatus(batch, item.index, "inspecting");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      const inspectedMedia = await dependencies.ytDlp.inspectFormats(item.url);
      item.title = inspectedMedia.title;
      item.sourceHost = inspectedMedia.sourceHost;
      item.availableOptions = inspectedMedia.options;

      const pendingSelection = dependencies.selectionRegistry.create(
        batch.requesterUserId,
        inspectedMedia.options,
      );

      item.selectionExpiresAt = pendingSelection.expiresAt;
      setItemStatus(batch, item.index, "awaiting_selection");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      selectionMessage = await dependencies.delivery.sendSelectionPrompt(
        batch.target,
        buildSelectionPrompt(item, pendingSelection.expiresAt),
        pendingSelection.buttons,
      );

      const selectedOption = await pendingSelection.waitForChoice;
      item.selectedOptionId = selectedOption.id;
      delete item.selectionExpiresAt;

      await dependencies.delivery.resolveSelectionPrompt(
        selectionMessage,
        buildSelectionConfirmedMessage(item, selectedOption),
      );

      temporaryDirectory = await mkdtemp(
        path.join(dependencies.config.DOWNLOAD_DIR, `${batch.id}-${item.index}-`),
      );

      setItemStatus(batch, item.index, "downloading");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      const downloadedMedia = await dependencies.ytDlp.download(
        item.url,
        selectedOption.formatSelector,
        temporaryDirectory,
      );

      item.title = downloadedMedia.title;
      item.sourceHost = downloadedMedia.sourceHost;

      setItemStatus(batch, item.index, "probing");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);

      const preparedMedia = await dependencies.mediaNormalizer.prepareForDelivery(
        downloadedMedia.filePath,
      );
      item.fileSizeBytes = preparedMedia.sizeBytes;

      if (getDeliveryModeForSize(preparedMedia.sizeBytes, dependencies.config.MAX_UPLOAD_BYTES) === "telegram") {
        setItemStatus(batch, item.index, "uploading");
        await syncStatusMessage(batch, statusMessage, dependencies.delivery);

        await dependencies.delivery.sendVideo(
          batch.target,
          preparedMedia,
          buildCaption(downloadedMedia.title, downloadedMedia.sourceHost),
        );
      } else {
        setItemStatus(batch, item.index, "hosting");
        await syncStatusMessage(batch, statusMessage, dependencies.delivery);

        const hostedFileLink = dependencies.temporaryFileHost.register({
          cleanupPath: temporaryDirectory,
          fileName: preparedMedia.fileName,
          filePath: preparedMedia.filePath,
        });

        shouldDeleteTemporaryDirectory = false;
        item.hostedDownloadUrl = hostedFileLink.url;

        await dependencies.delivery.sendHostedDownloadLink(
          batch.target,
          buildHostedLinkMessage(downloadedMedia.title, downloadedMedia.sourceHost, preparedMedia.sizeBytes, hostedFileLink),
        );
      }

      setItemStatus(batch, item.index, "done");
      await syncStatusMessage(batch, statusMessage, dependencies.delivery);
    } catch (error: unknown) {
      if (error instanceof UserVisibleError && error.code === "SELECTION_EXPIRED") {
        item.status = "expired";
        item.error = error.message;

        if (selectionMessage) {
          await dependencies.delivery.expireSelectionPrompt(
            selectionMessage,
            buildExpiredSelectionMessage(item),
          );
        }

        await syncStatusMessage(batch, statusMessage, dependencies.delivery);
        continue;
      }

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
      if (shouldDeleteTemporaryDirectory && temporaryDirectory) {
        await rm(temporaryDirectory, {
          force: true,
          recursive: true,
        });
      }
    }
  }
}

function createBatchState(options: {
  chatId: number;
  messageThreadId?: number;
  requesterUserId: number;
  urls: string[];
}): BatchState {
  return {
    id: createBatchId(),
    target: {
      chatId: options.chatId,
      ...(typeof options.messageThreadId === "number"
        ? { messageThreadId: options.messageThreadId }
        : {}),
    },
    requesterUserId: options.requesterUserId,
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

  if (status !== "failed" && status !== "expired") {
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

function buildSelectionPrompt(item: BatchItemState, expiresAt: Date): string {
  return [
    `Choose a format for item ${item.index}:`,
    truncate(item.title ?? item.url, 200),
    `Source: ${item.sourceHost ?? "unknown-source"}`,
    `Selection expires at ${formatTimestamp(expiresAt)} UTC.`,
    "",
    "Buttons marked Telegram should upload directly here.",
    "Buttons marked 1h link will send a temporary download URL instead.",
  ].join("\n");
}

function buildSelectionConfirmedMessage(item: BatchItemState, selectedOption: DownloadOption): string {
  return [
    `Selected format for item ${item.index}:`,
    truncate(item.title ?? item.url, 200),
    selectedOption.label,
    "Download started.",
  ].join("\n");
}

function buildExpiredSelectionMessage(item: BatchItemState): string {
  return [
    `Selection expired for item ${item.index}:`,
    truncate(item.title ?? item.url, 200),
    "Send the link again when you want to retry this download.",
  ].join("\n");
}

function buildHostedLinkMessage(
  title: string,
  sourceHost: string,
  sizeBytes: number,
  hostedFileLink: HostedFileLink,
): string {
  return [
    `Your file is ready: ${truncate(title, 120)}`,
    `Source: ${sourceHost}`,
    `Size: ${formatBinarySize(sizeBytes)}`,
    `Available until ${formatTimestamp(hostedFileLink.expiresAt)} UTC`,
    hostedFileLink.url,
  ].join("\n");
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

function formatTimestamp(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "");
}

function getHelpText(maxUrlsPerBatch: number): string {
  return [
    "Send one or more supported video links and I will inspect the available download sizes first.",
    "",
    "Commands:",
    "/start - show this message",
    "/help - show this message again",
    "/supported - show the live yt-dlp supported source list",
    "/download <url1> <url2> ... - explicitly start a batch",
    "",
    "Tips:",
    `- Paste up to ${maxUrlsPerBatch} links in one message`,
    "- Pick a format from the inline buttons for each link",
    "- Files bigger than 50 MB are sent as 1-hour download links",
    "- Links are processed sequentially per chat",
    "- Only allowed user IDs can use this bot",
  ].join("\n");
}

function buildSupportedSummary(extractors: string[]): string {
  const featuredSources = getFeaturedSources(extractors);

  return [
    `yt-dlp currently reports ${extractors.length} extractors.`,
    featuredSources.length > 0
      ? `Major sources: ${featuredSources.join(", ")}.`
      : "Major sources are available in the attached live list.",
    "I attached the full live supported-source list as a text file.",
    "Some entries may be marked CURRENTLY BROKEN by yt-dlp itself.",
  ].join("\n");
}

function buildSupportedDocument(extractors: string[]): string {
  return [
    `yt-dlp supported extractors (${extractors.length})`,
    "",
    ...extractors,
    "",
  ].join("\n");
}

function getFeaturedSources(extractors: string[]): string[] {
  const normalizedExtractors = new Set(extractors.map((extractor) => extractor.toLowerCase()));

  return MAJOR_SOURCE_RULES.filter((rule) =>
    rule.matchers.some((matcher) => normalizedExtractors.has(matcher)),
  ).map((rule) => rule.label);
}
