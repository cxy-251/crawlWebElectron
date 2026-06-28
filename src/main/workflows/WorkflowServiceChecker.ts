import type { WorkflowDescriptor, WorkflowServiceCheckResult } from "../../shared/workflows/types";

const DEFAULT_TIMEOUT_MS = 2000;

export async function checkWorkflowService(
  descriptor: WorkflowDescriptor,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<WorkflowServiceCheckResult> {
  if (descriptor.engine !== "safari-rpa" || !descriptor.source.apiBaseUrl) {
    return {
      ok: true,
      status: "not_applicable",
      message: "This workflow does not use an external service check."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUrl = descriptor.source.apiBaseUrl.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    const data = await readJsonSafely(response);
    if (!response.ok) {
      return {
        ok: false,
        status: "unreachable",
        message: `Safari RPA service returned HTTP ${response.status}.`,
        data
      };
    }
    return {
      ok: true,
      status: "connected",
      message: "Safari RPA service is reachable.",
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: "unreachable",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
