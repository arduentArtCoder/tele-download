import type { Logger } from "../utils/logger.js";

export function createTestLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}
