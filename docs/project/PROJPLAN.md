# PROJPLAN.md — 当前任务：统一浏览器工作流平台

## 1. 当前边界

`Browser Workflow Forge` 是统一 GitHub-backed 项目。

同仓库内保留三类网页操纵能力：

- 普通网页工作流：Electron `WebContents`、DOM 执行、CDP。
- 高风险网页工作流：Safari RPA + 真实 Safari profile。
- 未来 Safari 低延迟 DOM 通道：Safari Web Extension 原型。

## 2. 集成目录

```txt
src/main/domains/kuaishou/
src/safari-rpa/
src/safari-extension-boss/
local-api-usage/safari-rpa/configs/boss/
local-api-usage/safari-rpa/configs/twitter/
```

`src/main/domains/kuaishou/` 负责 Electron 快手工作流。`src/safari-rpa` 负责 Boss Zhipin 和 Twitter/X 的真实 Safari 工作流源码。`src/safari-extension-boss` 只作为未来 Safari extension bridge 的参考实现。Safari RPA 可编辑配置统一放在 `local-api-usage/safari-rpa/configs/` 并按站点分组。

## 3. Workflow Registry

Electron 主应用暴露统一 workflow registry：

```txt
GET /api/workflows
GET /api/workflows/:workflowId
GET /api/workflows/:workflowId/service-check
GET /api/workflows/:workflowId/runtime-snapshot
GET /api/workflows/:workflowId/runs/:runId
IPC workflows:list
```

首批工作流：

```txt
kuaishou.upload-single.v1          electron           available
boss.search-and-communicate.v1     safari-rpa         external
twitter.collect-raw.v1             safari-rpa         external
twitter.clean-prompts.v1           safari-rpa         external
boss.safari-extension.prototype.v1 safari-extension   prototype
```

`external` 表示源码已经在本仓库内，但执行仍需要 Safari RPA Python/Safari 服务。

主进程边界：

```txt
BrowserWorkflowLocalApiServer  本地 HTTP API 入口
WorkflowLocalApiRoutes         /api/health 和 /api/workflows* 路由
KuaishouLocalApiRoutes         src/main/domains/kuaishou/api 路由
workflowIpcHandlers            Renderer IPC 入口
WorkflowRegistry               静态 workflow 描述符
WorkflowRuntimeService         workflow 运行时用例层
SafariRpaBridge                Safari RPA loopback API adapter
```

HTTP shell 不直接承载具体业务路由；新增本地 API 领域时，优先新增 route module。HTTP / IPC 入口不直接调用 Safari RPA adapter；新增 runtime 或新增 workflow 运行态能力时，优先扩展 `WorkflowRuntimeService`，再由入口层复用。

Safari RPA workflow 目前在 Electron 侧只接入只读 runtime bridge：

- 服务健康检查。
- 远端 workflow 能力列表。
- 当前 workflow 的最近 runs。
- 当前 workflow 的 reports。
- 当前 workflow 的 schedules。
- 单个 run 的状态和 artifacts。

暂不在 Electron UI 暴露 Safari RPA 的 create/resume/cancel/schedule 等写操作。

## 4. 保留的快手 API

本地 API 默认监听：

```txt
127.0.0.1:3218
```

保留：

```txt
GET  /api/health
POST /api/kuaishou/open-upload-page
GET  /api/kuaishou/detection
GET  /api/kuaishou/diagnostics/dom
POST /api/kuaishou/diagnostics/evidence
GET  /api/kuaishou/page-state
POST /api/kuaishou/options
POST /api/kuaishou/apply-settings
POST /api/kuaishou/upload-single
GET  /api/kuaishou/tasks/:taskId
```

DOM 诊断优先走真实页面只读巡检：`/api/kuaishou/diagnostics/dom` 和 Electron 面板会识别当前 pageType、页面能力、全部 selector 命中结果和 locator attempts，用于处理网页 DOM 漂移。`/api/kuaishou/diagnostics/evidence` 只保存本机截图和 DOM snapshot，不点击或写入网页。

## 5. 已移除边界

Boss Zhipin 不再通过 Electron DOM 脚本执行：

```txt
src/main/browser-automation/
src/main/ipc/browserAutomationIpcHandlers.ts
src/renderer/tools/browser-automation/
/api/boss/*
window.appApi.browserAutomation.*
```

Boss/Twitter 的后续执行入口应通过 Safari RPA bridge 调用同仓库 `src/safari-rpa`。

## 6. 不提交

```txt
local-api-usage/
local-api-usage/safari-rpa/var/
dist/
node_modules/
.DS_Store
任务 JSON / state 文件 / JSONL 输出
SQLite / logs / screenshots / downloads
API token / cookies / session/profile 数据
个人绝对路径
```

## 7. 验收标准

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `GET /api/health` 正常。
4. `GET /api/workflows` 返回首批 workflow descriptors。
5. 快手上传 UI 和本地 API 保持可用。
6. 待提交内容不包含运行状态、token、cookies 或个人绝对路径。
