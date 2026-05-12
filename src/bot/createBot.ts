import { Bot, type Context } from "grammy";

import { env, type RuntimeConfig } from "../config/index.js";
import { registerDownloadHandlers } from "../handlers/downloadHandlers.js";
import { requireAllowedUser } from "../middleware/requireAllowedUser.js";
import { DownloadQueue } from "../services/downloadQueue.js";
import { FfprobeService } from "../services/ffprobe.js";
import { MediaNormalizer } from "../services/mediaNormalizer.js";
import { processRegistry } from "../services/processRegistry.js";
import { SelectionRegistry } from "../services/selectionRegistry.js";
import { TelegramDeliveryService } from "../services/telegramDelivery.js";
import { TemporaryFileHost } from "../services/temporaryFileHost.js";
import { validateRuntime } from "../services/runtimeValidator.js";
import { YtDlpService } from "../services/ytDlp.js";
import { createLogger, type Logger } from "../utils/logger.js";

export interface AppInstance {
  bot: Bot<Context>;
  logger: Logger;
  shutdown(): void;
}

export async function createBot(config: RuntimeConfig = env): Promise<AppInstance> {
  const logger = createLogger(config.LOG_LEVEL);
  await validateRuntime(config, logger);

  const bot = new Bot<Context>(config.BOT_TOKEN);
  const queue = new DownloadQueue(config.MAX_CONCURRENT_JOBS, 1, logger);
  const ffprobeService = new FfprobeService(logger);
  const mediaNormalizer = new MediaNormalizer(ffprobeService, logger);
  const ytDlpService = new YtDlpService(config, logger);
  const deliveryService = new TelegramDeliveryService(bot.api);
  const selectionRegistry = new SelectionRegistry(config.SELECTION_TTL_MS, logger);
  const temporaryFileHost = new TemporaryFileHost(config, logger);
  await temporaryFileHost.start();

  bot.use(requireAllowedUser(logger));

  registerDownloadHandlers(bot, {
    config,
    logger,
    queue,
    delivery: deliveryService,
    selectionRegistry,
    temporaryFileHost,
    ytDlp: ytDlpService,
    mediaNormalizer,
  });

  bot.catch((error) => {
    logger.error("Unhandled bot error", {
      error: error.error instanceof Error ? error.error.message : String(error.error),
      updateId: error.ctx.update.update_id,
    });
  });

  return {
    bot,
    logger,
    shutdown() {
      queue.shutdown();
      selectionRegistry.shutdown();
      processRegistry.terminateAll();
      void temporaryFileHost.stop();
    },
  };
}
