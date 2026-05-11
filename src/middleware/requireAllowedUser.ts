import type { Context, MiddlewareFn } from "grammy";

import { ALLOWED_USERS } from "../config/allowedUsers.js";
import type { Logger } from "../utils/logger.js";

const allowedUserIds = new Set(ALLOWED_USERS);

export function requireAllowedUser(logger: Logger): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId || !allowedUserIds.has(userId)) {
      logger.info("Ignoring update from unauthorized user", {
        updateId: ctx.update.update_id,
        userId: userId ?? null,
      });
      return;
    }

    await next();
  };
}
