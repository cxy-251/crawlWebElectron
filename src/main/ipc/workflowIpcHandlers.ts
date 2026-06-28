import { ipcMain } from "electron";
import type { WorkflowRegistry } from "../workflows/WorkflowRegistry";
import type { WorkflowRuntimeService } from "../workflows/WorkflowRuntimeService";

export function registerWorkflowIpcHandlers(workflowRegistry: WorkflowRegistry, workflowRuntimeService: WorkflowRuntimeService): void {
  ipcMain.handle("workflows:list", () => workflowRegistry.list());
  ipcMain.handle("workflows:check-service", async (_event, workflowId: string) => {
    const workflow = workflowRegistry.get(workflowId);
    if (!workflow) {
      return { ok: false, status: "unreachable", message: "Workflow not found." };
    }
    return workflowRuntimeService.checkService(workflow);
  });
  ipcMain.handle("workflows:runtime-snapshot", async (_event, workflowId: string) => {
    const workflow = workflowRegistry.get(workflowId);
    if (!workflow) {
      return { ok: false, status: "unreachable", message: "Workflow not found.", workflows: [], runs: [], reports: [], schedules: [] };
    }
    return workflowRuntimeService.getRuntimeSnapshot(workflow);
  });
  ipcMain.handle("workflows:run-detail", async (_event, workflowId: string, runId: string) => {
    const workflow = workflowRegistry.get(workflowId);
    if (!workflow) {
      return { ok: false, status: "unreachable", message: "Workflow not found.", run: null, artifacts: [] };
    }
    return workflowRuntimeService.getRunDetail(workflow, runId);
  });
}
