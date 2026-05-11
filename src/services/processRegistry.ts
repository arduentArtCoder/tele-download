import type { ChildProcess } from "node:child_process";

export class ProcessRegistry {
  private readonly activeProcesses = new Set<ChildProcess>();

  public track<T extends ChildProcess>(childProcess: T): T {
    this.activeProcesses.add(childProcess);

    const untrack = () => {
      this.activeProcesses.delete(childProcess);
    };

    childProcess.once("close", untrack);
    childProcess.once("error", untrack);

    return childProcess;
  }

  public terminateAll(signal: NodeJS.Signals = "SIGTERM"): void {
    for (const childProcess of this.activeProcesses) {
      if (!childProcess.killed) {
        childProcess.kill(signal);
      }
    }
  }
}

export const processRegistry = new ProcessRegistry();
