import { InputFile, type Api } from "grammy";

import type { ChatTarget, PreparedMedia, StatusMessageRef } from "../types/download.js";

export class TelegramDeliveryService {
  public constructor(private readonly api: Api) {}

  public async sendStatus(target: ChatTarget, text: string): Promise<StatusMessageRef> {
    const message = await this.api.sendMessage(target.chatId, text, {
      ...(typeof target.messageThreadId === "number"
        ? { message_thread_id: target.messageThreadId }
        : {}),
    });

    return {
      chatId: target.chatId,
      messageId: message.message_id,
    };
  }

  public async editStatus(statusMessage: StatusMessageRef, text: string): Promise<void> {
    try {
      await this.api.editMessageText(statusMessage.chatId, statusMessage.messageId, text);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  }

  public async sendVideo(
    target: ChatTarget,
    media: PreparedMedia,
    caption: string,
  ): Promise<void> {
    await this.api.sendVideo(target.chatId, new InputFile(media.filePath, media.fileName), {
      caption,
      supports_streaming: true,
      ...(typeof media.durationSeconds === "number"
        ? { duration: Math.round(media.durationSeconds) }
        : {}),
      ...(typeof media.width === "number" ? { width: media.width } : {}),
      ...(typeof media.height === "number" ? { height: media.height } : {}),
      ...(typeof target.messageThreadId === "number"
        ? { message_thread_id: target.messageThreadId }
        : {}),
    });
  }
}
