import type { KuaishouUploadTaskResult, TaskLog } from "../../../main/video-upload/types";
import { Card } from "../../shared/components/Card";

export function TaskLogPanel({
  task,
  logs
}: {
  task: KuaishouUploadTaskResult | null;
  logs: TaskLog[];
}) {
  return (
    <Card title="任务日志">
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <Info label="taskId" value={task?.taskId || "-"} />
        <Info label="status" value={task?.status || "-"} />
        <Info label="error code" value={task?.error?.code || "-"} />
        <Info label="error message" value={task?.error?.message || "-"} />
        <Info label="screenshot 路径" value={task?.artifacts?.find((item) => item.type === "screenshot")?.filePath || "-"} />
        <Info label="DOM snapshot 路径" value={task?.artifacts?.find((item) => item.type === "dom_snapshot")?.filePath || "-"} />
        <Info label="error report 路径" value={task?.artifacts?.find((item) => item.type === "error_report")?.filePath || "-"} />
      </div>
      <div className="max-h-56 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
        {logs.length === 0 ? <div className="text-slate-400">暂无日志</div> : null}
        {logs.map((log) => (
          <div key={log.id} className="grid grid-cols-[92px_120px_1fr] gap-2 border-b border-white/10 py-1">
            <span className="text-slate-400">{new Date(log.createdAt).toLocaleTimeString()}</span>
            <span>{log.step}</span>
            <span>{log.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-slate-500">{label}</div>
      <div className="truncate text-slate-800" title={value}>
        {value}
      </div>
    </div>
  );
}

