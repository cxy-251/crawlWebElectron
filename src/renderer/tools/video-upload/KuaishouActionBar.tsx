import type { KuaishouPageCapabilities, KuaishouPageDetection } from "../../../main/video-upload/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";

export function KuaishouActionBar({
  detection,
  onOpenHome,
  onIdentify,
  onContinueEditing,
  onUploadNew,
  busy,
  error
}: {
  detection: KuaishouPageDetection | null;
  onOpenHome: () => void;
  onIdentify: () => void;
  onContinueEditing: () => void;
  onUploadNew: () => void;
  busy?: boolean;
  error: string;
}) {
  const pageType = detection?.pageType || "unknown";
  const smartAction = getSmartAction(detection?.capabilities, {
    onIdentify,
    onContinueEditing,
    onUploadNew
  });

  return (
    <Card title="页面导航">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          <Button onClick={onOpenHome} disabled={busy}>
            打开快手创作者首页
          </Button>
          <Button onClick={onIdentify} disabled={busy}>
            识别当前页面
          </Button>
          <Button variant="primary" onClick={smartAction.onClick} disabled={busy || smartAction.disabled}>
            {smartAction.label}
          </Button>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <div>当前状态：{pageType}</div>
          <div>{smartAction.hint}</div>
          {error ? <div className="text-rose-700">错误：{error}</div> : null}
        </div>
      </div>
    </Card>
  );
}

function getSmartAction(
  capabilities: KuaishouPageCapabilities | undefined,
  actions: {
    onIdentify: () => void;
    onContinueEditing: () => void;
    onUploadNew: () => void;
  }
) {
  if (!capabilities) {
    return {
      label: "识别当前页面",
      disabled: false,
      onClick: actions.onIdentify,
      hint: "还没有页面能力信息，请先识别当前页面。"
    };
  }

  if (capabilities.loginRequired) {
    return {
      label: "先登录",
      disabled: true,
      onClick: actions.onIdentify,
      hint: "当前需要登录，请先在左侧浏览器完成登录。"
    };
  }

  if (capabilities.hasEditableContent) {
    return {
      label: "继续编辑当前视频",
      disabled: false,
      onClick: actions.onContinueEditing,
      hint: "当前已在上传编辑流程中，只读取页面字段，不重新选择视频。"
    };
  }

  if (capabilities.hasDraftContinueButton) {
    return {
      label: "继续编辑当前视频",
      disabled: false,
      onClick: actions.onContinueEditing,
      hint: "检测到未发布草稿，点击后会直接继续编辑，不放弃草稿。"
    };
  }

  return {
    label: "上传新视频",
    disabled: false,
    onClick: actions.onUploadNew,
    hint: "当前没有检测到可编辑内容，点击后会先检测页面，再选择本地视频并进入上传流程。"
  };
}
