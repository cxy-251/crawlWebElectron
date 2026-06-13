import { app } from "electron";
import type { WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";

export class PageArtifactService {
  constructor(private readonly webContents: WebContents) {}

  async screenshot(taskId: string, name = "screenshot.png"): Promise<string> {
    const dir = this.taskDir(taskId);
    const filePath = path.join(dir, name);
    const image = await this.webContents.capturePage();
    fs.writeFileSync(filePath, image.toPNG());
    return filePath;
  }

  async domSnapshot(taskId: string, name = "dom_snapshot.html"): Promise<string> {
    const dir = this.taskDir(taskId);
    const filePath = path.join(dir, name);
    const html = (await this.webContents.executeJavaScript("document.documentElement.outerHTML", true)) as string;
    fs.writeFileSync(filePath, html, "utf8");
    return filePath;
  }

  writeErrorReport(taskId: string, report: unknown): string {
    const dir = this.taskDir(taskId);
    const filePath = path.join(dir, "error_report.json");
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
    return filePath;
  }

  private taskDir(taskId: string): string {
    const dir = path.join(app.getPath("userData"), "artifacts", "tasks", taskId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

