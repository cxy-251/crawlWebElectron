import { CheckCircle2, XCircle } from "lucide-react";
import type { WorkflowServiceCheckResult } from "../../../../shared/workflows/types";

export function ServiceCheckResult({ result }: { result: WorkflowServiceCheckResult }) {
  const connected = result.status === "connected";
  const unavailable = result.status === "unreachable";

  return (
    <div
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
        connected
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : unavailable
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {connected ? <CheckCircle2 className="mt-0.5 shrink-0" size={16} /> : <XCircle className="mt-0.5 shrink-0" size={16} />}
      <div className="min-w-0">
        <p className="font-medium">{result.status}</p>
        <p className="mt-1 break-words">{result.message}</p>
      </div>
    </div>
  );
}
