export type BatchItemStatus =
  | "queued"
  | "inspecting"
  | "awaiting_selection"
  | "downloading"
  | "probing"
  | "uploading"
  | "hosting"
  | "done"
  | "failed"
  | "expired";

export type DeliveryMode = "telegram" | "link";

export interface DownloadOption {
  id: string;
  label: string;
  formatSelector: string;
  deliveryMode: DeliveryMode;
  estimatedSizeBytes?: number;
  height?: number;
  width?: number;
}

export interface BatchItemState {
  index: number;
  url: string;
  status: BatchItemStatus;
  title?: string;
  sourceHost?: string;
  fileSizeBytes?: number;
  availableOptions?: DownloadOption[];
  selectedOptionId?: string;
  selectionExpiresAt?: Date;
  hostedDownloadUrl?: string;
  error?: string;
}

export interface ChatTarget {
  chatId: number;
  messageThreadId?: number;
}

export interface BatchState {
  id: string;
  target: ChatTarget;
  requesterUserId: number;
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

export interface InspectedMedia {
  title: string;
  sourceHost: string;
  sourceUrl: string;
  options: DownloadOption[];
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

export interface SelectionButton {
  text: string;
  token: string;
}

export interface HostedFileLink {
  token: string;
  url: string;
  expiresAt: Date;
}
