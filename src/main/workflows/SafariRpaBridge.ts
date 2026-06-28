import type {
  SafariRpaRemoteWorkflow,
  SafariRpaArtifactRecord,
  SafariRpaReportRecord,
  SafariRpaRunRecord,
  SafariRpaScheduleRecord,
  WorkflowDescriptor,
  WorkflowRunDetailSnapshot,
  WorkflowRuntimeSnapshot
} from "../../shared/workflows/types";

const DEFAULT_TIMEOUT_MS = 3000;

export async function getSafariRpaRuntimeSnapshot(
  descriptor: WorkflowDescriptor,
  limit = 10,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<WorkflowRuntimeSnapshot> {
  if (descriptor.engine !== "safari-rpa" || !descriptor.source.apiBaseUrl) {
    return {
      ok: true,
      status: "not_applicable",
      message: "This workflow does not use the Safari RPA runtime.",
      workflows: [],
      runs: [],
      reports: [],
      schedules: []
    };
  }

  const baseUrl = descriptor.source.apiBaseUrl.replace(/\/+$/, "");
  try {
    const normalizedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const [workflows, runs, reports, schedules] = await Promise.all([
      fetchEnvelope<unknown[]>(`${baseUrl}/workflows`, timeoutMs),
      fetchEnvelope<unknown[]>(`${baseUrl}/runs?limit=${normalizedLimit}`, timeoutMs),
      fetchEnvelope<unknown[]>(`${baseUrl}/reports?limit=${normalizedLimit}`, timeoutMs),
      fetchEnvelope<unknown[]>(`${baseUrl}/schedules`, timeoutMs)
    ]);
    const workflowRuns = normalizeRunRecords(runs).filter((run) => run.workflow_id === descriptor.id);
    const workflowReports = normalizeReportRecords(reports).filter((report) => report.workflow_id === descriptor.id);
    const workflowSchedules = normalizeScheduleRecords(schedules).filter((schedule) => schedule.workflow_id === descriptor.id);
    return {
      ok: true,
      status: "connected",
      message: "Safari RPA runtime snapshot loaded.",
      workflows: normalizeRemoteWorkflows(workflows),
      runs: workflowRuns,
      reports: workflowReports,
      schedules: workflowSchedules
    };
  } catch (error) {
    return {
      ok: false,
      status: "unreachable",
      message: error instanceof Error ? error.message : String(error),
      workflows: [],
      runs: [],
      reports: [],
      schedules: []
    };
  }
}

export async function getSafariRpaRunDetailSnapshot(
  descriptor: WorkflowDescriptor,
  runId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<WorkflowRunDetailSnapshot> {
  if (descriptor.engine !== "safari-rpa" || !descriptor.source.apiBaseUrl) {
    return {
      ok: true,
      status: "not_applicable",
      message: "This workflow does not use the Safari RPA runtime.",
      run: null,
      artifacts: []
    };
  }

  const trimmedRunId = runId.trim();
  if (!trimmedRunId) {
    return {
      ok: false,
      status: "unreachable",
      message: "Run id is required.",
      run: null,
      artifacts: []
    };
  }

  const baseUrl = descriptor.source.apiBaseUrl.replace(/\/+$/, "");
  const encodedRunId = encodeURIComponent(trimmedRunId);
  try {
    const [run, artifacts] = await Promise.all([
      fetchEnvelope<unknown>(`${baseUrl}/runs/${encodedRunId}`, timeoutMs),
      fetchEnvelope<unknown[]>(`${baseUrl}/runs/${encodedRunId}/artifacts`, timeoutMs)
    ]);
    return {
      ok: true,
      status: "connected",
      message: "Safari RPA run detail loaded.",
      run: normalizeRunRecord(run),
      artifacts: normalizeArtifactRecords(artifacts)
    };
  } catch (error) {
    return {
      ok: false,
      status: "unreachable",
      message: error instanceof Error ? error.message : String(error),
      run: null,
      artifacts: []
    };
  }
}

async function fetchEnvelope<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: authorizationHeaders()
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`Safari RPA returned HTTP ${response.status}`);
    }
    if (!isRecord(payload) || payload.ok !== true) {
      throw new Error("Safari RPA returned an invalid response envelope");
    }
    return payload.data as T;
  } finally {
    clearTimeout(timeout);
  }
}

function authorizationHeaders(): Record<string, string> {
  const token = process.env.SAFARI_RPA_API_TOKEN || process.env.MACRPA_API_TOKEN || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Safari RPA returned non-JSON response");
  }
}

function normalizeRemoteWorkflows(value: unknown): SafariRpaRemoteWorkflow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [{
      id: item.id,
      version: typeof item.version === "string" ? item.version : undefined,
      title: typeof item.title === "string" ? item.title : undefined,
      available: typeof item.available === "boolean" ? item.available : undefined,
      capabilities: Array.isArray(item.capabilities) ? item.capabilities.filter((capability): capability is string => typeof capability === "string") : undefined
    }];
  });
}

function normalizeRunRecords(value: unknown): SafariRpaRunRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => normalizeRunRecord(item) || []);
}

function normalizeRunRecord(value: unknown): SafariRpaRunRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.workflow_id !== "string") return null;
  return {
    id: value.id,
    workflow_id: value.workflow_id,
    status: typeof value.status === "string" ? value.status : "unknown",
    created_at: typeof value.created_at === "number" ? value.created_at : 0,
    updated_at: typeof value.updated_at === "number" ? value.updated_at : 0,
    error: value.error,
    output: value.output,
    cancel_requested: typeof value.cancel_requested === "boolean" ? value.cancel_requested : undefined
  };
}

function normalizeArtifactRecords(value: unknown): SafariRpaArtifactRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.run_id !== "string" || typeof item.type !== "string" || typeof item.path !== "string") {
      return [];
    }
    return [{
      id: item.id,
      run_id: item.run_id,
      step_key: typeof item.step_key === "string" || item.step_key === null ? item.step_key : undefined,
      type: item.type,
      path: item.path,
      metadata: item.metadata,
      created_at: typeof item.created_at === "number" ? item.created_at : undefined
    }];
  });
}

function normalizeReportRecords(value: unknown): SafariRpaReportRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.workflow_id !== "string" ||
      typeof item.report_date !== "string" ||
      typeof item.type !== "string" ||
      typeof item.path !== "string"
    ) {
      return [];
    }
    return [{
      id: item.id,
      workflow_id: item.workflow_id,
      report_date: item.report_date,
      type: item.type,
      path: item.path,
      record_count: typeof item.record_count === "number" ? item.record_count : 0,
      metadata: item.metadata,
      created_at: typeof item.created_at === "number" ? item.created_at : 0,
      updated_at: typeof item.updated_at === "number" ? item.updated_at : 0
    }];
  });
}

function normalizeScheduleRecords(value: unknown): SafariRpaScheduleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.workflow_id !== "string" ||
      typeof item.config_path !== "string" ||
      typeof item.daily_at !== "string" ||
      typeof item.timezone !== "string" ||
      typeof item.agent_label !== "string" ||
      typeof item.plist_path !== "string"
    ) {
      return [];
    }
    return [{
      id: item.id,
      workflow_id: item.workflow_id,
      config_path: item.config_path,
      daily_at: item.daily_at,
      timezone: item.timezone,
      enabled: typeof item.enabled === "boolean" ? item.enabled : false,
      agent_label: item.agent_label,
      plist_path: item.plist_path,
      keep_awake: typeof item.keep_awake === "boolean" ? item.keep_awake : false,
      metadata: item.metadata,
      created_at: typeof item.created_at === "number" ? item.created_at : 0,
      updated_at: typeof item.updated_at === "number" ? item.updated_at : 0
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
