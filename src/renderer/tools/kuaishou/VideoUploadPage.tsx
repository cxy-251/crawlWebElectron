import { ArrowLeft } from "lucide-react";
import { KuaishouUploadPanel } from "./KuaishouUploadPanel";

export function VideoUploadPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <ArrowLeft size={16} />
        返回首页
      </button>

      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">当前面板：快手视频上传</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">视频上传</h1>
      </div>

      <KuaishouUploadPanel />
    </div>
  );
}
