import { ArrowLeft, Play, RefreshCw, ShieldAlert } from "lucide-react";
import type {
  WorkflowDescriptor,
  WorkflowRunDetailSnapshot,
  WorkflowRuntimeSnapshot,
  WorkflowServiceCheckResult
} from "../../../../shared/workflows/types";
import { Button } from "../../../shared/components/Button";
import { Card } from "../../../shared/components/Card";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { RunDetailPanel } from "./RunDetailPanel";
import { RuntimeSnapshotPanel } from "./RuntimeSnapshotPanel";
import { ServiceCheckResult } from "./ServiceCheckResult";
import { engineLabel, statusLabel } from "./workflowDisplay";

export function WorkflowDetail({
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
{`SAFARI_RPA_API_TOKEN=replace-me uv run --package browser-workflow-safari-rpa \\
  safari-rpa --home local-api-usage/safari-rpa/var serve --host 127.0.0.1 --port 3211`}
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}
