# PROJPLAN.md — 当前唯一任务：快手上传 API 上库前整理

## 1. 当前优先级

项目主体只保留 Electron 快手上传工作台和本地 HTTP API 能力：

```txt
打开快手上传页 -> 真实 DOM 识别页面能力 -> 上传新视频 -> 进入编辑页 -> 写入参数 -> 可选自动发布
```

个人批量配置、歌曲目录、任务 JSON、API token 和调用 API 的本地脚本放在 `local-api-usage/`，该目录被 git 忽略，不提交。

## 2. 核心 API 能力

本地 API 默认监听：

```txt
127.0.0.1:3218
```

可通过 `CWE_API_PORT` 覆盖端口。设置 `CWE_API_TOKEN` 后要求：

```txt
Authorization: Bearer <token>
```

接口：

```txt
GET  /api/health
POST /api/kuaishou/open-upload-page
GET  /api/kuaishou/detection
GET  /api/kuaishou/page-state
POST /api/kuaishou/options
POST /api/kuaishou/apply-settings
POST /api/kuaishou/upload-single
GET  /api/kuaishou/tasks/:taskId
```

`upload-single` 支持：

```ts
{
  videoPath: string;
  settings: {
    caption: string;
    collectionName: string;
    showInNearby: boolean;
    publishTimingMode: "scheduled";
    scheduledPublishTime: "YYYY-MM-DD HH:mm";
  };
  confirmPublish?: boolean;
  uploadIntent?: "new_video" | "continue_current";
  draftPolicy?: "pause" | "continue";
}
```

## 3. 上传新视频路径

默认 `uploadIntent = "new_video"`：

1. 打开上传入口。
2. 如果检测到未发布草稿或已有可编辑内容，且 `draftPolicy = "pause"`，返回 `DRAFT_CONFLICT` 并进入 `waiting_manual_action`。
3. 找到视频 `fileInput`。
4. 设置本地视频文件。
5. 等待快手进入编辑页。
6. 写入 dirty 或 API 显式传入的页面参数。
7. 回读校验。
8. `confirmPublish = true` 时点击最终发布；否则停在发布前确认。

手动“继续编辑当前视频”保留为 `continue_current` 语义，不用于批量新视频默认路径。

## 4. 页面参数规则

发布前常用字段：

```txt
caption
collectionName
showInNearby
publishTimingMode
scheduledPublishTime
```

其它已识别页面能力继续保留，但未 dirty 不写入网页。

`scheduledPublishTime` 必须使用 `YYYY-MM-DD HH:mm`，写入时真实操作快手日期时间控件，并在写入后回读校验；不一致返回 `TIME_WRITE_MISMATCH`。

`collectionName` 必须从页面真实候选中选择；找不到返回 `OPTION_NOT_FOUND`，多候选返回 `OPTION_AMBIGUOUS`。

## 5. 上库边界

提交内容可以包括：

```txt
Electron 应用代码
本地 HTTP API
通用类型和文档
.gitignore
```

不提交：

```txt
local-api-usage/
任务 JSON / state 文件
个人绝对路径
API token
cookies/session/profile 数据
dist/
node_modules/
.DS_Store
```

## 6. 验收标准

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `npm run dev` 能启动 Electron。
4. `GET /api/health` 正常。
5. `upload-single` 新视频路径先传视频，再进入编辑页写参数。
6. `confirmPublish = true` 时自动发布。
7. 草稿冲突返回 `DRAFT_CONFLICT`，不覆盖旧草稿。
8. `git status --short` 不显示 `local-api-usage/`、`dist/`、`node_modules/`、`.DS_Store`。
9. 待提交内容不包含个人绝对路径、token、cookies。
