import type { WebContents } from "electron";
import type { LocatorSpec } from "../video-upload/types";
import { CdpFileInputService } from "./CdpFileInputService";
import { LocatorEngine } from "./LocatorEngine";
import { PageArtifactService } from "./PageArtifactService";
import { RpaLocator } from "./RpaLocator";

export class RpaDriver {
  private readonly engine: LocatorEngine;
  private readonly artifactService: PageArtifactService;
  private readonly fileInputService: CdpFileInputService;

  constructor(private readonly webContents: WebContents) {
    this.engine = new LocatorEngine(webContents);
    this.artifactService = new PageArtifactService(webContents);
    this.fileInputService = new CdpFileInputService(webContents);
  }

  async goto(url: string): Promise<void> {
    await this.webContents.loadURL(url);
  }

  async currentUrl(): Promise<string> {
    return this.webContents.getURL();
  }

  async title(): Promise<string> {
    return this.webContents.getTitle();
  }

  async locator(specs: LocatorSpec[]): Promise<RpaLocator> {
    return new RpaLocator(specs, this.engine, this.fileInputService, this.artifactService);
  }

  async waitUntil(predicate: () => Promise<boolean>, options: { timeoutMs: number; intervalMs: number }): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < options.timeoutMs) {
      if (await predicate()) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }

    throw new Error("UPLOAD_TIMEOUT");
  }

  async screenshot(name?: string): Promise<string> {
    return this.artifactService.screenshot("manual", name);
  }

  async domSnapshot(name?: string): Promise<string> {
    return this.artifactService.domSnapshot("manual", name);
  }

  async test(specs: LocatorSpec[]) {
    return this.engine.resolve(specs);
  }

  async evaluate<T>(script: string): Promise<T> {
    return this.webContents.executeJavaScript(script, true) as Promise<T>;
  }

  get artifacts(): PageArtifactService {
    return this.artifactService;
  }
}
