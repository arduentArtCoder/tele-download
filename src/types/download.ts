export type BatchItemStatus =
  | "queued"
  | "downloading"
  | "probing"
  | "uploading"
  | "done"
  | "failed";

export interface BatchItemState {
  index: number;
  url: string;
  status: BatchItemStatus;
  title?: string;
  sourceHost?: string;
  fileSizeBytes?: number;
  error?: string;
}

export interface ChatTarget {
  chatId: number;
  messageThreadId?: number;
}

export interface BatchState {
  id: string;
  target: ChatTarget;
  items: BatchItemState[];
  createdAt: Date;
}

export interface DownloadedMedia {
  title: string;
  sourceHost: string;
  sourceUrl: string;
  filePath: string;
  fileName: string;
}

export interface MediaProbeResult {
  filePath: string;
  containerName: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sizeBytes: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface PreparedMedia extends MediaProbeResult {
  fileName: string;
}

export interface StatusMessageRef {
  chatId: number;
  messageId: number;
}
