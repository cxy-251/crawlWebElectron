import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  WorkflowDescriptor,
  WorkflowRunDetailSnapshot,
  WorkflowRuntimeSnapshot,
  WorkflowServiceCheckResult
} from "../../../shared/workflows/types";
import { Button } from "../../shared/components/Button";
import { WorkflowCard } from "./components/WorkflowCard";
import { WorkflowDetail } from "./components/WorkflowDetail";

export function WorkflowCatalogPage({
  onBack,
  onOpenKuaishou
}: {
  onBack: () => void;
  onOpenKuaishou: () => void;
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
            clearRuntimeState();
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
                    onOpenKuaishou();
                    return;
                  }
                  setSelectedWorkflow(workflow);
                  clearRuntimeState();
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );

  function clearRuntimeState(): void {
    setServiceCheck(null);
    setRuntimeSnapshot(null);
    setRunDetail(null);
  }

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
