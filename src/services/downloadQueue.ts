import type { Logger } from "../utils/logger.js";

export interface QueueTask {
  id: string;
  chatId: number;
  run: () => Promise<void>;
}

export class DownloadQueue {
  private readonly pendingTasks: QueueTask[] = [];
  private readonly activeChats = new Map<number, number>();
  private activeTaskCount = 0;
  private isShuttingDown = false;

  public constructor(
    private readonly maxConcurrentJobs: number,
    private readonly maxConcurrentJobsPerChat: number,
    private readonly logger: Logger,
  ) {}

  public enqueue(task: QueueTask): void {
    if (this.isShuttingDown) {
      throw new Error("Queue is shutting down and not accepting new work.");
    }

    this.pendingTasks.push(task);
    this.logger.info("Batch queued", {
      batchId: task.id,
      chatId: task.chatId,
      pendingTasks: this.pendingTasks.length,
    });
    this.pump();
  }

  public shutdown(): void {
    this.isShuttingDown = true;
    this.pendingTasks.length = 0;
  }

  private pump(): void {
    while (this.activeTaskCount < this.maxConcurrentJobs) {
      const nextTaskIndex = this.pendingTasks.findIndex((task) => {
        const activeTasksForChat = this.activeChats.get(task.chatId) ?? 0;
        return activeTasksForChat < this.maxConcurrentJobsPerChat;
      });

      if (nextTaskIndex === -1) {
        return;
      }

      const [task] = this.pendingTasks.splice(nextTaskIndex, 1);

      if (!task) {
        return;
      }

      this.startTask(task);
    }
  }

  private startTask(task: QueueTask): void {
    this.activeTaskCount += 1;
    this.activeChats.set(task.chatId, (this.activeChats.get(task.chatId) ?? 0) + 1);

    this.logger.info("Batch started", {
      activeTaskCount: this.activeTaskCount,
      batchId: task.id,
      chatId: task.chatId,
    });

    void task
      .run()
      .catch((error: unknown) => {
        this.logger.error("Queued batch failed", {
          batchId: task.id,
          chatId: task.chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.activeTaskCount -= 1;

        const remainingActiveTasksForChat = (this.activeChats.get(task.chatId) ?? 1) - 1;
        if (remainingActiveTasksForChat <= 0) {
          this.activeChats.delete(task.chatId);
        } else {
          this.activeChats.set(task.chatId, remainingActiveTasksForChat);
        }

        this.logger.info("Batch finished", {
          activeTaskCount: this.activeTaskCount,
          batchId: task.id,
          chatId: task.chatId,
        });

        this.pump();
      });
  }
}
