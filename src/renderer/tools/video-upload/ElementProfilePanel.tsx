import { useState } from "react";
import type { KuaishouElementKey, KuaishouElementProfile, LocatorSpec } from "../../../main/video-upload/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";
import { Input } from "../../shared/components/Input";

const LOCATOR_TYPES: LocatorSpec["type"][] = ["css", "text", "role", "placeholder", "nearText", "contentEditable"];

const ELEMENT_LABELS: Record<KuaishouElementKey, string> = {
  loginRequiredHints: "判断是否需要登录",
  draftContinueButton: "继续编辑草稿按钮",
  uploadEntryButton: "上传入口按钮",
  fileInput: "视频文件选择框",
  captionEditor: "发布文案输入框",
  coverButton: "封面设置按钮",
  coverFileInput: "封面文件选择框",
  pkCoverSwitch: "PK 封面开关",
  chapterButton: "添加章节按钮",
  authorServiceSelect: "作者服务类型选择框",
  benefitSelect: "作者服务收益选择框",
  hotspotInput: "关联热点输入框",
  authorStatementInput: "作者声明输入框",
  collectionSelect: "加入合集选择框",
  locationRegionSelect: "所在地区选择框",
  locationAddressInput: "详细地址输入框",
  allowSameFrameCheckbox: "允许别人跟我拍同框",
  allowDownloadCheckbox: "允许下载此作品",
  showNearbyCheckbox: "作品展示在同城页",
  visibilityPublicRadio: "所有人可见",
  visibilityFriendsRadio: "好友可见",
  visibilityPrivateRadio: "仅自己可见",
  publishTimeToggle: "定时发布开关",
  publishTimeInput: "发布时间输入框",
  publishNowRadio: "立即发布选项",
  scheduledPublishRadio: "定时发布选项",
  bestTimeButton: "粉丝活跃时间一键设置",
  uploadProgressHints: "上传中提示",
  uploadCompleteHints: "上传完成提示",
  publishButton: "发布按钮",
  errorToast: "页面错误提示"
};

export function ElementProfilePanel({
  profile,
  onChange,
  onSave,
  onReset,
  onTest
}: {
  profile: KuaishouElementProfile | null;
  onChange: (profile: KuaishouElementProfile) => void;
  onSave: () => void;
  onReset: () => void;
  onTest: (key: KuaishouElementKey) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingKey, setEditingKey] = useState<KuaishouElementKey | null>(null);

  if (!profile) {
    return <Card title="高级：页面元素配置">加载元素配置中...</Card>;
  }

  const activeProfile = profile;
  const keys = Object.keys(activeProfile.elements) as KuaishouElementKey[];

  function updateLocator(key: KuaishouElementKey, index: number, locator: LocatorSpec) {
    const next = structuredClone(activeProfile);
    next.elements[key][index] = locator;
    next.updatedAt = Date.now();
    onChange(next);
  }

  function addLocator(key: KuaishouElementKey) {
    const next = structuredClone(activeProfile);
    next.elements[key].push({ type: "css", value: "", note: "" });
    next.updatedAt = Date.now();
    onChange(next);
  }

  function removeLocator(key: KuaishouElementKey, index: number) {
    const next = structuredClone(activeProfile);
    next.elements[key].splice(index, 1);
    next.updatedAt = Date.now();
    onChange(next);
  }

  function moveLocator(key: KuaishouElementKey, index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= activeProfile.elements[key].length) return;
    const next = structuredClone(activeProfile);
    const [item] = next.elements[key].splice(index, 1);
    next.elements[key].splice(target, 0, item);
    next.updatedAt = Date.now();
    onChange(next);
  }

  return (
    <Card title="高级：页面元素配置">
      <div className="space-y-3">
        <p className="text-xs leading-5 text-slate-600">这里用于修复快手页面改版导致的按钮或输入框识别失败。正常上传时不需要打开。</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setExpanded((current) => !current)}>{expanded ? "折叠" : "展开"}</Button>
          <Button onClick={onReset}>重置默认</Button>
        </div>

        {expanded ? (
          <div className="max-h-[460px] space-y-3 overflow-auto pr-1">
            {keys.map((key) => {
              const isEditing = editingKey === key;

              return (
                <div key={key} className="rounded-md border border-slate-200 p-3">
                  <div className="space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{key}</h3>
                      <p className="text-xs text-slate-500">{ELEMENT_LABELS[key]}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => onTest(key)}>测试</Button>
                      <Button onClick={() => setEditingKey(isEditing ? null : key)}>{isEditing ? "收起编辑" : "编辑"}</Button>
                      <Button variant="primary" onClick={onSave}>
                        保存
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-2">
                      <Button onClick={() => addLocator(key)}>新增 locator</Button>
                      {activeProfile.elements[key].map((locator, index) => (
                        <LocatorEditor
                          key={`${key}-${index}`}
                          locator={locator}
                          onChange={(next) => updateLocator(key, index, next)}
                          onRemove={() => removeLocator(key, index)}
                          onMoveUp={() => moveLocator(key, index, -1)}
                          onMoveDown={() => moveLocator(key, index, 1)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function LocatorEditor({
  locator,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown
}: {
  locator: LocatorSpec;
  onChange: (locator: LocatorSpec) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const value = "value" in locator ? locator.value : "role" in locator ? locator.role : "text" in locator ? locator.text : locator.nearText || "";
  const note = locator.note || "";

  function updateType(type: LocatorSpec["type"]) {
    if (type === "role") onChange({ type, role: value || "button", name: "", note });
    else if (type === "nearText") onChange({ type, text: value, target: "input", note });
    else if (type === "contentEditable") onChange({ type, nearText: value, note });
    else onChange({ type, value, note } as LocatorSpec);
  }

  function updateValue(nextValue: string) {
    if (locator.type === "role") onChange({ ...locator, role: nextValue });
    else if (locator.type === "nearText") onChange({ ...locator, text: nextValue });
    else if (locator.type === "contentEditable") onChange({ ...locator, nearText: nextValue });
    else onChange({ ...locator, value: nextValue });
  }

  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-2">
      <div className="grid grid-cols-1 gap-2">
        <select value={locator.type} onChange={(event) => updateType(event.target.value as LocatorSpec["type"])} className="h-9 rounded-md border border-slate-200 px-2 text-sm">
          {LOCATOR_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Input value={value} onChange={(event) => updateValue(event.target.value)} placeholder="value / role / text" />
        <Input value={note} onChange={(event) => onChange({ ...locator, note: event.target.value })} placeholder="note" />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button onClick={onMoveUp}>上移</Button>
        <Button onClick={onMoveDown}>下移</Button>
        <Button variant="danger" onClick={onRemove}>
          删除
        </Button>
      </div>
    </div>
  );
}
