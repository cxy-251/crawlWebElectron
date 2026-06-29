import type { SafariRpaRunRecord, WorkflowRunDetailSnapshot } from "../../../../shared/workflows/types";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { ServiceCheckResult } from "./ServiceCheckResult";
import { formatTimestamp } from "./workflowDisplay";

export function RunDetailPanel({ detail }: { detail: WorkflowRunDetailSnapshot }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-xs font-semibold uppercase text-slate-500">Run Detail</h3>
      <div className="space-y-3">
        <ServiceCheckResult result={detail} />
        {detail.run ? <RunRecordPanel run={detail.run} /> : null}
        <div>
          <h3 className="text-xs font-semibold uppercase text-slate-500">Artifacts</h3>
          <div className="mt-2 space-y-2">
            {detail.artifacts.length > 0 ? (
              detail.artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{artifact.type}</span>
                    {artifact.created_at ? <span className="text-xs text-slate-500">{formatTimestamp(artifact.created_at)}</span> : null}
                  </div>
                  <div className="mt-1 break-all text-xs text-slate-500">{artifact.path}</div>
                  {artifact.step_key ? <div className="mt-1 break-all text-xs text-slate-500">step {artifact.step_key}</div> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No artifacts returned.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunRecordPanel({ run }: { run: SafariRpaRunRecord }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-all font-medium text-slate-900">{run.workflow_id}</span>
        <StatusBadge value={run.status} />
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-500">
        <div className="break-all">run {run.id}</div>
        <div>created {formatTimestamp(run.created_at)}</div>
        <div>updated {formatTimestamp(run.updated_at)}</div>
        {run.cancel_requested !== undefined ? <div>cancel requested {run.cancel_requested ? "yes" : "no"}</div> : null}
      </div>
      {run.error ? <JsonBlock title="Error" value={run.error} /> : null}
      {run.output ? <JsonBlock title="Output" value={run.output} /> : null}
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase text-slate-500">{title}</h4>
      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
