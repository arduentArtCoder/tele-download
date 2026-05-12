import { InlineKeyboard, InputFile, type Api } from "grammy";

import type {
  ChatTarget,
  PreparedMedia,
  SelectionButton,
  StatusMessageRef,
} from "../types/download.js";

export class TelegramDeliveryService {
  public constructor(private readonly api: Api) {}

  public async sendStatus(target: ChatTarget, text: string): Promise<StatusMessageRef> {
    const message = await this.api.sendMessage(target.chatId, text, getTargetOptions(target));

    return {
      chatId: target.chatId,
      messageId: message.message_id,
    };
  }

  public async editStatus(statusMessage: StatusMessageRef, text: string): Promise<void> {
    await this.editMessageText(statusMessage, text);
  }

  public async sendSelectionPrompt(
    target: ChatTarget,
    text: string,
    buttons: SelectionButton[],
  ): Promise<StatusMessageRef> {
    const keyboard = new InlineKeyboard();

    for (const button of buttons) {
      keyboard.text(button.text, `pick:${button.token}`).row();
    }

    const message = await this.api.sendMessage(target.chatId, text, {
      ...getTargetOptions(target),
      reply_markup: keyboard,
    });

    return {
      chatId: target.chatId,
      messageId: message.message_id,
    };
  }

  public async resolveSelectionPrompt(statusMessage: StatusMessageRef, text: string): Promise<void> {
    await this.editMessageText(statusMessage, text, {
      reply_markup: {
        inline_keyboard: [],
      },
    });
  }

  public async expireSelectionPrompt(statusMessage: StatusMessageRef, text: string): Promise<void> {
    await this.editMessageText(statusMessage, text, {
      reply_markup: {
        inline_keyboard: [],
      },
    });
  }

  public async sendHostedDownloadLink(
    target: ChatTarget,
    text: string,
  ): Promise<void> {
    await this.api.sendMessage(target.chatId, text, {
      ...getTargetOptions(target),
      link_preview_options: {
        is_disabled: true,
      },
    });
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
      ...getTargetOptions(target),
    });
  }

  private async editMessageText(
    statusMessage: StatusMessageRef,
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.api.editMessageText(statusMessage.chatId, statusMessage.messageId, text, extra);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  }
}

function getTargetOptions(target: ChatTarget): Record<string, number> {
  if (typeof target.messageThreadId === "number") {
    return {
      message_thread_id: target.messageThreadId,
    };
  }

  return {};
}
