import { BaseWindow } from "electron";
import { BrowserWorkflowLocalApiServer } from "../api/BrowserWorkflowLocalApiServer";
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
import { defaultKuaishouElementProfile } from "../domains/kuaishou/profiles/defaultKuaishouElementProfile";
import { KuaishouUploadAdapter } from "../domains/kuaishou/service/KuaishouUploadAdapter";
import { createWorkflowRegistry } from "../workflows/WorkflowRegistry";
import { WorkflowRuntimeService } from "../workflows/WorkflowRuntimeService";

export function createMainWindow(): BaseWindow {
  const window = new BaseWindow({
    width: 1720,
    height: 960,
    minWidth: 1700,
    minHeight: 720,
    title: "Browser Workflow Forge",
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
  const workflowRegistry = createWorkflowRegistry();
  const workflowRuntimeService = new WorkflowRuntimeService();
  const repositories = {
    accountRepository,
    elementProfileRepository,
    uploadTaskRepository,
    taskLogRepository,
    taskArtifactRepository
  };
  registerIpcHandlers({
    browserWorkspace,
    repositories,
    workflowRegistry,
    workflowRuntimeService
  });
  const apiServer = new BrowserWorkflowLocalApiServer(
    new KuaishouUploadAdapter(browserWorkspace, {
      elementProfileRepository,
      uploadTaskRepository,
      taskLogRepository,
      taskArtifactRepository
    }),
    workflowRegistry,
    workflowRuntimeService
  );
  apiServer.start();
  window.on("closed", () => {
    apiServer.close();
  });
  createAppShell(window);
  window.show();
  return window;
}
