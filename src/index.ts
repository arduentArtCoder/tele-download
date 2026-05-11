import { createBot } from "./bot/createBot.js";

const app = await createBot();

let isShuttingDown = false;

const stop = (signal: NodeJS.Signals) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  app.logger.info("Shutting down bot", { signal });
  app.shutdown();
  app.bot.stop();
};

process.once("SIGINT", () => {
  stop("SIGINT");
});

process.once("SIGTERM", () => {
  stop("SIGTERM");
});

await app.bot.start({
  onStart(botInfo) {
    app.logger.info("Bot started", {
      botId: botInfo.id,
      username: botInfo.username,
    });
  },
});
