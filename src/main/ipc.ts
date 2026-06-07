import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import type { BrowserBounds, PingResult, ScrollScanOptions } from "../shared/types";
import { logger } from "./logger";
import type { WebViewController } from "./webViewController";

type Handler = (...args: unknown[]) => Promise<unknown> | unknown;

function register(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    logger.info("ipc", "invoke", { channel });
    return handler(...args);
  });
}

function isBounds(value: unknown): value is BrowserBounds {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

export function registerIpc(controller: WebViewController): void {
  register(IPC_CHANNELS.browserNavigate, (url) => controller.navigate(String(url)));
  register(IPC_CHANNELS.browserBack, () => controller.goBack());
  register(IPC_CHANNELS.browserForward, () => controller.goForward());
  register(IPC_CHANNELS.browserReload, () => controller.reload());
  register(IPC_CHANNELS.browserGetState, () => controller.getState());
  register(IPC_CHANNELS.browserGetUrl, () => controller.getUrl());
  register(IPC_CHANNELS.browserGetTitle, () => controller.getTitle());
  register(IPC_CHANNELS.browserExtractLinks, (limit) => controller.extractLinks(Number(limit)));
  register(IPC_CHANNELS.browserGetSessionSummary, () => controller.getSessionSummary());
  register(IPC_CHANNELS.mediaScanCurrentPage, () => controller.scanCurrentPage());
  register(IPC_CHANNELS.mediaStartScrollScan, (options) => controller.startScrollScan(options as ScrollScanOptions));
  register(IPC_CHANNELS.mediaStopScrollScan, () => controller.stopScrollScan());
  register(IPC_CHANNELS.mediaPauseScrollScan, () => controller.pauseScrollScan("Paused by user"));
  register(IPC_CHANNELS.mediaResumeScrollScan, () => controller.resumeScrollScan());
  register(IPC_CHANNELS.browserSetBounds, (bounds) => {
    if (!isBounds(bounds)) {
      throw new Error("Invalid BrowserView bounds.");
    }

    controller.setBounds(bounds);
  });
  register(IPC_CHANNELS.debugPing, (): PingResult => ({
    message: "pong",
    at: new Date().toISOString(),
    page: controller.getState()
  }));

  logger.info("ipc", "registered browser IPC handlers");
}
