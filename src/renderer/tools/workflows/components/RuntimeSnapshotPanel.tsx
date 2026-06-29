import type {
  SafariRpaReportRecord,
  SafariRpaScheduleRecord,
  WorkflowRuntimeSnapshot
} from "../../../../shared/workflows/types";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { ServiceCheckResult } from "./ServiceCheckResult";
import { formatTimestamp } from "./workflowDisplay";

export function RuntimeSnapshotPanel({
  snapshot,
  loadingRunDetail,
  onLoadRunDetail
}: {
  snapshot: WorkflowRuntimeSnapshot;
  loadingRunDetail: boolean;
  onLoadRunDetail: (runId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <ServiceCheckResult result={snapshot} />
      {snapshot.status === "connected" ? (
        <>
          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">Safari RPA Workflows</h3>
            <div className="mt-2 space-y-2">
              {snapshot.workflows.length > 0 ? (
                snapshot.workflows.map((workflow) => (
                  <div key={workflow.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="font-medium text-slate-900">{workflow.title || workflow.id}</div>
                    <div className="mt-1 break-all text-xs text-slate-500">{workflow.id}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {workflow.version ? <StatusBadge value={`v${workflow.version}`} /> : null}
                      {workflow.available !== undefined ? <StatusBadge value={workflow.available ? "available" : "unavailable"} /> : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No workflows returned.</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">Recent Runs</h3>
            <div className="mt-2 space-y-2">
              {snapshot.runs.length > 0 ? (
                snapshot.runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => onLoadRunDetail(run.id)}
                    disabled={loadingRunDetail}
                    className="block w-full rounded-md border border-slate-200 bg-white p-3 text-left text-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all font-medium text-slate-900">{run.workflow_id}</span>
                      <StatusBadge value={run.status} />
                    </div>
                    <div className="mt-1 break-all text-xs text-slate-500">{run.id}</div>
                    <div className="mt-2 text-xs text-slate-500">updated {formatTimestamp(run.updated_at)}</div>
                  </button>
                ))
              ) : (
                <p className="text-sm text-slate-500">No recent runs returned.</p>
              )}
            </div>
          </div>

          <ReportList reports={snapshot.reports} />
          <ScheduleList schedules={snapshot.schedules} />
        </>
      ) : null}
    </div>
  );
}

function ReportList({ reports }: { reports: SafariRpaReportRecord[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">Reports</h3>
      <div className="mt-2 space-y-2">
        {reports.length > 0 ? (
          reports.map((report) => (
            <div key={report.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium text-slate-900">{report.type}</span>
                <StatusBadge value={`${report.record_count} rows`} />
              </div>
              <div className="mt-1 break-all text-xs text-slate-500">{report.id}</div>
              <div className="mt-2 grid gap-1 text-xs text-slate-500">
                <div>date {report.report_date}</div>
                <div>updated {formatTimestamp(report.updated_at)}</div>
                <div className="break-all">{report.path}</div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">No reports returned.</p>
        )}
      </div>
    </div>
  );
}

function ScheduleList({ schedules }: { schedules: SafariRpaScheduleRecord[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">Schedules</h3>
      <div className="mt-2 space-y-2">
        {schedules.length > 0 ? (
          schedules.map((schedule) => (
            <div key={schedule.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium text-slate-900">{schedule.id}</span>
                <StatusBadge value={schedule.enabled ? "enabled" : "disabled"} />
              </div>
              <div className="mt-2 grid gap-1 text-xs text-slate-500">
                <div>
                  {schedule.daily_at} {schedule.timezone}
                </div>
                <div>keep awake {schedule.keep_awake ? "yes" : "no"}</div>
                <div>updated {formatTimestamp(schedule.updated_at)}</div>
                <div className="break-all">{schedule.config_path}</div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">No schedules returned.</p>
        )}
      </div>
    </div>
  );
}
