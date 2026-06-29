import { ExternalLink, Layers, ShieldAlert } from "lucide-react";
import type { WorkflowDescriptor } from "../../../../shared/workflows/types";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { engineLabel, statusLabel } from "./workflowDisplay";

export function WorkflowCard({ workflow, onOpen }: { workflow: WorkflowDescriptor; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">{workflow.title}</h2>
            <p className="mt-1 break-all text-xs text-slate-500">{workflow.id}</p>
          </div>
          {workflow.risk === "high" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
              <ShieldAlert size={13} />
              高风险
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusBadge value={engineLabel[workflow.engine]} />
          <StatusBadge value={statusLabel[workflow.status]} />
          <StatusBadge value={workflow.site} />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Layers size={14} />
          <span>{workflow.source.relativePath || workflow.source.kind}</span>
        </div>

        {workflow.runApiPath ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ExternalLink size={14} />
            <span>{workflow.runApiPath}</span>
          </div>
        ) : null}
      </div>
    </button>
  );
}
