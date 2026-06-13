import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import type { IpcContext } from "./registerIpcHandlers";
import type { KuaishouElementKey, KuaishouFormState, KuaishouOptionField, KuaishouUploadTaskInput } from "../video-upload/types";
import { RpaDriver } from "../rpa/RpaDriver";
import { defaultKuaishouElementProfile } from "../video-upload/kuaishou/defaultKuaishouElementProfile";
import { isKuaishouPageActionError } from "../video-upload/kuaishou/KuaishouPageBinding";
import { KuaishouUploadAdapter } from "../video-upload/kuaishou/KuaishouUploadAdapter";

export function registerKuaishouIpcHandlers({ browserWorkspace, repositories }: IpcContext): void {
  const adapter = new KuaishouUploadAdapter(browserWorkspace, {
    elementProfileRepository: repositories.elementProfileRepository,
    uploadTaskRepository: repositories.uploadTaskRepository,
    taskLogRepository: repositories.taskLogRepository,
    taskArtifactRepository: repositories.taskArtifactRepository
  });

  ipcMain.handle("kuaishou:open-home", async () => {
    await adapter.openHome();
  });

  ipcMain.handle("kuaishou:open-upload-page", async () => {
    await adapter.openUploadPage();
  });

  ipcMain.handle("kuaishou:continue-editing-or-start-new-upload", async () => {
    return adapter.continueEditingOrStartNewUpload();
  });

  ipcMain.handle("kuaishou:detect-page", async () => {
    return adapter.detectPage();
  });

  ipcMain.handle("kuaishou:read-page-state", async () => {
    return adapter.readPageState();
  });

  ipcMain.handle("kuaishou:get-options", async (_event, field: KuaishouOptionField, query?: string) => {
    return adapter.readOptions(field, query || "");
  });

  ipcMain.handle("kuaishou:apply-form-state", async (_event, state: KuaishouFormState) => {
    try {
      return await adapter.applyFormState(state);
    } catch (error) {
      if (isKuaishouPageActionError(error)) {
        console.error("[kuaishou:apply-form-state] failed", error.details);
        throw new Error(JSON.stringify(error.details));
      }

      throw error;
    }
  });

  ipcMain.handle("kuaishou:pick-local-file", async (event, kind: "video" | "cover") => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const filters =
      kind === "cover"
        ? [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]
        : [{ name: "Videos", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }];
    const options: OpenDialogOptions = {
      title: kind === "cover" ? "选择封面文件" : "选择视频文件",
      properties: ["openFile"],
      filters
    };
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);

    return {
      canceled: result.canceled,
      filePath: result.canceled ? "" : result.filePaths[0] || ""
    };
  });

  ipcMain.handle("kuaishou:upload-single-video", async (_event, input: KuaishouUploadTaskInput) => {
    return adapter.uploadSingleVideo(input);
  });

  ipcMain.handle("kuaishou:confirm-publish", async (_event, taskId: string) => {
    return adapter.confirmPublish(taskId);
  });

  ipcMain.handle("kuaishou:cancel-task", async (_event, taskId: string) => {
    return adapter.cancelTask(taskId);
  });

  ipcMain.handle("kuaishou:get-task", async (_event, taskId: string) => {
    const task = repositories.uploadTaskRepository.get(taskId);
    return task
      ? {
          ...task,
          artifacts: repositories.taskArtifactRepository.list(taskId)
        }
      : null;
  });

  ipcMain.handle("kuaishou:get-task-logs", async (_event, taskId: string) => {
    return repositories.taskLogRepository.list(taskId);
  });

  ipcMain.handle("kuaishou:get-element-profile", () => repositories.elementProfileRepository.getActiveKuaishouProfile());

  ipcMain.handle("kuaishou:update-element-profile", (_event, profile) => repositories.elementProfileRepository.save(profile));

  ipcMain.handle("kuaishou:reset-element-profile", () => repositories.elementProfileRepository.save(defaultKuaishouElementProfile));

  ipcMain.handle("kuaishou:test-element", async (_event, locatorKey: KuaishouElementKey) => {
    const profile = repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(browserWorkspace.webContents);
    const resolution = await driver.test(profile.elements[locatorKey]);

    return {
      ok: resolution.matchedCount > 0,
      locatorKey,
      matchedCount: resolution.matchedCount,
      attempts: resolution.attempts
    };
  });
}
