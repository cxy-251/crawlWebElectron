import { BrowserView, BrowserWindow } from "electron";
import type {
  BrowserBounds,
  LinkInfo,
  PageState,
  ScrollScanOptions,
  ScrollScanState,
  SessionSummary,
  VideoScanResult
} from "../shared/types";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { logger, safeUrl } from "./logger";
import { getScrollMetrics, scanVideoCandidates, scrollPage } from "./mediaScanner";
import { normalizeNavigationUrl } from "./navigation";

const DEFAULT_URL = "https://example.com";
const SESSION_PARTITION = "persist:crawl-web-electron";
const DEFAULT_SCROLL_OPTIONS = {
  intervalMs: 1200,
  maxRounds: 12
};

function clampBounds(bounds: BrowserBounds): BrowserBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  };
}

function linkLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(500, Math.round(limit)));
}

export class WebViewController {
  private readonly view: BrowserView;
  private isLoading = false;
  private scanState: ScrollScanState = {
    status: "idle",
    round: 0,
    maxRounds: 0,
    reason: "Ready"
  };
  private scanRunId = 0;
  private lastScrollOptions: Required<ScrollScanOptions> = DEFAULT_SCROLL_OPTIONS;

  constructor(private readonly window: BrowserWindow) {
    this.view = new BrowserView({
      webPreferences: {
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    this.window.setBrowserView(this.view);
    this.view.setAutoResize({ width: false, height: false });
    this.configureWebContents();

    logger.info("browser-view", "created", { partition: SESSION_PARTITION });
    void this.navigate(DEFAULT_URL).catch((error: Error) => {
      logger.error("browser-view", "failed to load default page", { error: error.message });
    });
  }

  setBounds(bounds: BrowserBounds): void {
    const safeBounds = clampBounds(bounds);
    this.view.setBounds(safeBounds);
  }

  getState(): PageState {
    const webContents = this.view.webContents;

    return {
      url: webContents.getURL(),
      title: webContents.getTitle(),
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      isLoading: this.isLoading
    };
  }

  getSessionSummary(): SessionSummary {
    return {
      partition: SESSION_PARTITION,
      persistent: true,
      storage: "Chromium/Electron profile data: cookies, localStorage, IndexedDB and cache.",
      locationHint: "System application data directory; not stored in this Git repository."
    };
  }

  async navigate(input: string): Promise<PageState> {
    const url = normalizeNavigationUrl(input);
    logger.info("browser-view", "navigate", { url });
    await this.view.webContents.loadURL(url);
    return this.getState();
  }

  goBack(): PageState {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      logger.info("browser-view", "go back");
      this.view.webContents.navigationHistory.goBack();
    }

    return this.getState();
  }

  goForward(): PageState {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      logger.info("browser-view", "go forward");
      this.view.webContents.navigationHistory.goForward();
    }

    return this.getState();
  }

  reload(): PageState {
    logger.info("browser-view", "reload", { url: this.view.webContents.getURL() });
    this.view.webContents.reload();
    return this.getState();
  }

  getUrl(): string {
    return this.view.webContents.getURL();
  }

  getTitle(): string {
    return this.view.webContents.getTitle();
  }

  async extractLinks(limit?: number): Promise<LinkInfo[]> {
    const safeLimit = linkLimit(limit);
    logger.info("browser-view", "extract links", { limit: safeLimit, url: this.getUrl() });

    const script = `
      (() => Array
        .from(document.querySelectorAll("a[href]"))
        .slice(0, ${safeLimit})
        .map((anchor) => {
          const label = anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || anchor.href;
          return {
            text: String(label || "").trim().replace(/\\s+/g, " ").slice(0, 160),
            href: anchor.href
          };
        }))()
    `;

    try {
      const result = await this.view.webContents.executeJavaScript(script, true);

      if (!Array.isArray(result)) {
        return [];
      }

      return result
        .filter((item): item is LinkInfo => Boolean(item && typeof item.text === "string" && typeof item.href === "string"))
        .slice(0, safeLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("browser-view", "extract links failed", { error: message, url: this.getUrl() });
      throw error;
    }
  }

  async scanCurrentPage(): Promise<VideoScanResult> {
    logger.info("media", "scan current page", { url: this.getUrl() });

    try {
      const result = await scanVideoCandidates(this.view.webContents);
      logger.info("media", "scan completed", {
        url: result.sourcePageUrl,
        candidates: result.candidates.length,
        duplicates: result.duplicateHintCount,
        manualActionDetected: result.manualActionDetected
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("media", "scan failed", { error: message, url: this.getUrl() });
      throw error;
    }
  }

  getScrollScanState(): ScrollScanState {
    return this.scanState;
  }

  startScrollScan(options?: ScrollScanOptions): ScrollScanState {
    if (this.scanState.status === "scanning") {
      logger.warn("media", "scroll scan already running");
      return this.scanState;
    }

    const safeOptions = this.normalizeScrollOptions(options);
    this.lastScrollOptions = safeOptions;
    this.scanRunId += 1;
    this.scanState = {
      status: "scanning",
      round: 0,
      maxRounds: safeOptions.maxRounds,
      reason: "Scanning"
    };

    logger.info("media", "scroll scan started", safeOptions);
    this.emitScanState();
    void this.runScrollScan(this.scanRunId, safeOptions);
    return this.scanState;
  }

  stopScrollScan(reason = "Stopped by user"): ScrollScanState {
    if (this.scanState.status === "idle" || this.scanState.status === "stopped") {
      return this.scanState;
    }

    this.scanRunId += 1;
    this.scanState = {
      ...this.scanState,
      status: "stopped",
      reason
    };
    logger.info("media", "scroll scan stopped", { reason });
    this.emitScanState();
    return this.scanState;
  }

  pauseScrollScan(reason = "Paused for manual action"): ScrollScanState {
    if (this.scanState.status !== "scanning") {
      return this.scanState;
    }

    this.scanRunId += 1;
    this.scanState = {
      ...this.scanState,
      status: "paused",
      reason
    };
    logger.warn("media", "scroll scan paused", { reason });
    this.emitScanState();
    return this.scanState;
  }

  resumeScrollScan(): ScrollScanState {
    if (this.scanState.status !== "paused" && this.scanState.status !== "stopped") {
      return this.scanState;
    }

    logger.info("media", "scroll scan resumed");
    return this.startScrollScan(this.lastScrollOptions);
  }

  destroy(): void {
    this.stopScrollScan("Window closed");

    if (!this.window.isDestroyed()) {
      this.window.removeBrowserView(this.view);
    }

    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close();
    }
  }

  private configureWebContents(): void {
    const webContents = this.view.webContents;

    webContents.setWindowOpenHandler(({ url }) => {
      logger.info("browser-view", "redirecting new window into current view", { url });
      void this.navigate(url).catch((error: Error) => {
        logger.warn("browser-view", "blocked new-window navigation", { error: error.message, url });
      });

      return { action: "deny" };
    });

    webContents.on("did-start-loading", () => {
      this.isLoading = true;
      logger.info("browser-view", "start loading", { url: webContents.getURL() });
      this.emitState();
    });

    webContents.on("did-stop-loading", () => {
      this.isLoading = false;
      logger.info("browser-view", "stop loading", { url: webContents.getURL() });
      this.emitState();
    });

    webContents.on("did-finish-load", () => {
      logger.info("browser-view", "finished load", { url: webContents.getURL(), title: webContents.getTitle() });
      this.emitState();
    });

    webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) {
        return;
      }

      logger.warn("browser-view", "load failed", {
        errorCode,
        error: errorDescription,
        url: safeUrl(validatedURL)
      });
      this.emitState();
    });

    webContents.on("page-title-updated", () => {
      this.emitState();
    });

    webContents.on("did-navigate", (_event, url) => {
      logger.info("browser-view", "navigated", { url });
      this.emitState();
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      logger.info("browser-view", "in-page navigation", { url });
      this.emitState();
    });
  }

  private normalizeScrollOptions(options?: ScrollScanOptions): Required<ScrollScanOptions> {
    return {
      intervalMs: Math.max(400, Math.min(5000, Math.round(options?.intervalMs || DEFAULT_SCROLL_OPTIONS.intervalMs))),
      maxRounds: Math.max(1, Math.min(50, Math.round(options?.maxRounds || DEFAULT_SCROLL_OPTIONS.maxRounds)))
    };
  }

  private async runScrollScan(runId: number, options: Required<ScrollScanOptions>): Promise<void> {
    let previous = await this.safeScrollMetrics();
    let stableRounds = 0;

    for (let round = 1; round <= options.maxRounds; round += 1) {
      if (runId !== this.scanRunId || this.scanState.status !== "scanning") {
        return;
      }

      this.scanState = {
        ...this.scanState,
        round,
        reason: `Scanning round ${round} of ${options.maxRounds}`
      };
      this.emitScanState();

      try {
        await scrollPage(this.view.webContents);
        await this.sleep(options.intervalMs);
        const result = await this.scanCurrentPage();

        if (!this.window.isDestroyed()) {
          this.window.webContents.send(IPC_CHANNELS.mediaScrollScanUpdate, {
            round,
            state: this.scanState,
            result
          });
        }

        if (result.manualActionDetected) {
          this.pauseScrollScan(result.manualActionReason || "Manual action required");
          return;
        }

        const current = await this.safeScrollMetrics();

        if (previous && current && current.scrollHeight === previous.scrollHeight && current.scrollY === previous.scrollY) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
        }

        previous = current || previous;

        if (stableRounds >= 2) {
          this.stopScrollScan("Page height stopped changing");
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.scanState = {
          ...this.scanState,
          status: "error",
          reason: message
        };
        logger.error("media", "scroll scan failed", { error: message });
        this.emitScanState();
        return;
      }
    }

    if (runId === this.scanRunId && this.scanState.status === "scanning") {
      this.stopScrollScan("Reached maximum scroll rounds");
    }
  }

  private async safeScrollMetrics(): Promise<{ scrollY: number; innerHeight: number; scrollHeight: number } | null> {
    try {
      return await getScrollMetrics(this.view.webContents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("media", "failed to read scroll metrics", { error: message });
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private emitState(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("browser:state-changed", this.getState());
    }
  }

  private emitScanState(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.mediaScanStateChanged, this.scanState);
    }
  }
}
