import type { WorkflowRegistry } from "../workflows/WorkflowRegistry";
import type { WorkflowRuntimeService } from "../workflows/WorkflowRuntimeService";
import type { LocalApiRequest, LocalApiRouteResult } from "./LocalApiTypes";
import { routeHandled, routeNotHandled } from "./LocalApiTypes";

export class WorkflowLocalApiRoutes {
  constructor(
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly workflowRuntimeService: WorkflowRuntimeService
  ) {}

  async handle({ method, url }: LocalApiRequest): Promise<LocalApiRouteResult> {
    if (method === "GET" && url.pathname === "/api/health") {
      return routeHandled(200, {
        ok: true,
        service: "browser-workflow-forge",
        engines: ["electron", "safari-rpa", "safari-extension"]
      });
    }

    if (method === "GET" && url.pathname === "/api/workflows") {
      return routeHandled(200, { ok: true, data: this.workflowRegistry.list() });
    }

    const serviceCheckMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/service-check$/);
    if (method === "GET" && serviceCheckMatch) {
      const workflow = this.workflowRegistry.get(decodeURIComponent(serviceCheckMatch[1]));
      if (!workflow) {
        return routeHandled(404, { ok: false, error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found" } });
      }
      return routeHandled(200, { ok: true, data: await this.workflowRuntimeService.checkService(workflow) });
    }

    const runtimeSnapshotMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/runtime-snapshot$/);
    if (method === "GET" && runtimeSnapshotMatch) {
      const workflow = this.workflowRegistry.get(decodeURIComponent(runtimeSnapshotMatch[1]));
      if (!workflow) {
        return routeHandled(404, { ok: false, error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found" } });
      }
      return routeHandled(200, { ok: true, data: await this.workflowRuntimeService.getRuntimeSnapshot(workflow) });
    }

    const runDetailMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/runs\/([^/]+)$/);
    if (method === "GET" && runDetailMatch) {
      const workflow = this.workflowRegistry.get(decodeURIComponent(runDetailMatch[1]));
      if (!workflow) {
        return routeHandled(404, { ok: false, error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found" } });
      }
      return routeHandled(200, {
        ok: true,
        data: await this.workflowRuntimeService.getRunDetail(workflow, decodeURIComponent(runDetailMatch[2]))
      });
    }

    const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
    if (method === "GET" && workflowMatch) {
      const workflow = this.workflowRegistry.get(decodeURIComponent(workflowMatch[1]));
      return routeHandled(
        workflow ? 200 : 404,
        workflow ? { ok: true, data: workflow } : { ok: false, error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found" } }
      );
    }

    return routeNotHandled();
  }
}
