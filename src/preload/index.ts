import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import type { BrowserBounds, LinkInfo, PageState, PingResult } from "../shared/types";

type StateHandler = (state: PageState) => void;

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
  onStateChange(handler: StateHandler): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: PageState): void => {
      handler(state);
    };

    ipcRenderer.on(IPC_CHANNELS.browserStateChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.browserStateChanged, listener);
  }
};

const debugApi = {
  ping(): Promise<PingResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.debugPing);
  }
};

contextBridge.exposeInMainWorld("crawlWeb", {
  browser: browserApi,
  debug: debugApi
});

console.info("[preload] crawlWeb API exposed");

