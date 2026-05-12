import type { BatchItemState, BatchState } from "../types/download.js";

const STATUS_LABELS: Record<BatchItemState["status"], string> = {
  queued: "queued",
  inspecting: "inspecting",
  awaiting_selection: "awaiting selection",
  downloading: "downloading",
  probing: "probing",
  uploading: "uploading",
  hosting: "hosting",
  done: "done",
  failed: "failed",
  expired: "expired",
};

export function renderBatchProgress(batch: BatchState): string {
  const completedItems = batch.items.filter((item) => item.status === "done").length;
  const failedItems = batch.items.filter((item) => item.status === "failed").length;

  const lines = [
    `Batch ${batch.id}`,
    `${completedItems}/${batch.items.length} completed, ${failedItems} failed`,
    "",
    ...batch.items.map(renderItemLine),
  ];

  return lines.join("\n");
}

function renderItemLine(item: BatchItemState): string {
  const label = STATUS_LABELS[item.status];
  const subject = item.title ? truncate(item.title, 70) : truncate(item.url, 70);
  const details = item.error ? ` - ${truncate(item.error, 80)}` : "";

  return `${item.index}. [${label}] ${subject}${details}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
