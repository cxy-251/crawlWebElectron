export type WorkflowEngine = "electron" | "safari-rpa" | "safari-extension";

export type WorkflowStatus = "available" | "external" | "prototype" | "disabled";

export type WorkflowRisk = "standard" | "high";

export type WorkflowSource = {
  kind: "built-in" | "integrated-python" | "integrated-safari-extension";
  relativePath?: string;
  apiBaseUrl?: string;
};

export type WorkflowDescriptor = {
  id: string;
  version: string;
  title: string;
  site: string;
  engine: WorkflowEngine;
  status: WorkflowStatus;
  risk: WorkflowRisk;
  capabilities: string[];
  source: WorkflowSource;
  runApiPath?: string;
};

export type WorkflowServiceCheckResult = {
  ok: boolean;
  status: "connected" | "unreachable" | "not_applicable";
  message: string;
  data?: unknown;
};

export type SafariRpaRemoteWorkflow = {
  id: string;
  version?: string;
  title?: string;
  available?: boolean;
  capabilities?: string[];
};

export type SafariRpaRunRecord = {
  id: string;
  workflow_id: string;
  status: string;
  created_at: number;
  updated_at: number;
  error?: unknown;
  output?: unknown;
  cancel_requested?: boolean;
};

export type SafariRpaArtifactRecord = {
  id: string;
  run_id: string;
  step_key?: string | null;
  type: string;
  path: string;
  metadata?: unknown;
  created_at?: number;
};

export type SafariRpaReportRecord = {
  id: string;
  workflow_id: string;
  report_date: string;
  type: string;
  path: string;
  record_count: number;
  metadata?: unknown;
  created_at: number;
  updated_at: number;
};

export type SafariRpaScheduleRecord = {
  id: string;
  workflow_id: string;
  config_path: string;
  daily_at: string;
  timezone: string;
  enabled: boolean;
  agent_label: string;
  plist_path: string;
  keep_awake: boolean;
  metadata?: unknown;
  created_at: number;
  updated_at: number;
};

export type WorkflowRunDetailSnapshot = {
  ok: boolean;
  status: "connected" | "unreachable" | "not_applicable";
  message: string;
  run: SafariRpaRunRecord | null;
  artifacts: SafariRpaArtifactRecord[];
};

export type WorkflowRuntimeSnapshot = {
  ok: boolean;
  status: "connected" | "unreachable" | "not_applicable";
  message: string;
  workflows: SafariRpaRemoteWorkflow[];
  runs: SafariRpaRunRecord[];
  reports: SafariRpaReportRecord[];
  schedules: SafariRpaScheduleRecord[];
};
