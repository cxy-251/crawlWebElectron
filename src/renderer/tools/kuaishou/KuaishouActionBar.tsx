import type { KuaishouPageCapabilities, KuaishouPageDetection } from "../../../shared/kuaishou/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";

export function KuaishouActionBar({
  detection,
  onOpenHome,
  onIdentify,
  onEnterUploadPage,
  onContinueEditing,
  onUploadVideo,
  onWaitForEditPage,
  busy,
  error
}: {
  detection: KuaishouPageDetection | null;
  onOpenHome: () => void;
  onIdentify: () => void;
  onEnterUploadPage: () => void;
  onContinueEditing: () => void;
  onUploadVideo: () => void;
  onWaitForEditPage: () => void;
  busy?: boolean;
  error: string;
}) {
  const pageType = detection?.pageType || "unknown";
  const smartAction = getSmartAction(detection, {
    onIdentify,
    onEnterUploadPage,
    onContinueEditing,
    onUploadVideo,
    onWaitForEditPage
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
  detection: KuaishouPageDetection | null,
  actions: {
    onIdentify: () => void;
    onEnterUploadPage: () => void;
    onContinueEditing: () => void;
    onUploadVideo: () => void;
    onWaitForEditPage: () => void;
  }
) {
  const capabilities: KuaishouPageCapabilities | undefined = detection?.capabilities;
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

  if (capabilities.hasUploadProgress || detection?.pageType === "uploading") {
    return {
      label: "等待进入编辑页",
      disabled: false,
      onClick: actions.onWaitForEditPage,
      hint: "视频仍在上传或处理中，只刷新状态，不写入发布参数。"
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

  if (detection?.pageType === "upload_entry" && capabilities.hasFileInput) {
    return {
      label: "上传视频进入编辑页",
      disabled: false,
      onClick: actions.onUploadVideo,
      hint: "当前已到视频文件选择阶段，点击后会使用工具区的视频路径。"
    };
  }

  if (detection?.pageType === "upload_entry" && capabilities.hasUploadEntryButton) {
    return {
      label: "进入上传视频页",
      disabled: false,
      onClick: actions.onEnterUploadPage,
      hint: "当前在发布作品入口页，点击页面里的上传视频入口，不要求视频路径。"
    };
  }

  return {
    label: "进入发布作品页",
    disabled: false,
    onClick: actions.onEnterUploadPage,
    hint: "先进入快手发布作品页面；到上传视频阶段后才需要视频路径。"
  };
}
