import { RefreshCw } from "lucide-react";
import type { KuaishouDiagnosticEvidence, KuaishouDomDiagnostic, KuaishouElementKey } from "../../../main/video-upload/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";
import { StatusBadge } from "../../shared/components/StatusBadge";

const ELEMENT_LABELS: Record<KuaishouElementKey, string> = {
  loginRequiredHints: "登录提示",
  draftContinueButton: "继续草稿",
  uploadEntryButton: "上传入口",
  fileInput: "视频文件框",
  captionEditor: "发布文案",
  coverButton: "封面按钮",
  coverFileInput: "封面文件框",
  pkCoverSwitch: "PK 封面",
  chapterButton: "章节按钮",
  authorServiceSelect: "作者服务",
  benefitSelect: "作者服务收益",
  hotspotInput: "关联热点",
  authorStatementInput: "作者声明",
  collectionSelect: "合集选择",
  locationRegionSelect: "地区选择",
  locationAddressInput: "详细地址",
  allowSameFrameCheckbox: "允许同框",
  allowDownloadCheckbox: "允许下载",
  showNearbyCheckbox: "同城展示",
  visibilityPublicRadio: "公开可见",
  visibilityFriendsRadio: "好友可见",
  visibilityPrivateRadio: "私密可见",
  publishTimeToggle: "定时开关",
  publishTimeInput: "定时时间",
  publishNowRadio: "立即发布",
  scheduledPublishRadio: "定时发布",
  bestTimeButton: "活跃时间",
  uploadProgressHints: "上传中",
  uploadCompleteHints: "上传完成",
  publishButton: "发布按钮",
  errorToast: "错误提示"
};

export function KuaishouDomDiagnosticsPanel({
  diagnostic,
  evidence,
  busy,
  onRun,
  onCaptureEvidence
}: {
  diagnostic: KuaishouDomDiagnostic | null;
  evidence: KuaishouDiagnosticEvidence | null;
  busy: boolean;
  onRun: () => void;
  onCaptureEvidence: () => void;
}) {
  const missingResults = diagnostic?.elementResults.filter((result) => !result.ok) || [];
  const matchedResults = diagnostic?.elementResults.filter((result) => result.ok) || [];

  return (
    <Card title="DOM 诊断">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRun} disabled={busy}>
            <RefreshCw size={16} />
            {busy ? "巡检中" : "全量巡检"}
          </Button>
          <Button onClick={onCaptureEvidence} disabled={busy}>保存证据</Button>
          {diagnostic ? (
            <>
              <StatusBadge value={`命中 ${diagnostic.matchedCount}`} />
              <StatusBadge value={`缺失 ${diagnostic.missingCount}`} />
              <StatusBadge value={diagnostic.detection.pageType} />
            </>
          ) : null}
        </div>

        {diagnostic ? (
          <>
            <div className="grid grid-cols-1 gap-2 text-xs text-slate-600">
              <Info label="profile" value={`${diagnostic.profile.name} v${diagnostic.profile.version}`} />
              <Info label="url" value={diagnostic.detection.url} />
              <Info label="checked" value={new Date(diagnostic.checkedAt).toLocaleString()} />
            </div>

            {evidence ? <EvidencePanel evidence={evidence} /> : null}

            <ResultGroup title="缺失控件" results={missingResults} tone="missing" />
            <ResultGroup title="命中控件" results={matchedResults} tone="matched" />
          </>
        ) : (
          <>
            {evidence ? <EvidencePanel evidence={evidence} /> : null}
            {!evidence ? <p className="text-sm text-slate-500">暂无诊断结果。</p> : null}
          </>
        )}
      </div>
    </Card>
  );
}

function EvidencePanel({ evidence }: { evidence: KuaishouDiagnosticEvidence }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">Evidence</h3>
      <div className="mt-2 grid gap-2 text-xs text-slate-600">
        <Info label="pageType" value={evidence.detection.pageType} />
        <Info label="captured" value={new Date(evidence.capturedAt).toLocaleString()} />
        <Info label="screenshot" value={evidence.screenshotPath} />
        <Info label="dom" value={evidence.domSnapshotPath} />
      </div>
    </div>
  );
}

function ResultGroup({
  title,
  results,
  tone
}: {
  title: string;
  results: KuaishouDomDiagnostic["elementResults"];
  tone: "missing" | "matched";
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      <div className="mt-2 space-y-2">
        {results.length > 0 ? (
          results.map((result) => (
            <details key={result.locatorKey} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{ELEMENT_LABELS[result.locatorKey] || result.locatorKey}</div>
                    <div className="break-all text-xs text-slate-500">{result.locatorKey}</div>
                  </div>
                  <span className={tone === "matched" ? "text-xs font-medium text-emerald-700" : "text-xs font-medium text-rose-700"}>
                    {result.matchedCount}
                  </span>
                </div>
              </summary>
              <div className="mt-3 space-y-2">
                {result.attempts.map((attempt, index) => (
                  <div key={`${result.locatorKey}-${index}`} className="rounded-md bg-white p-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span>{attempt.locator.type}</span>
                      <span>{attempt.matchedCount}</span>
                    </div>
                    <pre className="mt-1 max-h-28 overflow-auto rounded bg-slate-950 p-2 text-slate-100">
                      {JSON.stringify(attempt.locator, null, 2)}
                    </pre>
                    {attempt.error ? <div className="mt-1 break-words text-rose-700">{attempt.error}</div> : null}
                  </div>
                ))}
              </div>
            </details>
          ))
        ) : (
          <p className="text-sm text-slate-500">无。</p>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-2 rounded-md bg-slate-50 px-2 py-1">
      <span className="font-medium text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-slate-800">{value || "-"}</span>
    </div>
  );
}
