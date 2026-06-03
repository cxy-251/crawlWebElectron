import { BrowserWindow, app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logger } from "./logger";

function preloadPath(): string {
  return path.join(__dirname, "../preload/index.js");
}

function rendererEntry(): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }

  return pathToFileURL(path.join(__dirname, "../../renderer/index.html")).toString();
}

export function createAppWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "CrawlWebElectron",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  logger.info("window", "created", {
    packaged: app.isPackaged,
    renderer: rendererEntry()
  });

  void window.loadURL(rendererEntry()).catch((error: Error) => {
    logger.error("window", "failed to load renderer", { error: error.message });
  });

  return window;
}

