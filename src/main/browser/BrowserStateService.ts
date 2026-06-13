import type { WebContents } from "electron";

export class BrowserStateService {
  constructor(private readonly webContents: WebContents) {}

  getState() {
    return {
      url: this.webContents.getURL(),
      title: this.webContents.getTitle()
    };
  }
}

