import { BaseWindow } from "electron";
import { KuaishouLocalApiServer } from "../api/KuaishouLocalApiServer";
import { createAppShell } from "./createAppShell";
import { BrowserWorkspace } from "../browser/BrowserWorkspace";
import { registerIpcHandlers } from "../ipc/registerIpcHandlers";
import { SessionManager } from "../session/SessionManager";
import { Database } from "../storage/Database";
import { AccountRepository } from "../storage/repositories/AccountRepository";
import { ElementProfileRepository } from "../storage/repositories/ElementProfileRepository";
import { TaskArtifactRepository } from "../storage/repositories/TaskArtifactRepository";
import { TaskLogRepository } from "../storage/repositories/TaskLogRepository";
import { UploadTaskRepository } from "../storage/repositories/UploadTaskRepository";
import { defaultKuaishouElementProfile } from "../video-upload/kuaishou/defaultKuaishouElementProfile";
import { KuaishouUploadAdapter } from "../video-upload/kuaishou/KuaishouUploadAdapter";

export function createMainWindow(): BaseWindow {
  const window = new BaseWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: "CrawlWebElectron",
    backgroundColor: "#f8fafc"
  });

  const sessionManager = new SessionManager();
  const database = new Database();
  const accountRepository = new AccountRepository(database);
  const elementProfileRepository = new ElementProfileRepository(database);
  const uploadTaskRepository = new UploadTaskRepository(database);
  const taskLogRepository = new TaskLogRepository(database);
  const taskArtifactRepository = new TaskArtifactRepository(database);
  accountRepository.ensureDefaultKuaishouAccount();
  elementProfileRepository.ensureDefault(defaultKuaishouElementProfile);

  const browserWorkspace = new BrowserWorkspace(window, sessionManager);
  const repositories = {
    accountRepository,
    elementProfileRepository,
    uploadTaskRepository,
    taskLogRepository,
    taskArtifactRepository
  };
  registerIpcHandlers({
    browserWorkspace,
    repositories
  });
  const apiServer = new KuaishouLocalApiServer(
    new KuaishouUploadAdapter(browserWorkspace, {
      elementProfileRepository,
      uploadTaskRepository,
      taskLogRepository,
      taskArtifactRepository
    })
  );
  apiServer.start();
  window.on("closed", () => {
    apiServer.close();
  });
  createAppShell(window);
  window.show();
  return window;
}
