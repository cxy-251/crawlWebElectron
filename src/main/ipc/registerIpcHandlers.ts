import type { BrowserWorkspace } from "../browser/BrowserWorkspace";
import type { AccountRepository } from "../storage/repositories/AccountRepository";
import type { ElementProfileRepository } from "../storage/repositories/ElementProfileRepository";
import type { TaskArtifactRepository } from "../storage/repositories/TaskArtifactRepository";
import type { TaskLogRepository } from "../storage/repositories/TaskLogRepository";
import type { UploadTaskRepository } from "../storage/repositories/UploadTaskRepository";
import type { WorkflowRegistry } from "../workflows/WorkflowRegistry";
import type { WorkflowRuntimeService } from "../workflows/WorkflowRuntimeService";
import { registerBrowserIpcHandlers } from "./browserIpcHandlers";
import { registerKuaishouIpcHandlers } from "./kuaishouIpcHandlers";
import { registerToolIpcHandlers } from "./toolIpcHandlers";
import { registerWorkflowIpcHandlers } from "./workflowIpcHandlers";

export type IpcContext = {
  browserWorkspace: BrowserWorkspace;
  repositories: {
    accountRepository: AccountRepository;
    elementProfileRepository: ElementProfileRepository;
    uploadTaskRepository: UploadTaskRepository;
    taskLogRepository: TaskLogRepository;
    taskArtifactRepository: TaskArtifactRepository;
  };
  workflowRegistry: WorkflowRegistry;
  workflowRuntimeService: WorkflowRuntimeService;
};

export function registerIpcHandlers(context: IpcContext): void {
  registerBrowserIpcHandlers(context);
  registerToolIpcHandlers();
  registerWorkflowIpcHandlers(context.workflowRegistry, context.workflowRuntimeService);
  registerKuaishouIpcHandlers(context);
}
