import type { LocatorSpec } from "../video-upload/types";
import { CdpFileInputService } from "./CdpFileInputService";
import { LocatorEngine } from "./LocatorEngine";
import { PageArtifactService } from "./PageArtifactService";

export class RpaLocator {
  constructor(
    private readonly specs: LocatorSpec[],
    private readonly engine: LocatorEngine,
    private readonly fileInputService: CdpFileInputService,
    private readonly artifactService: PageArtifactService
  ) {}

  async exists(): Promise<boolean> {
    const result = await this.engine.perform(this.specs, "exists");
    return result.matchedCount > 0;
  }

  async visible(): Promise<boolean> {
    const result = await this.engine.perform<{ visible: boolean }>(this.specs, "visible");
    return result.visible;
  }

  async count(): Promise<number> {
    const result = await this.engine.resolve(this.specs);
    return result.matchedCount;
  }

  async click(): Promise<void> {
    const result = await this.engine.perform(this.specs, "click");
    if (!result.ok) throw new Error("ELEMENT_NOT_FOUND");
  }

  async fill(value: string): Promise<void> {
    const result = await this.engine.perform(this.specs, "fill", value);
    if (!result.ok) throw new Error("ELEMENT_NOT_FOUND");
  }

  async type(value: string): Promise<void> {
    const result = await this.engine.perform(this.specs, "type", value);
    if (!result.ok) throw new Error("ELEMENT_NOT_FOUND");
  }

  async textContent(): Promise<string> {
    const result = await this.engine.perform<{ ok: boolean; text: string }>(this.specs, "textContent");
    return result.text || "";
  }

  async screenshot(name?: string): Promise<string> {
    return this.artifactService.screenshot("locator", name);
  }

  async setFiles(files: string[]): Promise<void> {
    await this.fileInputService.setFiles(this.specs, files);
  }
}

