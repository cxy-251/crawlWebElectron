export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
};

export type LinkInfo = {
  text: string;
  href: string;
};

export type SessionSummary = {
  partition: string;
  persistent: boolean;
  storage: string;
  locationHint: string;
};

export type VideoCandidateStatus =
  | "discovered"
  | "selected"
  | "queued"
  | "paused_for_manual_action"
  | "ready_for_future_download"
  | "failed_to_extract";

export type VideoExtractionMethod = "dom-video" | "dom-source" | "video-card-link" | "provider-adapter";

export type VideoCandidate = {
  id: string;
  sourcePageUrl: string;
  provider: string;
  title: string;
  pageUrl: string;
  mediaUrl: string;
  thumbnailUrl: string;
  durationText: string;
  extractionMethod: VideoExtractionMethod;
  confidence: number;
  status: VideoCandidateStatus;
};

export type VideoScanResult = {
  sourcePageUrl: string;
  provider: string;
  title: string;
  candidates: VideoCandidate[];
  duplicateHintCount: number;
  manualActionDetected: boolean;
  manualActionReason: string;
  scannedAt: string;
};

export type ScanStatus = "idle" | "scanning" | "paused" | "stopped" | "error";

export type ScrollScanOptions = {
  maxRounds?: number;
  intervalMs?: number;
};

export type ScrollScanState = {
  status: ScanStatus;
  round: number;
  maxRounds: number;
  reason: string;
};

export type ScrollScanUpdate = {
  round: number;
  state: ScrollScanState;
  result: VideoScanResult;
};

export type QueueItem = {
  id: string;
  candidate: VideoCandidate;
  status: VideoCandidateStatus;
  addedAt: string;
};

export type PingResult = {
  message: "pong";
  at: string;
  page: PageState;
};
