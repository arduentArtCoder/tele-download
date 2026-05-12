import { randomBytes } from "node:crypto";

import type { DownloadOption, SelectionButton } from "../types/download.js";
import { UserVisibleError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";

interface PendingSelection {
  userId: number;
  expiresAt: Date;
  optionByToken: Map<string, DownloadOption>;
  reject: (reason?: unknown) => void;
  resolve: (value: DownloadOption) => void;
  timeout: NodeJS.Timeout;
}

export interface PendingSelectionHandle {
  buttons: SelectionButton[];
  expiresAt: Date;
  waitForChoice: Promise<DownloadOption>;
}

export type SelectionConsumeResult =
  | { status: "selected"; option: DownloadOption }
  | { status: "invalid" }
  | { status: "forbidden" };

export class SelectionRegistry {
  private readonly pendingSelections = new Map<string, PendingSelection>();

  public constructor(
    private readonly selectionTtlMs: number,
    private readonly logger: Logger,
  ) {}

  public create(userId: number, options: DownloadOption[]): PendingSelectionHandle {
    const expiresAt = new Date(Date.now() + this.selectionTtlMs);
    let resolveChoice!: (value: DownloadOption) => void;
    let rejectChoice!: (reason?: unknown) => void;

    const waitForChoice = new Promise<DownloadOption>((resolve, reject) => {
      resolveChoice = resolve;
      rejectChoice = reject;
    });

    const optionByToken = new Map<string, DownloadOption>();

    for (const option of options) {
      optionByToken.set(createOpaqueToken(), option);
    }

    const timeout = setTimeout(() => {
      for (const token of optionByToken.keys()) {
        this.pendingSelections.delete(token);
      }

      rejectChoice(
        new UserVisibleError(
          "The format selection expired before a choice was made.",
          "SELECTION_EXPIRED",
        ),
      );
    }, this.selectionTtlMs);
    timeout.unref?.();

    for (const [token] of optionByToken) {
      this.pendingSelections.set(token, {
        userId,
        expiresAt,
        optionByToken,
        reject: rejectChoice,
        resolve: resolveChoice,
        timeout,
      });
    }

    this.logger.debug("Selection created", {
      choiceCount: options.length,
      expiresAt: expiresAt.toISOString(),
      userId,
    });

    return {
      buttons: [...optionByToken.entries()].map(([token, option]) => ({
        text: option.label,
        token,
      })),
      expiresAt,
      waitForChoice,
    };
  }

  public choose(token: string, userId: number): SelectionConsumeResult {
    const pendingSelection = this.pendingSelections.get(token);

    if (!pendingSelection) {
      return { status: "invalid" };
    }

    if (pendingSelection.userId !== userId) {
      return { status: "forbidden" };
    }

    const selectedOption = pendingSelection.optionByToken.get(token);

    if (!selectedOption) {
      return { status: "invalid" };
    }

    this.clearPendingSelection(pendingSelection);
    pendingSelection.resolve(selectedOption);

    return {
      status: "selected",
      option: selectedOption,
    };
  }

  public shutdown(): void {
    const uniqueSelections = new Set(this.pendingSelections.values());

    for (const selection of uniqueSelections) {
      this.clearPendingSelection(selection);
      selection.reject(new Error("Selection registry is shutting down."));
    }
  }

  private clearPendingSelection(selection: PendingSelection): void {
    clearTimeout(selection.timeout);

    for (const token of selection.optionByToken.keys()) {
      this.pendingSelections.delete(token);
    }
  }
}

function createOpaqueToken(): string {
  return randomBytes(9).toString("base64url");
}
