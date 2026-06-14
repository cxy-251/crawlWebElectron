import type { KuaishouElementProfile } from "../types";

const now = Date.now();

export const defaultKuaishouElementProfile: KuaishouElementProfile = {
  id: "kuaishou-default-profile",
  platform: "kuaishou",
  name: "快手默认元素配置",
  version: 2,
  uploadUrlCandidates: ["https://cp.kuaishou.com/article/publish/video", "https://cp.kuaishou.com/publish/video"],
  elements: {
    loginRequiredHints: [
      { type: "text", value: "立即登录", exact: false, note: "登录提示" },
      { type: "text", value: "扫码登录", exact: false, note: "扫码登录提示" },
      { type: "text", value: "请先登录", exact: false, note: "登录前提示" }
    ],
    draftContinueButton: [{ type: "role", role: "button", name: "继续编辑", note: "草稿继续编辑按钮" }],
    uploadEntryButton: [
      { type: "text", value: "发布视频", exact: false, note: "创作者首页发布视频入口" },
      { type: "text", value: "上传视频", exact: false, note: "上传入口" }
    ],
    fileInput: [
      { type: "css", value: "input[type='file'][accept*='video']", note: "视频文件 input" },
      { type: "css", value: "input[type='file']:not([accept*='image'])", note: "非图片 file input" },
      { type: "css", value: "input[type='file']", note: "视频文件 input 兜底" }
    ],
    captionEditor: [
      { type: "placeholder", value: "添加作品描述", note: "文案输入框" },
      { type: "contentEditable", nearText: "作品描述", note: "contenteditable 文案编辑区" },
      { type: "nearText", text: "作品描述", target: "textarea", note: "作品描述 textarea" }
    ],
    coverButton: [{ type: "text", value: "设置封面", exact: false, note: "封面按钮" }],
    coverFileInput: [{ type: "css", value: "input[type='file']", note: "封面文件 input，必要时通过上下文缩小" }],
    pkCoverSwitch: [{ type: "role", role: "switch", name: "PK封面", note: "PK 封面开关" }],
    chapterButton: [{ type: "role", role: "button", name: "添加章节", note: "章节按钮" }],
    authorServiceSelect: [{ type: "placeholder", value: "选择服务类型", note: "作者服务类型选择框" }],
    benefitSelect: [{ type: "placeholder", value: "关联成功可获得更多收益", note: "作者服务收益选择框" }],
    hotspotInput: [{ type: "placeholder", value: "输入你想关联的热点", note: "关联热点输入框" }],
    authorStatementInput: [{ type: "placeholder", value: "为作品添加补充说明", note: "作者声明输入框" }],
    collectionSelect: [{ type: "placeholder", value: "选择要加入到的合集", note: "合集选择框" }],
    locationRegionSelect: [{ type: "placeholder", value: "请选择所在地区", note: "地区选择框" }],
    locationAddressInput: [{ type: "placeholder", value: "请输入视频详细地址", note: "详细地址输入框" }],
    allowSameFrameCheckbox: [{ type: "css", value: "input[type='checkbox'][value='allowSameFrame']", note: "允许别人跟我拍同框" }],
    allowDownloadCheckbox: [{ type: "css", value: "input[type='checkbox'][value='downloadType']", note: "允许下载此作品" }],
    showNearbyCheckbox: [{ type: "css", value: "input[type='checkbox'][value='disableNearbyShow']", note: "作品展示在同城页" }],
    visibilityPublicRadio: [{ type: "text", value: "所有人可见", exact: false, note: "公开可见选项" }],
    visibilityFriendsRadio: [{ type: "text", value: "好友可见", exact: false, note: "好友可见选项" }],
    visibilityPrivateRadio: [{ type: "text", value: "仅自己可见", exact: false, note: "仅自己可见选项" }],
    publishTimeToggle: [{ type: "text", value: "定时发布", exact: false, note: "定时发布开关" }],
    publishTimeInput: [{ type: "nearText", text: "发布时间", target: "input", note: "发布时间输入" }],
    publishNowRadio: [{ type: "text", value: "立即发布", exact: false, note: "立即发布选项" }],
    scheduledPublishRadio: [{ type: "text", value: "定时发布", exact: false, note: "定时发布选项" }],
    bestTimeButton: [{ type: "role", role: "button", name: "一键设置", note: "粉丝活跃时间一键设置" }],
    uploadProgressHints: [
      { type: "text", value: "上传中", exact: false, note: "上传中提示" },
      { type: "text", value: "处理中", exact: false, note: "处理中提示" }
    ],
    uploadCompleteHints: [
      { type: "text", value: "视频上传成功", exact: false, note: "上传成功提示" },
      { type: "text", value: "上传完成后可发布", exact: false, note: "上传完成提示" }
    ],
    publishButton: [
      { type: "role", role: "button", name: "发布", note: "发布按钮" },
      { type: "text", value: "发布", exact: true, note: "发布文本按钮" }
    ],
    errorToast: [
      { type: "text", value: "失败", exact: false, note: "失败提示" },
      { type: "text", value: "错误", exact: false, note: "错误提示" }
    ]
  },
  createdAt: now,
  updatedAt: now
};
