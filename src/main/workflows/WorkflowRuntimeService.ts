import type {
  WorkflowDescriptor,
  WorkflowRunDetailSnapshot,
  WorkflowRuntimeSnapshot,
  WorkflowServiceCheckResult
} from "../../shared/workflows/types";
import { getSafariRpaRunDetailSnapshot, getSafariRpaRuntimeSnapshot } from "./SafariRpaBridge";
import { checkWorkflowService } from "./WorkflowServiceChecker";

export class WorkflowRuntimeService {
  checkService(workflow: WorkflowDescriptor): Promise<WorkflowServiceCheckResult> {
    return checkWorkflowService(workflow);
  }

  getRuntimeSnapshot(workflow: WorkflowDescriptor): Promise<WorkflowRuntimeSnapshot> {
    return getSafariRpaRuntimeSnapshot(workflow);
  }

  getRunDetail(workflow: WorkflowDescriptor, runId: string): Promise<WorkflowRunDetailSnapshot> {
    return getSafariRpaRunDetailSnapshot(workflow, runId);
  }
}

