import type { WorkflowDescriptor } from "../../../../shared/workflows/types";

export const engineLabel: Record<WorkflowDescriptor["engine"], string> = {
  electron: "Electron",
  "safari-rpa": "Safari RPA",
  "safari-extension": "Safari Extension"
};

export const statusLabel: Record<WorkflowDescriptor["status"], string> = {
  available: "可用",
  external: "外部服务",
  prototype: "原型",
  disabled: "停用"
};

export function formatTimestamp(value: number): string {
  if (!value) return "unknown";
  return new Date(value * 1000).toLocaleString();
}
