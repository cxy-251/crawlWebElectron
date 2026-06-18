import { BaseWindow, WebContentsView } from "electron";
import { BrowserNavigationService } from "./BrowserNavigationService";
import { BrowserStateService } from "./BrowserStateService";
import { BrowserProfileId, SessionManager } from "../session/SessionManager";

const TOOL_PANE_WIDTH = 420;
const MIN_BROWSER_WIDTH = 1280;
const DEFAULT_BROWSER_URL = "https://example.com";
const VERBOSE_BROWSER_CONSOLE = process.env.CWE_VERBOSE_BROWSER_CONSOLE === "1";

export class BrowserWorkspace {
  view: WebContentsView;
  navigation: BrowserNavigationService;
  state: BrowserStateService;
  private activeProfileId: BrowserProfileId = "kuaishou";

  constructor(
    private readonly window: BaseWindow,
    private readonly sessionManager: SessionManager
  ) {
    this.view = this.createView(this.activeProfileId);
    this.navigation = new BrowserNavigationService(this.view.webContents);
    this.state = new BrowserStateService(this.view.webContents);

    this.registerWebContentsLogs();
    this.window.contentView.addChildView(this.view);
    console.info("[browser:view] addChildView", {
      windowTitle: this.window.title,
      contentBounds: this.window.getContentBounds()
    });
    this.updateBounds();
    this.window.on("resize", () => this.updateBounds());
    this.window.on("maximize", () => this.updateBounds());
    this.window.on("unmaximize", () => this.updateBounds());

    void this.navigation.goto(DEFAULT_BROWSER_URL).catch((error) => {
      console.error("[browser:init] failed to load default page", {
        url: DEFAULT_BROWSER_URL,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  get webContents() {
    return this.view.webContents;
  }

  get activeProfile() {
    return this.activeProfileId;
  }

  async useProfile(profileId: BrowserProfileId): Promise<void> {
    if (this.activeProfileId === profileId) return;

    const previousView = this.view;
    this.activeProfileId = profileId;
    this.view = this.createView(profileId);
    this.navigation = new BrowserNavigationService(this.view.webContents);
    this.state = new BrowserStateService(this.view.webContents);
    this.registerWebContentsLogs();
    this.window.contentView.removeChildView(previousView);
    this.window.contentView.addChildView(this.view);
    this.updateBounds();
    previousView.webContents.close({ waitForBeforeUnload: false });
    console.info("[browser:profile] switched", {
      profileId,
      currentUrl: this.view.webContents.getURL()
    });
  }

  private createView(profileId: BrowserProfileId): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionManager.getSession(profileId),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    if (profileId === "boss-zhipin") {
      view.webContents.setUserAgent(this.sessionManager.getChromeCompatibleUserAgent());
    }

    return view;
  }

  private updateBounds(): void {
    const bounds = this.window.getContentBounds();
    const viewBounds = {
      x: 0,
      y: 0,
      width: Math.max(MIN_BROWSER_WIDTH, bounds.width - TOOL_PANE_WIDTH),
      height: Math.max(320, bounds.height)
    };
    this.view.setBounds(viewBounds);
    console.info("[browser:bounds]", {
      windowContentSize: {
        width: bounds.width,
        height: bounds.height
      },
      viewBounds,
      TOOL_PANE_WIDTH,
      currentUrl: this.view.webContents.getURL()
    });
  }

  private registerWebContentsLogs(): void {
    const contents = this.view.webContents;

    contents.on("did-start-loading", () => {
      console.info("[browser:event] did-start-loading", { url: contents.getURL() });
    });

    contents.on("dom-ready", () => {
      console.info("[browser:event] dom-ready", {
        url: contents.getURL(),
        title: contents.getTitle()
      });
    });

    contents.on("did-finish-load", () => {
      console.info("[browser:event] did-finish-load", {
        url: contents.getURL(),
        title: contents.getTitle()
      });
    });

    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error("[browser:event] did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
        currentUrl: contents.getURL()
      });
    });

    contents.on("render-process-gone", (_event, details) => {
      console.error("[browser:event] render-process-gone", details);
    });

    contents.on("certificate-error", (_event, url, error, certificate, callback, isMainFrame) => {
      console.error("[browser:event] certificate-error", {
        url,
        error,
        isMainFrame,
        subjectName: certificate.subjectName,
        issuerName: certificate.issuerName
      });
      callback(false);
    });

    contents.on("console-message", (details) => {
      if (!VERBOSE_BROWSER_CONSOLE && !["error", "warning"].includes(details.level)) {
        return;
      }

      const log = details.level === "error" ? console.error : details.level === "warning" ? console.warn : console.info;
      log("[browser:event] console-message", {
        level: details.level,
        message: details.message,
        lineNumber: details.lineNumber,
        sourceId: details.sourceId
      });
    });

    contents.on("page-title-updated", (_event, title) => {
      console.info("[browser:event] page-title-updated", {
        title,
        url: contents.getURL()
      });
    });

    contents.on("did-navigate", (_event, url, httpResponseCode, httpStatusText) => {
      console.info("[browser:event] did-navigate", {
        url,
        httpResponseCode,
        httpStatusText
      });
    });

    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      console.info("[browser:event] did-navigate-in-page", {
        url,
        isMainFrame
      });
    });
  }
}
