import { useEffect, useMemo, useState } from "react";
import type {
  ElementTestResult,
  KuaishouDiagnosticEvidence,
  KuaishouDomDiagnostic,
  KuaishouElementKey,
  KuaishouElementProfile,
  KuaishouFormField,
  KuaishouFormState,
  KuaishouOptionField,
  KuaishouOptionsResult,
  KuaishouPageDetection,
  KuaishouPageSnapshot,
  KuaishouUploadTaskResult,
  KuaishouWebEditableField,
  TaskLog
} from "../../../shared/kuaishou/types";
import { useAsyncAction } from "../../shared/hooks/useAsyncAction";
import { Card } from "../../shared/components/Card";
import { ElementProfilePanel } from "./ElementProfilePanel";
import { KuaishouDomDiagnosticsPanel } from "./KuaishouDomDiagnosticsPanel";
import { formatKuaishouFailureMessage, KuaishouFailureContextPanel, parseKuaishouFailureContext } from "./KuaishouFailureContextPanel";
import { KuaishouActionBar } from "./KuaishouActionBar";
import { KuaishouPageStatePanel } from "./KuaishouPageStatePanel";
import { KuaishouUploadForm } from "./KuaishouUploadForm";
import { TaskLogPanel } from "./TaskLogPanel";

type Conflict = {
  field: KuaishouWebEditableField;
  uiValue: string;
  pageValue: string;
};

const WEB_EDITABLE_FIELDS: KuaishouWebEditableField[] = [
  "caption",
  "pkCoverEnabled",
  "chaptersText",
  "authorServiceType",
  "linkedBenefit",
  "hotspot",
  "authorStatement",
  "collectionName",
  "locationRegion",
  "locationAddress",
  "allowSameFrame",
  "allowDownload",
  "showInNearby",
  "visibility",
  "publishTimingMode",
  "scheduledPublishTime",
  "useBestTimeSuggestion"
];

const initialForm: KuaishouFormState = {
  videoPath: "",
  coverPath: "",
  caption: "",
  pkCoverEnabled: undefined,
  chaptersText: "",
  authorServiceType: "",
  linkedBenefit: "",
  hotspot: "",
  authorStatement: "",
  collectionName: "",
  locationRegion: "",
  locationAddress: "",
  allowSameFrame: true,
  allowDownload: true,
  showInNearby: true,
  visibility: "public",
  publishTimingMode: "scheduled",
  scheduledPublishTime: "",
  useBestTimeSuggestion: false,
  publishMode: "manual_confirm",
  dirtyFields: [],
  lastUpdatedBy: "ui",
  updatedAt: Date.now()
};

export function KuaishouUploadPanel() {
  const [detection, setDetection] = useState<KuaishouPageDetection | null>(null);
  const [profile, setProfile] = useState<KuaishouElementProfile | null>(null);
  const [form, setForm] = useState<KuaishouFormState>(initialForm);
  const [snapshot, setSnapshot] = useState<KuaishouPageSnapshot | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [domDiagnostic, setDomDiagnostic] = useState<KuaishouDomDiagnostic | null>(null);
  const [diagnosticEvidence, setDiagnosticEvidence] = useState<KuaishouDiagnosticEvidence | null>(null);
  const [optionsByField, setOptionsByField] = useState<Partial<Record<KuaishouOptionField, KuaishouOptionsResult>>>({});
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState("");
  const [task, setTask] = useState<KuaishouUploadTaskResult | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const { busy, error, run, setError } = useAsyncAction();

  const taskId = task?.taskId || "";
  const pageHasEditableContent = Boolean(detection?.capabilities.hasEditableContent);
  const rawActionMessage = syncError || error;
  const failureContext = useMemo(() => parseKuaishouFailureContext(rawActionMessage), [rawActionMessage]);
  const mergedError = failureContext ? formatKuaishouFailureMessage(rawActionMessage) : rawActionMessage;

  useEffect(() => {
    void run(async () => {
      const [nextProfile, nextDetection] = await Promise.all([
        window.appApi.kuaishou.getElementProfile(),
        window.appApi.kuaishou.detectPage()
      ]);
      setProfile(nextProfile);
      setDetection(nextDetection);
    });
  }, [run]);

  useEffect(() => {
    if (!taskId) return;

    void window.appApi.kuaishou.getTaskLogs(taskId).then(setLogs);
  }, [taskId, task?.status]);

  function updateFormField(field: KuaishouFormField, value: string | boolean | undefined) {
    setForm((current) => ({
      ...current,
      [field]: value,
      dirtyFields: Array.from(new Set([...current.dirtyFields, field])),
      lastUpdatedBy: "ui",
      updatedAt: Date.now()
    }));
  }

  async function pickLocalFile(kind: "video" | "cover", field: "videoPath" | "coverPath"): Promise<string> {
    const result = await window.appApi.kuaishou.pickLocalFile(kind);
    if (result.canceled || !result.filePath) {
      return "";
    }

    setForm((current) => ({
      ...current,
      [field]: result.filePath,
      dirtyFields: Array.from(new Set([...current.dirtyFields, field])),
      lastUpdatedBy: "ui",
      updatedAt: Date.now()
    }));
    return result.filePath;
  }

  async function pickVideoFile() {
    await run(async () => {
      await pickLocalFile("video", "videoPath");
    });
  }

  async function pickCoverFile() {
    await run(async () => {
      await pickLocalFile("cover", "coverPath");
    });
  }

  async function detectAndStore(): Promise<KuaishouPageDetection> {
    const nextDetection = await window.appApi.kuaishou.detectPage();
    setDetection(nextDetection);
    return nextDetection;
  }

  async function refreshDetection() {
    await run(async () => {
      await detectAndStore();
    });
  }

  async function runDomDiagnostic() {
    await run(async () => {
      const result = await window.appApi.kuaishou.diagnoseDom();
      setDomDiagnostic(result);
      setDetection(result.detection);
      setSyncError(result.missingCount > 0 ? `DOM 巡检完成，缺失 ${result.missingCount} 个 selector。` : "DOM 巡检完成，当前 selector 均有命中。");
    });
  }

  async function captureDiagnosticEvidence() {
    await run(async () => {
      const result = await window.appApi.kuaishou.captureDiagnosticEvidence();
      setDiagnosticEvidence(result);
      setDetection(result.detection);
      setSyncError("已保存当前页面诊断证据。");
    });
  }

  async function readPageFields() {
    setSyncError("");
    const nextSnapshot = await window.appApi.kuaishou.readPageState();
    setSnapshot(nextSnapshot);
    setLastSyncAt(Date.now());

    const nextConflicts = collectConflicts(form, snapshot, nextSnapshot);
    setConflicts(nextConflicts);

    setForm((current) => {
      const nextForm: KuaishouFormState = { ...current };
      const conflictFields = new Set(nextConflicts.map((conflict) => conflict.field));

      for (const field of WEB_EDITABLE_FIELDS) {
        const value = nextSnapshot.fields[field];
        if (value === undefined) continue;
        if (current.dirtyFields.includes(field) || conflictFields.has(field)) continue;
        (nextForm as Record<string, unknown>)[field] = value;
      }

      return {
        ...nextForm,
        lastUpdatedBy: "page",
        updatedAt: Date.now()
      };
    });
  }

  async function readPageState() {
    await run(readPageFields);
  }

  async function writePageFields() {
    setSyncError("");
    const syncDirtyFields = form.dirtyFields.filter((field): field is KuaishouWebEditableField =>
      WEB_EDITABLE_FIELDS.includes(field as KuaishouWebEditableField)
    );
    const nextSnapshot = await window.appApi.kuaishou.applyFormState({
      ...form,
      dirtyFields: syncDirtyFields
    });
    setSnapshot(nextSnapshot);
    setLastSyncAt(Date.now());
    setConflicts([]);
    setForm((current) => ({
      ...current,
      dirtyFields: current.dirtyFields.filter((field) => !WEB_EDITABLE_FIELDS.includes(field as KuaishouWebEditableField)),
      lastUpdatedBy: "page",
      updatedAt: Date.now()
    }));
  }

  async function loadOptions(field: KuaishouOptionField, query?: string): Promise<KuaishouOptionsResult> {
    const result = await window.appApi.kuaishou.getOptions(field, query);
    setOptionsByField((current) => ({
      ...current,
      [field]: result
    }));
    return result;
  }

  async function applyFormState() {
    await run(writePageFields);
  }

  async function continueEditingOrStartNewUpload() {
    await run(async () => {
      setSyncError("");
      const nextDetection = await window.appApi.kuaishou.continueEditingOrStartNewUpload();
      setDetection(nextDetection);

      if (nextDetection.capabilities.loginRequired) {
        setSyncError("请先在左侧浏览器完成登录。");
        return;
      }

      if (nextDetection.capabilities.hasEditableContent) {
        await readPageFields();
      }
    });
  }

  async function waitForEditPage() {
    await run(async () => {
      setSyncError("");
      const nextDetection = await detectAndStore();

      if (nextDetection.capabilities.hasUploadProgress) {
        setSyncError("视频仍在上传或处理中，请稍后再次识别。");
        return;
      }

      if (nextDetection.capabilities.hasEditableContent) {
        await readPageFields();
        setSyncError("已进入发布参数编辑页。");
        return;
      }

      setSyncError("还没有检测到发布参数编辑控件，请等待页面跳转完成。");
    });
  }

  function resolveConflict(field: Conflict["field"], source: "ui" | "page") {
    const conflict = conflicts.find((item) => item.field === field);
    if (!conflict) return;

    if (source === "page") {
      const pageValue = snapshot?.fields[field];
      updateFormField(field, pageValue);
      setForm((current) => ({
        ...current,
        dirtyFields: current.dirtyFields.filter((dirty) => dirty !== field),
        lastUpdatedBy: "page",
        updatedAt: Date.now()
      }));
    }

    setConflicts((current) => current.filter((item) => item.field !== field));
  }

  async function uploadVideo() {
    await run(async () => {
      setSyncError("");
      const nextDetection = await detectAndStore();

      if (nextDetection.capabilities.loginRequired) {
        setSyncError("请先在左侧浏览器完成登录。");
        return;
      }

      if (nextDetection.capabilities.hasUploadProgress) {
        setSyncError("视频仍在上传或处理中，请等待进入发布参数编辑页。");
        return;
      }

      const videoPath = form.videoPath.trim();

      if (nextDetection.capabilities.hasEditableContent) {
        await writePageFields();
        setSyncError("当前已在编辑页，已写入网页参数；新视频上传不会覆盖当前编辑内容。");
        return;
      }

      if (!nextDetection.capabilities.hasFileInput) {
        setSyncError("当前页面还没有视频文件选择入口，请先点击“进入上传视频页”。");
        return;
      }

      if (nextDetection.capabilities.hasDraftContinueButton) {
        setSyncError("检测到未发布草稿。上传新视频已暂停，请先在左侧页面处理草稿后再重试。");
        return;
      }

      if (!videoPath) {
        setSyncError("请先填写或选择视频路径。");
        return;
      }

      setSyncError("正在设置视频文件，等待上传开始...");
      const result = await window.appApi.kuaishou.uploadSingleVideo({
        platform: "kuaishou",
        accountId: "default-kuaishou",
        videoPath,
        caption: form.caption,
        coverPath: form.coverPath || undefined,
        pkCoverEnabled: form.pkCoverEnabled,
        chaptersText: form.chaptersText || undefined,
        authorServiceType: form.authorServiceType || undefined,
        linkedBenefit: form.linkedBenefit || undefined,
        hotspot: form.hotspot || undefined,
        authorStatement: form.authorStatement || undefined,
        collectionName: form.collectionName || undefined,
        locationRegion: form.locationRegion || undefined,
        locationAddress: form.locationAddress || undefined,
        allowSameFrame: form.allowSameFrame,
        allowDownload: form.allowDownload,
        showInNearby: form.showInNearby,
        visibility: form.visibility,
        publishTimingMode: form.publishTimingMode,
        scheduledPublishTime: form.scheduledPublishTime || undefined,
        useBestTimeSuggestion: form.useBestTimeSuggestion,
        publishMode: form.publishMode,
        elementProfileId: profile?.id,
        uploadIntent: "current_intake",
        draftPolicy: "pause",
        dirtyFields: form.dirtyFields.filter((field): field is KuaishouWebEditableField =>
          WEB_EDITABLE_FIELDS.includes(field as KuaishouWebEditableField)
        )
      });
      setTask(result);
      setLogs(await window.appApi.kuaishou.getTaskLogs(result.taskId));
      await detectAndStore();
      setSyncError(result.ok ? "已进入发布参数编辑页或等待发布确认。" : formatTaskError(result));
    });
  }

  async function waitUploadComplete() {
    await run(async () => {
      const nextDetection = await detectAndStore();
      if (nextDetection.capabilities.hasUploadComplete || nextDetection.capabilities.hasPublishButton) {
        setSyncError("页面已进入等待发布状态。");
      } else if (nextDetection.capabilities.hasUploadProgress) {
        setSyncError("页面仍在上传中，请稍后再次识别。");
      } else {
        setSyncError("已刷新页面状态，未检测到等待发布状态。");
      }
    });
  }

  async function confirmPublish() {
    await run(async () => {
      await detectAndStore();
      if (!task?.taskId) {
        throw new Error("没有可发布的任务");
      }
      setTask(await window.appApi.kuaishou.confirmPublish(task.taskId));
      await detectAndStore();
    });
  }

  async function cancelTask() {
    if (!task?.taskId) {
      setError("没有可取消的任务");
      return;
    }

    await run(async () => {
      setTask(await window.appApi.kuaishou.cancelTask(task.taskId));
    });
  }

  async function saveProfile() {
    if (!profile) return;
    await run(async () => {
      setProfile(await window.appApi.kuaishou.updateElementProfile(profile));
    });
  }

  async function resetProfile() {
    await run(async () => {
      setProfile(await window.appApi.kuaishou.resetElementProfile());
    });
  }

  async function testElement(key: KuaishouElementKey) {
    await run(async () => {
      const result: ElementTestResult = await window.appApi.kuaishou.testElement(key);
      setSyncError(result.ok ? `${key} 匹配 ${result.matchedCount} 个元素` : `${key} 未匹配到元素`);
    });
  }

  const conflictPanel = useMemo(() => {
    if (conflicts.length === 0) return null;

    return (
      <Card title="网页参数冲突">
        <div className="space-y-3">
          {conflicts.map((conflict) => (
            <div key={conflict.field} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <div className="font-medium text-amber-950">{fieldLabel(conflict.field)}</div>
              <div className="mt-1 grid gap-1 text-amber-900">
                <span>UI：{conflict.uiValue || "-"}</span>
                <span>网页：{conflict.pageValue || "-"}</span>
              </div>
              <div className="mt-2 flex gap-2">
                <button className="rounded-md bg-amber-900 px-2 py-1 text-xs font-medium text-white" onClick={() => resolveConflict(conflict.field, "ui")}>
                  使用 UI 值
                </button>
                <button className="rounded-md bg-white px-2 py-1 text-xs font-medium text-amber-900" onClick={() => resolveConflict(conflict.field, "page")}>
                  使用网页值
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }, [conflicts, snapshot]);

  return (
    <div className="space-y-4">
      <KuaishouActionBar
        detection={detection}
        busy={busy}
        error={mergedError}
        onOpenHome={() =>
          void run(async () => {
            await window.appApi.kuaishou.openHome();
            await detectAndStore();
          })
        }
        onIdentify={() => void refreshDetection()}
        onEnterUploadPage={() => void continueEditingOrStartNewUpload()}
        onContinueEditing={() => void continueEditingOrStartNewUpload()}
        onUploadVideo={() => void uploadVideo()}
        onWaitForEditPage={() => void waitForEditPage()}
      />
      <KuaishouPageStatePanel detection={detection} />
      <KuaishouFailureContextPanel details={failureContext} />
      <KuaishouDomDiagnosticsPanel
        diagnostic={domDiagnostic}
        evidence={diagnosticEvidence}
        busy={busy}
        onRun={() => void runDomDiagnostic()}
        onCaptureEvidence={() => void captureDiagnosticEvidence()}
      />
      {conflictPanel}
      <KuaishouUploadForm
        form={form}
        pageHasEditableContent={pageHasEditableContent}
        disabled={busy}
        lastSyncAt={lastSyncAt}
        conflictCount={conflicts.length}
        optionsByField={optionsByField}
        onChange={updateFormField}
        onLoadOptions={loadOptions}
        onReadPage={() => void readPageState()}
        onApplyForm={() => void applyFormState()}
        onPickVideo={() => void pickVideoFile()}
        onPickCover={() => void pickCoverFile()}
        onUpload={() => void uploadVideo()}
        onWaitUploadComplete={() => void waitUploadComplete()}
        onPublish={() => void confirmPublish()}
        onCancel={() => void cancelTask()}
      />
      <ElementProfilePanel profile={profile} onChange={setProfile} onSave={saveProfile} onReset={resetProfile} onTest={testElement} />
      <TaskLogPanel task={task} logs={logs} />
      {snapshot ? <div className="text-xs text-slate-500">最近网页读取：{new Date(snapshot.readAt).toLocaleString()}</div> : null}
    </div>
  );
}

function collectConflicts(
  form: KuaishouFormState,
  previousSnapshot: KuaishouPageSnapshot | null,
  nextSnapshot: KuaishouPageSnapshot
): Conflict[] {
  if (!previousSnapshot) return [];

  return WEB_EDITABLE_FIELDS.flatMap((field) => {
    if (!form.dirtyFields.includes(field)) return [];
    const uiValue = fieldValueToText(form[field]);
    const previousPageValue = fieldValueToText(previousSnapshot.fields[field]);
    const nextPageValue = fieldValueToText(nextSnapshot.fields[field]);

    if (nextPageValue !== previousPageValue && nextPageValue !== uiValue) {
      return [{ field, uiValue, pageValue: nextPageValue }];
    }

    return [];
  });
}

function fieldValueToText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function fieldLabel(field: KuaishouWebEditableField): string {
  const labels: Record<KuaishouWebEditableField, string> = {
    caption: "作品描述",
    pkCoverEnabled: "PK 封面",
    chaptersText: "章节配置",
    authorServiceType: "作者服务",
    linkedBenefit: "作者服务收益",
    hotspot: "关联热点",
    authorStatement: "作者声明",
    collectionName: "加入合集",
    locationRegion: "所在地区",
    locationAddress: "详细地址",
    allowSameFrame: "允许同框",
    allowDownload: "允许下载",
    showInNearby: "展示同城页",
    visibility: "查看权限",
    publishTimingMode: "发布时间模式",
    scheduledPublishTime: "定时时间",
    useBestTimeSuggestion: "一键设置活跃时间"
  };

  return labels[field];
}

function formatTaskError(result: KuaishouUploadTaskResult): string {
  const error = result.error;
  if (!error) {
    return `任务状态：${result.status}`;
  }

  return [error.code, error.message].filter(Boolean).join("：");
}
