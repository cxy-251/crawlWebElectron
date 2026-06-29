import type {
  KuaishouFormField,
  KuaishouFormState,
  KuaishouOptionField,
  KuaishouOptionsResult,
  KuaishouPublishMode,
  KuaishouPublishTimingMode,
  KuaishouVisibility
} from "../../../shared/kuaishou/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";
import { Input } from "../../shared/components/Input";
import { Textarea } from "../../shared/components/Textarea";

export function KuaishouUploadForm({
  form,
  pageHasEditableContent,
  onChange,
  onReadPage,
  onApplyForm,
  onUpload,
  onPickVideo,
  onPickCover,
  onWaitUploadComplete,
  onPublish,
  onCancel,
  disabled,
  lastSyncAt,
  conflictCount,
  optionsByField,
  onLoadOptions
}: {
  form: KuaishouFormState;
  pageHasEditableContent: boolean;
  onChange: (field: KuaishouFormField, value: string | boolean | undefined) => void;
  onLoadOptions: (field: KuaishouOptionField, query?: string) => Promise<KuaishouOptionsResult>;
  onReadPage: () => void;
  onApplyForm: () => void;
  onPickVideo: () => void;
  onPickCover: () => void;
  onUpload: () => void;
  onWaitUploadComplete: () => void;
  onPublish: () => void;
  onCancel: () => void;
  disabled?: boolean;
  lastSyncAt: number | null;
  conflictCount: number;
  optionsByField: Partial<Record<KuaishouOptionField, KuaishouOptionsResult>>;
}) {
  const uploadActionLabel = pageHasEditableContent
    ? "继续当前视频并写入参数"
    : form.videoPath
      ? "上传所选视频进入编辑页"
      : "上传新视频";
  const uploadActionHint = pageHasEditableContent
    ? "当前页面已有可编辑内容；未选择新视频时只写入网页参数。"
    : "先填写或选择视频路径；主上传按钮不会弹出文件选择窗口。";

  return (
    <Card title="单个快手视频任务">
      <div className="space-y-5">
        <section className="space-y-3">
          <SectionTitle title="本地文件" hint="本地路径不会从网页反向读取。" />
          <LocalFileField
            label="视频文件"
            value={form.videoPath}
            placeholder={pageHasEditableContent ? "网页已选择文件（路径不可读）" : "选择本地视频文件"}
            onChange={(value) => onChange("videoPath", value)}
            onPick={onPickVideo}
            pickLabel="选择视频"
          />
          <LocalFileField
            label="封面文件"
            value={form.coverPath || ""}
            placeholder={pageHasEditableContent ? "网页已选择封面时路径不可读" : "可选；复杂封面弹窗会暂停人工确认"}
            onChange={(value) => onChange("coverPath", value)}
            onPick={onPickCover}
            pickLabel="选择封面"
          />
        </section>

        <section className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <SectionTitle title="发布前必改参数" hint={`作品描述、加入合集、同城页展示、定时发布时间。冲突：${conflictCount}`} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">作品描述</span>
            <Textarea value={form.caption} onChange={(event) => onChange("caption", event.target.value)} />
          </label>
          <OptionTextField
            field="collectionName"
            label="加入合集"
            value={form.collectionName || ""}
            placeholder="先获取候选，再选择页面真实合集"
            options={optionsByField.collectionName}
            onChange={(value) => onChange("collectionName", value)}
            onLoadOptions={onLoadOptions}
          />
          <BooleanRow label="作品展示在同城页" checked={form.showInNearby} onChange={(checked) => onChange("showInNearby", checked)} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">发布时间</span>
            <select
              value={form.publishTimingMode}
              onChange={(event) => onChange("publishTimingMode", event.target.value as KuaishouPublishTimingMode)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="immediate">立即发布</option>
              <option value="scheduled">定时发布</option>
            </select>
          </label>
          {form.publishTimingMode === "scheduled" ? (
            <TextField label="定时时间" value={form.scheduledPublishTime || ""} onChange={(value) => onChange("scheduledPublishTime", value)} placeholder="例如 2026-06-14 20:30" />
          ) : null}
        </section>

        <details className="rounded-md border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">可选页面参数</summary>
          <div className="mt-4 space-y-5">
            <section className="space-y-3">
              <SectionTitle title="封面与章节" hint="留空或未修改时不会写入网页。" />
              <BooleanRow label="PK 封面" checked={Boolean(form.pkCoverEnabled)} onChange={(checked) => onChange("pkCoverEnabled", checked)} />
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-500">章节配置</span>
                <Textarea
                  value={form.chaptersText || ""}
                  onChange={(event) => onChange("chaptersText", event.target.value)}
                  placeholder="可记录章节计划；写入时需要左侧弹窗人工确认"
                  className="min-h-16"
                />
              </label>
            </section>

            <section className="space-y-3">
              <SectionTitle title="作者信息" hint="下拉候选由快手页面决定，找不到候选时会提示人工处理。" />
              <OptionTextField
                field="authorServiceType"
                label="作者服务"
                value={form.authorServiceType || ""}
                placeholder="选择服务类型"
                options={optionsByField.authorServiceType}
                onChange={(value) => onChange("authorServiceType", value)}
                onLoadOptions={onLoadOptions}
              />
              <OptionTextField
                field="linkedBenefit"
                label="作者服务收益"
                value={form.linkedBenefit || ""}
                placeholder="关联成功可获得更多收益"
                options={optionsByField.linkedBenefit}
                onChange={(value) => onChange("linkedBenefit", value)}
                onLoadOptions={onLoadOptions}
              />
              <OptionTextField
                field="hotspot"
                label="关联热点"
                value={form.hotspot || ""}
                placeholder="输入你想关联的热点"
                options={optionsByField.hotspot}
                onChange={(value) => onChange("hotspot", value)}
                onLoadOptions={onLoadOptions}
              />
              <OptionTextField
                field="authorStatement"
                label="作者声明"
                value={form.authorStatement || ""}
                placeholder="为作品添加补充说明"
                options={optionsByField.authorStatement}
                onChange={(value) => onChange("authorStatement", value)}
                onLoadOptions={onLoadOptions}
              />
            </section>

            <section className="space-y-3">
              <SectionTitle title="地点" hint="详细地址通常需要先选地区。" />
              <OptionTextField
                field="locationRegion"
                label="所在地区"
                value={form.locationRegion || ""}
                placeholder="请选择所在地区"
                options={optionsByField.locationRegion}
                onChange={(value) => onChange("locationRegion", value)}
                onLoadOptions={onLoadOptions}
              />
              <OptionTextField
                field="locationAddress"
                label="详细地址"
                value={form.locationAddress || ""}
                placeholder="请输入视频详细地址"
                options={optionsByField.locationAddress}
                onChange={(value) => onChange("locationAddress", value)}
                onLoadOptions={onLoadOptions}
              />
            </section>

            <section className="space-y-3">
              <SectionTitle title="其它发布设置" hint="默认保持平台页面现状。" />
              <BooleanRow label="允许别人跟我拍同框" checked={form.allowSameFrame} onChange={(checked) => onChange("allowSameFrame", checked)} />
              <BooleanRow label="允许下载此作品" checked={form.allowDownload} onChange={(checked) => onChange("allowDownload", checked)} />
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-500">查看权限</span>
                <select
                  value={form.visibility}
                  onChange={(event) => onChange("visibility", event.target.value as KuaishouVisibility)}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="public">所有人可见</option>
                  <option value="friends">好友可见</option>
                  <option value="private">仅自己可见</option>
                </select>
              </label>
              <BooleanRow label="使用粉丝活跃时间一键设置" checked={Boolean(form.useBestTimeSuggestion)} onChange={(checked) => onChange("useBestTimeSuggestion", checked)} />
            </section>
          </div>
        </details>

        <section className="space-y-3">
          <SectionTitle title="网页读写" hint={`最近读取：${lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "-"}`} />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={onReadPage} disabled={disabled}>
              读取网页参数
            </Button>
            <Button variant="primary" onClick={onApplyForm} disabled={disabled}>
              写入网页参数
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle title="上传与发布" hint={uploadActionHint} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">发布模式</span>
            <select
              value={form.publishMode}
              onChange={(event) => onChange("publishMode", event.target.value as KuaishouPublishMode)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="manual_confirm">上传完成后停在发布前确认</option>
              <option value="auto_publish">自动发布（保留，不默认使用）</option>
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2">
            <Button variant="primary" disabled={disabled} onClick={onUpload}>
              {uploadActionLabel}
            </Button>
            <Button disabled={disabled} onClick={onWaitUploadComplete}>
              等待上传完成
            </Button>
            <Button disabled={disabled} onClick={onPublish}>
              发布
            </Button>
            <Button variant="danger" disabled={disabled} onClick={onCancel}>
              取消当前任务
            </Button>
          </div>
        </section>
      </div>
    </Card>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {hint ? <p className="text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function OptionTextField({
  field,
  label,
  value,
  placeholder,
  options,
  onChange,
  onLoadOptions
}: {
  field: KuaishouOptionField;
  label: string;
  value: string;
  placeholder?: string;
  options?: KuaishouOptionsResult;
  onChange: (value: string) => void;
  onLoadOptions: (field: KuaishouOptionField, query?: string) => Promise<KuaishouOptionsResult>;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <Button onClick={() => void onLoadOptions(field, value)}>候选</Button>
      </div>
      {options ? (
        <div className="space-y-1">
          <div className="text-xs text-slate-500">
            {options.options.length > 0 ? `候选 ${options.options.length} 个` : "未读取到候选"}
          </div>
          {options.options.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {options.options.slice(0, 12).map((option) => (
                <button
                  key={`${field}-${option.label}-${option.value}-${option.rawText}`}
                  type="button"
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-white"
                  onClick={() => onChange(option.label)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </label>
  );
}

function BooleanRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
    </label>
  );
}

function LocalFileField({
  label,
  value,
  placeholder,
  onChange,
  onPick,
  pickLabel
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onPick: () => void;
  pickLabel: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <Button onClick={onPick}>{pickLabel}</Button>
      </div>
      {!value ? <div className="text-xs text-slate-500">{placeholder}</div> : null}
    </label>
  );
}
