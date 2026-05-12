import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { DownloadOption } from "../types/download.js";
import { UserVisibleError } from "../utils/errors.js";
import { createTestLogger } from "../test/testLogger.js";
import { SelectionRegistry } from "./selectionRegistry.js";

const OPTIONS: DownloadOption[] = [
  {
    id: "option-1",
    label: "1080p • 42 MB • Telegram",
    formatSelector: "22",
    deliveryMode: "telegram",
    estimatedSizeBytes: 42 * 1024 * 1024,
    height: 1080,
    width: 1920,
  },
  {
    id: "option-2",
    label: "2160p • 82 MB • 1h link",
    formatSelector: "401+bestaudio/best",
    deliveryMode: "link",
    estimatedSizeBytes: 82 * 1024 * 1024,
    height: 2160,
    width: 3840,
  },
];

test("SelectionRegistry resolves the chosen option for the owning user", async () => {
  const registry = new SelectionRegistry(1_000, createTestLogger());
  const pendingSelection = registry.create(123, OPTIONS);
  const firstToken = pendingSelection.buttons[0]?.token;

  assert.ok(firstToken);
  assert.deepEqual(registry.choose(firstToken, 999), { status: "forbidden" });

  const selectionResult = registry.choose(firstToken, 123);
  assert.equal(selectionResult.status, "selected");
  assert.equal(selectionResult.option.id, "option-1");

  const resolvedOption = await pendingSelection.waitForChoice;
  assert.equal(resolvedOption.id, "option-1");

  registry.shutdown();
});

test("SelectionRegistry expires stale selections and rejects later callbacks", async () => {
  const registry = new SelectionRegistry(25, createTestLogger());
  const pendingSelection = registry.create(123, OPTIONS);
  const firstToken = pendingSelection.buttons[0]?.token;
  const waitForChoice = pendingSelection.waitForChoice;

  assert.ok(firstToken);
  void waitForChoice.catch(() => {});
  await delay(40);

  await assert.rejects(waitForChoice, (error: unknown) => {
    return error instanceof UserVisibleError && error.code === "SELECTION_EXPIRED";
  });

  assert.deepEqual(registry.choose(firstToken, 123), { status: "invalid" });
  registry.shutdown();
});
