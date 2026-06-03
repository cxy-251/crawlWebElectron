import { BrowserView, BrowserWindow } from "electron";
import type { BrowserBounds, LinkInfo, PageState } from "../shared/types";
import { logger, safeUrl } from "./logger";
import { normalizeNavigationUrl } from "./navigation";

const DEFAULT_URL = "https://example.com";
const SESSION_PARTITION = "persist:crawl-web-electron";

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

  destroy(): void {
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

  private emitState(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("browser:state-changed", this.getState());
    }
  }
}
