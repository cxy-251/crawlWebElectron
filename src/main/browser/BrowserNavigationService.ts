import type { WebContents } from "electron";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export class BrowserNavigationService {
  constructor(private readonly webContents: WebContents) {}

  async goto(url: string): Promise<void> {
    console.info("[browser:goto] requested", { input: url, currentUrl: this.webContents.getURL() });
    const normalizedUrl = this.normalizeUrl(url);
    console.info("[browser:goto] loadURL start", { url: normalizedUrl });

    try {
      await this.webContents.loadURL(normalizedUrl);
      console.info("[browser:goto] did-finish-load", {
        requestedUrl: normalizedUrl,
        currentUrl: this.webContents.getURL(),
        title: this.webContents.getTitle()
      });
    } catch (error) {
      console.error("[browser:goto] did-fail-load", {
        requestedUrl: normalizedUrl,
        currentUrl: this.webContents.getURL(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  reload(): void {
    this.webContents.reload();
  }

  private normalizeUrl(input: string): string {
    const trimmed = input.trim();

    if (!trimmed) {
      throw new Error("URL 不能为空");
    }

    const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      throw new Error("只允许打开 http/https 页面");
    }

    return parsed.href;
  }
}
