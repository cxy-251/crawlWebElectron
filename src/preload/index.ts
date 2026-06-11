import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipcChannels";
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

type StateHandler = (state: PageState) => void;
type ScanStateHandler = (state: ScrollScanState) => void;
type ScrollScanUpdateHandler = (update: ScrollScanUpdate) => void;
type UploadLogHandler = (log: UploadLog) => void;

const browserApi = {
  navigate(url: string): Promise<PageState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserNavigate, url);
  },
  back(): Promise<PageState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserBack);
  },
  forward(): Promise<PageState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserForward);
  },
  reload(): Promise<PageState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserReload);
  },
  setBounds(bounds: BrowserBounds): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserSetBounds, bounds);
  },
  getState(): Promise<PageState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGetState);
  },
  getUrl(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGetUrl);
  },
  getTitle(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGetTitle);
  },
  extractLinks(limit = 100): Promise<LinkInfo[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserExtractLinks, limit);
  },
  getSessionSummary(): Promise<SessionSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGetSessionSummary);
  },
  getCookies(filter?: { url?: string }): Promise<unknown[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGetCookies, filter);
  },
  executeJs<T = unknown>(code: string): Promise<T> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserExecuteJs, code);
  },
  onStateChange(handler: StateHandler): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: PageState): void => {
      handler(state);
    };

    ipcRenderer.on(IPC_CHANNELS.browserStateChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.browserStateChanged, listener);
  }
};

const mediaApi = {
  scanCurrentPage(): Promise<VideoScanResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.mediaScanCurrentPage);
  },
  startScrollScan(options?: ScrollScanOptions): Promise<ScrollScanState> {
    return ipcRenderer.invoke(IPC_CHANNELS.mediaStartScrollScan, options);
  },
  stopScrollScan(): Promise<ScrollScanState> {
    return ipcRenderer.invoke(IPC_CHANNELS.mediaStopScrollScan);
  },
  pauseScrollScan(): Promise<ScrollScanState> {
    return ipcRenderer.invoke(IPC_CHANNELS.mediaPauseScrollScan);
  },
  resumeScrollScan(): Promise<ScrollScanState> {
    return ipcRenderer.invoke(IPC_CHANNELS.mediaResumeScrollScan);
  },
  onScanStateChange(handler: ScanStateHandler): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: ScrollScanState): void => {
      handler(state);
    };

    ipcRenderer.on(IPC_CHANNELS.mediaScanStateChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.mediaScanStateChanged, listener);
  },
  onScrollScanUpdate(handler: ScrollScanUpdateHandler): () => void {
    const listener = (_event: Electron.IpcRendererEvent, update: ScrollScanUpdate): void => {
      handler(update);
    };

    ipcRenderer.on(IPC_CHANNELS.mediaScrollScanUpdate, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.mediaScrollScanUpdate, listener);
  }
};

const debugApi = {
  ping(): Promise<PingResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.debugPing);
  }
};

const publishApi = {
  navigate(url: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.publishNavigate, url);
  },
  mountVideo(filePath: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.publishMountVideo, filePath);
  },
  syncForm(payload: FormSyncPayload): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.publishSyncForm, payload);
  },
  submit(platform: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.publishSubmit, platform);
  },
  getUserInfo(platform: string): Promise<{ username: string, avatar: string, playlists: string[] } | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.publishGetUserInfo, platform);
  },
  onUploadLog(handler: UploadLogHandler): () => void {
    const listener = (_event: Electron.IpcRendererEvent, log: UploadLog): void => {
      handler(log);
    };

    ipcRenderer.on(IPC_CHANNELS.publishUploadLog, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.publishUploadLog, listener);
  }
};

const systemApi = {
  selectFile(options?: Electron.OpenDialogOptions): Promise<string[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.dialogSelectFile, options);
  }
};

contextBridge.exposeInMainWorld("crawlWeb", {
  browser: browserApi,
  media: mediaApi,
  debug: debugApi,
  publish: publishApi,
  system: systemApi
});

console.info("[preload] crawlWeb API exposed");
