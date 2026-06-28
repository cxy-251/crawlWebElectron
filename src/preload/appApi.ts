export type ToolInfo = {
  id: "video-upload" | "workflows";
  name: string;
  route: string;
  enabled: boolean;
};

export type LocalFileKind = "video" | "cover";

export type LocalFilePickResult = {
  canceled: boolean;
  filePath: string;
};

import type {
  ElementTestResult,
  KuaishouDomDiagnostic,
  KuaishouElementKey,
  KuaishouElementProfile,
  KuaishouFormState,
  KuaishouOptionField,
  KuaishouOptionsResult,
  KuaishouPageDetection,
  KuaishouPageSnapshot,
  KuaishouUploadTaskInput,
  KuaishouUploadTaskResult,
  TaskLog
} from "../main/video-upload/types";
import type { WorkflowDescriptor, WorkflowRunDetailSnapshot, WorkflowRuntimeSnapshot, WorkflowServiceCheckResult } from "../shared/workflows/types";

export type AppApi = {
  browser: {
    goto(url: string): Promise<void>;
    reload(): Promise<void>;
    getState(): Promise<{ url: string; title: string }>;
  };
  tools: {
    listTools(): Promise<ToolInfo[]>;
  };
  workflows: {
    listWorkflows(): Promise<WorkflowDescriptor[]>;
    checkService(workflowId: string): Promise<WorkflowServiceCheckResult>;
    getRuntimeSnapshot(workflowId: string): Promise<WorkflowRuntimeSnapshot>;
    getRunDetail(workflowId: string, runId: string): Promise<WorkflowRunDetailSnapshot>;
  };
  kuaishou: {
    openHome(): Promise<void>;
    openUploadPage(): Promise<void>;
    continueEditingOrStartNewUpload(): Promise<KuaishouPageDetection>;
    detectPage(): Promise<KuaishouPageDetection>;
    diagnoseDom(): Promise<KuaishouDomDiagnostic>;
    readPageState(): Promise<KuaishouPageSnapshot>;
    getOptions(field: KuaishouOptionField, query?: string): Promise<KuaishouOptionsResult>;
    applyFormState(state: KuaishouFormState): Promise<KuaishouPageSnapshot>;
    pickLocalFile(kind: LocalFileKind): Promise<LocalFilePickResult>;
    uploadSingleVideo(input: KuaishouUploadTaskInput): Promise<KuaishouUploadTaskResult>;
    confirmPublish(taskId: string): Promise<KuaishouUploadTaskResult>;
    cancelTask(taskId: string): Promise<KuaishouUploadTaskResult>;
    getElementProfile(): Promise<KuaishouElementProfile>;
    updateElementProfile(profile: KuaishouElementProfile): Promise<KuaishouElementProfile>;
    resetElementProfile(): Promise<KuaishouElementProfile>;
    testElement(locatorKey: KuaishouElementKey): Promise<ElementTestResult>;
    getTask(taskId: string): Promise<KuaishouUploadTaskResult | null>;
    getTaskLogs(taskId: string): Promise<TaskLog[]>;
  };
};
