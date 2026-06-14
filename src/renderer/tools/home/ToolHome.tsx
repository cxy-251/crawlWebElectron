import { ArrowRight, Bot, Upload } from "lucide-react";

export function ToolHome({
  onEnterVideoUpload,
  onEnterBrowserAutomation
}: {
  onEnterVideoUpload: () => void;
  onEnterBrowserAutomation: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">工具首页</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">CrawlWebElectron</h1>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
            <Upload size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-950">视频上传</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">打开上传页，填写视频发布信息，执行单条视频上传。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEnterVideoUpload}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          进入
          <ArrowRight size={16} />
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
            <Bot size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-950">浏览器自动化</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">打开网页工具，执行当前页面上的自动化动作。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEnterBrowserAutomation}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          进入
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}
