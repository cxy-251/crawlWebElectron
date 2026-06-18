import { ipcMain } from "electron";
import { BossZhipinAutomationService } from "../browser-automation/BossZhipinAutomationService";
import type { BossZhipinBatchConfig, BossZhipinFilters, BossZhipinMessageRunConfig } from "../browser-automation/types";
import type { IpcContext } from "./registerIpcHandlers";

export function registerBrowserAutomationIpcHandlers({ browserWorkspace }: IpcContext): void {
  const bossService = new BossZhipinAutomationService(browserWorkspace);

  ipcMain.handle("browser-automation:boss:open-page", async (_event, url: string) => {
    return bossService.openBossPage(url);
  });

  ipcMain.handle("browser-automation:boss:open-messages-page", async (_event, url?: string) => {
    return bossService.openMessagesPage(url);
  });

  ipcMain.handle("browser-automation:boss:click-first-immediate-chat", async () => {
    return bossService.clickFirstImmediateChat();
  });

  ipcMain.handle("browser-automation:boss:detect-page", async () => {
    return bossService.detectPage();
  });

  ipcMain.handle("browser-automation:boss:filter-options", async () => {
    return bossService.readFilterOptions();
  });

  ipcMain.handle("browser-automation:boss:apply-filters", async (_event, filters: BossZhipinFilters) => {
    return bossService.applyFilters(filters);
  });

  ipcMain.handle("browser-automation:boss:collect-current-job", async () => {
    return bossService.collectCurrentJob();
  });

  ipcMain.handle("browser-automation:boss:run-immediate-chat-batch", async (_event, config: BossZhipinBatchConfig) => {
    return bossService.runImmediateChatBatch(config);
  });

  ipcMain.handle("browser-automation:boss:run-batch", async (_event, config: BossZhipinBatchConfig) => {
    return bossService.runBatch(config);
  });

  ipcMain.handle("browser-automation:boss:collect-message-jobs", async (_event, config: BossZhipinMessageRunConfig) => {
    return bossService.collectMessageJobs(config);
  });
}
