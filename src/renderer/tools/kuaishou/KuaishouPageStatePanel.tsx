import type { KuaishouPageDetection } from "../../../shared/kuaishou/types";
import { Card } from "../../shared/components/Card";
import { StatusBadge } from "../../shared/components/StatusBadge";

export function KuaishouPageStatePanel({ detection }: { detection: KuaishouPageDetection | null }) {
  const capabilities = detection?.capabilities;

  return (
    <Card title="页面状态">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info label="URL" value={detection?.url || "-"} wide />
        <Info label="Title" value={detection?.title || "-"} wide />
        <Info label="pageType" value={detection?.pageType || "unknown"} />
        <Info label="loginRequired" value={capabilities?.loginRequired ? "true" : "false"} />
        <Info label="confidence" value={detection ? `${Math.round(detection.confidence * 100)}%` : "-"} />
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">platform</div>
          <StatusBadge value="kuaishou" />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase text-slate-500">当前页面能力</h3>
        <div className="grid grid-cols-1 gap-2 text-xs">
          <Capability label="草稿继续按钮" value={capabilities?.hasDraftContinueButton} />
          <Capability label="发布文案输入框" value={capabilities?.hasCaptionEditor} />
          <Capability label="上传入口按钮" value={capabilities?.hasUploadEntryButton} />
          <Capability label="发布按钮" value={capabilities?.hasPublishButton} />
          <Capability label="可编辑内容" value={capabilities?.hasEditableContent} />
          <Capability label="视频文件选择框" value={capabilities?.hasFileInput} />
          <Capability label="封面设置" value={capabilities?.hasCoverSettings} />
          <Capability label="PK 封面开关" value={capabilities?.hasPkCoverSwitch} />
          <Capability label="章节按钮" value={capabilities?.hasChapterButton} />
          <Capability label="作者服务" value={capabilities?.hasAuthorServiceSelect} />
          <Capability label="关联热点" value={capabilities?.hasHotspotInput} />
          <Capability label="作者声明" value={capabilities?.hasAuthorStatementInput} />
          <Capability label="加入合集" value={capabilities?.hasCollectionSelect} />
          <Capability label="地点字段" value={Boolean(capabilities?.hasLocationRegionSelect || capabilities?.hasLocationAddressInput)} />
          <Capability label="互动设置" value={capabilities?.hasInteractionSettings} />
          <Capability label="查看权限" value={capabilities?.hasVisibilitySettings} />
          <Capability label="发布时间设置" value={capabilities?.hasPublishTimingSettings} />
          <Capability label="上传中提示" value={capabilities?.hasUploadProgress} />
          <Capability label="上传完成提示" value={capabilities?.hasUploadComplete} />
          <Capability label="发布时间输入框" value={capabilities?.hasPublishTimeInput} />
        </div>
      </div>
    </Card>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="truncate rounded-md bg-slate-50 px-2 py-1 text-slate-800" title={value}>
        {value}
      </div>
    </div>
  );
}

function Capability({ label, value }: { label: string; value?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-slate-700">
      <span>{label}</span>
      <span className={value ? "font-medium text-emerald-700" : "text-slate-400"}>{value ? "已找到" : "未找到"}</span>
    </div>
  );
}
