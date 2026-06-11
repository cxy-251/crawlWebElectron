/// <reference types="vite/client" />

import type {
  BrowserBounds,
  LinkInfo,
  PageState,
  PingResult,
  ScrollScanOptions,
  ScrollScanState,
  ScrollScanUpdate,
  SessionSummary,
  UploadLog,
  FormSyncPayload,
  VideoScanResult
} from "../shared/types";

declare global {
  interface Window {
    crawlWeb: {
      browser: {
        navigate(url: string): Promise<PageState>;
        back(): Promise<PageState>;
        forward(): Promise<PageState>;
        reload(): Promise<PageState>;
        setBounds(bounds: BrowserBounds): Promise<void>;
        getState(): Promise<PageState>;
        getUrl(): Promise<string>;
        getTitle(): Promise<string>;
        extractLinks(limit?: number): Promise<LinkInfo[]>;
        getSessionSummary(): Promise<SessionSummary>;
        getCookies(filter?: { url?: string }): Promise<any[]>;
        executeJs<T = unknown>(code: string): Promise<T>;
        onStateChange(handler: (state: PageState) => void): () => void;
      };
      media: {
        scanCurrentPage(): Promise<VideoScanResult>;
        startScrollScan(options?: ScrollScanOptions): Promise<ScrollScanState>;
        stopScrollScan(): Promise<ScrollScanState>;
        pauseScrollScan(): Promise<ScrollScanState>;
        resumeScrollScan(): Promise<ScrollScanState>;
        onScanStateChange(handler: (state: ScrollScanState) => void): () => void;
        onScrollScanUpdate(handler: (update: ScrollScanUpdate) => void): () => void;
      };
      debug: {
        ping(): Promise<PingResult>;
      };
      publish: {
        navigate(url: string): Promise<void>;
        mountVideo(filePath: string): Promise<void>;
        syncForm(payload: FormSyncPayload): Promise<void>;
        submit(platform: string): Promise<void>;
        getUserInfo(platform: string): Promise<{ username: string, avatar: string, playlists: string[] } | null>;
        onUploadLog(handler: (log: UploadLog) => void): () => void;
      };
      system: {
        selectFile(options?: any): Promise<string[]>;
      };
    };
  }
}

export {};
