import { ArrowLeft, CheckCircle2, ExternalLink, Layers, Play, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  SafariRpaReportRecord,
  SafariRpaRunRecord,
  SafariRpaScheduleRecord,
  WorkflowDescriptor,
  WorkflowRunDetailSnapshot,
  WorkflowRuntimeSnapshot,
  WorkflowServiceCheckResult
} from "../../../shared/workflows/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";
import { StatusBadge } from "../../shared/components/StatusBadge";

const engineLabel: Record<WorkflowDescriptor["engine"], string> = {
  electron: "Electron",
  "safari-rpa": "Safari RPA",
  "safari-extension": "Safari Extension"
};

const statusLabel: Record<WorkflowDescriptor["status"], string> = {
  available: "可用",
  external: "外部服务",
  prototype: "原型",
  disabled: "停用"
};

export function WorkflowCatalogPage({
  onBack,
  onOpenVideoUpload
}: {
  onBack: () => void;
  onOpenVideoUpload: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowDescriptor[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDescriptor | null>(null);
  const [serviceCheck, setServiceCheck] = useState<WorkflowServiceCheckResult | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<WorkflowRuntimeSnapshot | null>(null);
  const [runDetail, setRunDetail] = useState<WorkflowRunDetailSnapshot | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    window.appApi.workflows
      .listWorkflows()
      .then((items) => {
        if (mounted) setWorkflows(items);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      {!selectedWorkflow ? (
        <Button onClick={onBack}>
          <ArrowLeft size={16} />
          返回首页
        </Button>
      ) : null}

      {selectedWorkflow ? (
        <WorkflowDetail
          workflow={selectedWorkflow}
          serviceCheck={serviceCheck}
          checking={checking}
          runtimeSnapshot={runtimeSnapshot}
          loadingSnapshot={loadingSnapshot}
          runDetail={runDetail}
          loadingRunDetail={loadingRunDetail}
          onBack={() => {
            setSelectedWorkflow(null);
            setServiceCheck(null);
            setRuntimeSnapshot(null);
            setRunDetail(null);
          }}
          onCheckService={() => void checkSelectedService(selectedWorkflow)}
          onLoadRuntimeSnapshot={() => void loadRuntimeSnapshot(selectedWorkflow)}
          onLoadRunDetail={(runId) => void loadRunDetail(selectedWorkflow, runId)}
        />
      ) : (
        <>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">工作流</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Browser Workflows</h1>
          </div>

          {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

          <div className="space-y-3">
            {workflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                workflow={workflow}
                onOpen={() => {
                  if (workflow.id === "kuaishou.upload-single.v1") {
                    onOpenVideoUpload();
                    return;
                  }
                  setSelectedWorkflow(workflow);
                  setServiceCheck(null);
                  setRuntimeSnapshot(null);
                  setRunDetail(null);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );

  async function checkSelectedService(workflow: WorkflowDescriptor): Promise<void> {
    setChecking(true);
    setServiceCheck(null);
    try {
      setServiceCheck(await window.appApi.workflows.checkService(workflow.id));
    } catch (checkError) {
      setServiceCheck({
        ok: false,
        status: "unreachable",
        message: checkError instanceof Error ? checkError.message : String(checkError)
      });
    } finally {
      setChecking(false);
    }
  }

  async function loadRuntimeSnapshot(workflow: WorkflowDescriptor): Promise<void> {
    setLoadingSnapshot(true);
    setRuntimeSnapshot(null);
    setRunDetail(null);
    try {
      setRuntimeSnapshot(await window.appApi.workflows.getRuntimeSnapshot(workflow.id));
    } catch (snapshotError) {
      setRuntimeSnapshot({
        ok: false,
        status: "unreachable",
        message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
        workflows: [],
        runs: [],
        reports: [],
        schedules: []
      });
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function loadRunDetail(workflow: WorkflowDescriptor, runId: string): Promise<void> {
    setLoadingRunDetail(true);
    setRunDetail(null);
    try {
      setRunDetail(await window.appApi.workflows.getRunDetail(workflow.id, runId));
    } catch (detailError) {
      setRunDetail({
        ok: false,
        status: "unreachable",
        message: detailError instanceof Error ? detailError.message : String(detailError),
        run: null,
        artifacts: []
      });
    } finally {
      setLoadingRunDetail(false);
    }
  }
}

function WorkflowCard({ workflow, onOpen }: { workflow: WorkflowDescriptor; onOpen: () => void }) {
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

function WorkflowDetail({
  workflow,
  serviceCheck,
  checking,
  runtimeSnapshot,
  loadingSnapshot,
  runDetail,
  loadingRunDetail,
  onBack,
  onCheckService,
  onLoadRuntimeSnapshot,
  onLoadRunDetail
}: {
  workflow: WorkflowDescriptor;
  serviceCheck: WorkflowServiceCheckResult | null;
  checking: boolean;
  runtimeSnapshot: WorkflowRuntimeSnapshot | null;
  loadingSnapshot: boolean;
  runDetail: WorkflowRunDetailSnapshot | null;
  loadingRunDetail: boolean;
  onBack: () => void;
  onCheckService: () => void;
  onLoadRuntimeSnapshot: () => void;
  onLoadRunDetail: (runId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Button onClick={onBack}>
        <ArrowLeft size={16} />
        返回工作流
      </Button>

      <Card>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-slate-500">工作流详情</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{workflow.title}</h1>
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
            <StatusBadge value={`v${workflow.version}`} />
          </div>
        </div>
      </Card>

      <Card title="Source">
        <div className="space-y-2 text-sm text-slate-700">
          <InfoRow label="kind" value={workflow.source.kind} />
          <InfoRow label="path" value={workflow.source.relativePath || "built-in"} />
          {workflow.source.apiBaseUrl ? <InfoRow label="api" value={workflow.source.apiBaseUrl} /> : null}
          {workflow.runApiPath ? <InfoRow label="run api" value={workflow.runApiPath} /> : null}
        </div>
      </Card>

      <Card title="Capabilities">
        <div className="flex flex-wrap gap-2">
          {workflow.capabilities.map((capability) => (
            <StatusBadge key={capability} value={capability} />
          ))}
        </div>
      </Card>

      {workflow.engine === "safari-rpa" ? (
        <Card title="Safari RPA Service">
          <div className="space-y-3">
            <pre className="overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
{`cd runtimes/safari-rpa
SAFARI_RPA_API_TOKEN=replace-me PYTHONPATH=src conda run -n kwai \\
  safari-rpa --home var serve --host 127.0.0.1 --port 3211`}
            </pre>
            <Button onClick={onCheckService} disabled={checking}>
              <RefreshCw size={16} />
              {checking ? "检查中" : "检查服务"}
            </Button>
            {serviceCheck ? <ServiceCheckResult result={serviceCheck} /> : null}
            <Button onClick={onLoadRuntimeSnapshot} disabled={loadingSnapshot}>
              <RefreshCw size={16} />
              {loadingSnapshot ? "读取中" : "读取运行时"}
            </Button>
            {runtimeSnapshot ? (
              <RuntimeSnapshotPanel
                snapshot={runtimeSnapshot}
                loadingRunDetail={loadingRunDetail}
                onLoadRunDetail={onLoadRunDetail}
              />
            ) : null}
            {runDetail ? <RunDetailPanel detail={runDetail} /> : null}
          </div>
        </Card>
      ) : null}

      {workflow.engine === "safari-extension" ? (
        <Card title="Prototype">
          <div className="flex items-start gap-2 text-sm leading-6 text-slate-600">
            <Play className="mt-1 shrink-0" size={16} />
            <p>这个工作流目前是 Safari Extension 原型，仅用于后续桥接验证。</p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function RuntimeSnapshotPanel({
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

function RunDetailPanel({ detail }: { detail: WorkflowRunDetailSnapshot }) {
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

function ServiceCheckResult({ result }: { result: WorkflowServiceCheckResult }) {
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}

function formatTimestamp(value: number): string {
  if (!value) return "unknown";
  return new Date(value * 1000).toLocaleString();
}
