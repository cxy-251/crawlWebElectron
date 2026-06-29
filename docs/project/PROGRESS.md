# PROGRESS.md

## 浏览器工作流平台融合记录

### 本轮实际修改文件

- `PROJPLAN.md`
- `README.md`
- `.gitignore`
- `docs/plans/INDEX.md`
- `docs/plans/0010-browser-workflow-platform.md`
- `src/`
- `src/safari-rpa/`
- `src/safari-extension-boss/`
- `package.json`
- `src/main/api/BrowserWorkflowLocalApiServer.ts`
- `src/main/api/LocalApiTypes.ts`
- `src/main/api/WorkflowLocalApiRoutes.ts`
- `src/main/domains/kuaishou/api/KuaishouLocalApiRoutes.ts`
- `src/shared/workflows/types.ts`
- `src/main/workflows/WorkflowRegistry.ts`
- `src/main/workflows/SafariRpaBridge.ts`
- `src/main/workflows/WorkflowRuntimeService.ts`
- `src/main/ipc/workflowIpcHandlers.ts`
- `src/renderer/tools/workflows/WorkflowCatalogPage.tsx`
- `src/renderer/tools/kuaishou/KuaishouDomDiagnosticsPanel.tsx`
- `src/renderer/tools/kuaishou/KuaishouFailureContextPanel.tsx`
- 主进程、preload、本地 API、首页路由相关文件

### 实际修复

- 将 Safari/Python RPA 源码、配置、文档、测试按角色移动到 `src/safari-rpa/`，排除 `.git`、`var`、缓存、日志、数据库和 `.DS_Store`。
- 将 Boss Safari Extension 原型按角色移动到 `src/safari-extension-boss/`。
- 新增统一 workflow registry，暴露 Kuaishou、Boss、Twitter 和 Safari Extension prototype descriptors。
- 本地 API 新增 `GET /api/workflows` 和 `GET /api/workflows/:workflowId`。
- 本地 API / IPC / preload 新增 Safari RPA 只读 bridge：服务检查、运行时快照、run detail。
- Safari RPA 运行时快照会读取远端 workflows，并按当前 workflow 过滤 recent runs、reports 和 schedules。
- Workflow 页面支持点击 Safari RPA recent run 查看只读状态和 artifacts。
- Workflow 页面支持只读查看 Safari RPA reports 和 schedules，不暴露 create/resume/cancel/schedule 写操作。
- 本地 HTTP API 入口重命名为 `BrowserWorkflowLocalApiServer`，避免平台 API 继续挂在 Kuaishou 命名下。
- 本地 HTTP API 入口拆成 shell + route modules：workflow 路由和 Kuaishou 路由分离。
- 新增 `WorkflowRuntimeService` 用例层，HTTP / IPC 入口不再直接依赖 Safari RPA adapter。
- 新增快手 DOM 诊断：`/api/kuaishou/diagnostics/dom`、IPC/preload `diagnoseDom()`、UI 全量 selector 巡检面板。
- 新增快手诊断证据捕获：`/api/kuaishou/diagnostics/evidence`、IPC/preload `captureDiagnosticEvidence()`、UI 展示截图和 DOM snapshot 路径。
- 新增快手失败上下文面板，展示结构化 page-action 错误、候选项、页面能力和 locator attempts。
- preload 新增 `window.appApi.workflows.listWorkflows()`、`checkService()`、`getRuntimeSnapshot()`、`getRunDetail()`。
- 移除 Boss Zhipin Electron-local 自动化服务、IPC、HTTP `/api/boss/*`、preload API 和 renderer 页面。
- Electron session profile 收窄为快手；Boss/Twitter 后续执行走 Safari RPA。
- 构建脚本新增 `clean` / `clean:electron`，避免被删除的旧 Boss Electron 编译产物继续残留在 `dist`。

### 尚未执行的高风险验证

- 未启动 Safari RPA 服务。
- 未读取真实 Safari RPA reports。
- 未读取真实 Safari RPA schedules。
- 未执行 Boss 通信、Twitter 采集、Kuaishou 发布。

## 快手上传 API 上库前整理记录

### 本轮实际修改文件

- `.gitignore`
- `PROJPLAN.md`
- `CURRENT_ISSUES.md`
- `PROGRESS.md`
- `src/main/api/BrowserWorkflowLocalApiServer.ts`
- `src/main/storage/repositories/UploadTaskRepository.ts`
- `src/shared/kuaishou/types.ts`
- `src/main/domains/kuaishou/service/KuaishouUploadService.ts`

另外创建了 ignored 的本机目录：

```txt
local-api-usage/
```

该目录保存本地 API 使用脚本、真实常量、任务 JSON 和 state 文件，不提交。

### 实际修复

- `.gitignore` 忽略 `local-api-usage/`、任务 JSON、state 文件和 JSONL。
- `upload-single` 支持：
  - `uploadIntent = "new_video" | "continue_current"`
  - `draftPolicy = "pause" | "continue"`
- 默认新视频路径为 `new_video + pause`。
- 新视频路径检测到未发布草稿或已有可编辑内容时返回 `DRAFT_CONFLICT`，任务状态为 `waiting_manual_action`。
- 新视频路径会先找到文件上传入口并设置视频文件，再等待编辑页写入参数。
- `confirmPublish = true` 时，在进入发布前确认后自动点击最终发布。
- 待提交文档不包含个人绝对路径、真实本地歌曲目录、API token 或 cookies。

### 本地脚本目录

`local-api-usage/kuaishou/` 中包含：

```txt
constants.mjs
generate-kuaishou-tasks.mjs
batch-publish-kuaishou.mjs
```

脚本使用一个 JSON 数组文件作为批量任务文件，不使用 JSONL。

### 实际验证

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run dev` 能启动 Electron。
- `GET /api/health` 返回成功。
- 本地 ignored 脚本生成了一个 JSON 数组任务文件，当前本机视频数量为 15 条。
- `local-api-usage/`、生成任务 JSON 和 state 文件已确认被 git 忽略。
- 隐私扫描未发现个人绝对路径、真实本地歌曲目录或真实合集名进入待提交文件。

### 尚未执行的高风险验证

- 未在验证阶段真的点击最终发布公开视频。
- 未用真实视频跑完整 `confirmPublish=true` 发布链路。
