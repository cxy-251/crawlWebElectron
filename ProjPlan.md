<!--
Project: CrawlWebElectron
Document: 当前任务计划书（Current Task Plan）
Version: 0.2
Date: 2026-06-06
Purpose: 本文件只描述“本次要让 Codex 完成的一次工程任务”。一次 ProjPlan.md 更新，就是一次新的任务输入。
Usage:
  • Codex 执行前必须先阅读本文件
  • Codex 本次只执行本文档中的“当前任务”，不要自动推进其他任务
  • 完成后需要更新任务状态、完成说明、当前问题和下一步建议
  • 本文件需要纳入 Git 追踪，但 Codex 不允许执行 git commit、git push 或任何提交发布操作
  • Codex 只能修改工作区文件并汇报变更，最终提交由用户人工审查后完成
-->

# CrawlWebElectron 当前任务计划书

## 0. 本次任务一句话

实现第二阶段视频采集工作台原型：左侧浏览器支持智能地址输入和自动下滑扫描，右侧控制区支持视频候选信息提取、勾选、队列状态和人工暂停恢复；本阶段不执行真实文件下载。

## 1. 当前任务状态

**Status**: DONE

**当前任务**：第二阶段视频采集工作台原型

**执行者**：Codex

**重要限制**：本次只做第二阶段原型，不要实现真实下载器、不要接入 yt-dlp、不要逆向网站未开放接口、不要执行 git commit/git push/发布/部署。

## 2. 已完成基础与当前事实

第一阶段已完成 Electron + React 最小可运行原型：

1. Electron 应用可启动。
2. 左侧使用 Electron `BrowserView` 承载真实网页。
3. 右侧是 React 控制面板。
4. preload / IPC / 主进程之间已有安全通信链路。
5. 已能获取当前页面 URL、标题、链接并显示结果。
6. 已有基础日志与 `.gitignore` 安全边界。

当前登录态保存方式：

1. 左侧网页使用 Electron 持久化 partition：`persist:crawl-web-electron`。
2. 该 partition 会把 cookies、localStorage、IndexedDB、缓存等 Chromium/Electron profile 数据保存在系统应用数据目录。
3. macOS 上典型位置是 `~/Library/Application Support/CrawlWebElectron`。
4. 这些数据不在项目目录内，不进入 Git 仓库，不应导出或写入源码、日志、README、React public 目录。
5. 第三方网站是否长期保持登录，仍取决于网站自身 cookie/session 策略，需要用户用真实账号手动验证。

当前已知问题：

1. 地址栏输入 `google` 会被规范化为 `https://google/`，不能自动跳转到 Google 网站。
2. 右侧控制面板仍是第一阶段基础工具，还没有视频候选列表、自动下滑扫描、队列状态和人工暂停恢复。
3. 当前只能提取普通链接，尚不能围绕视频卡片、`video`、`source`、缩略图、标题、时长等媒体信息建立候选数据。

## 3. 项目定位

这个应用不是普通浏览器，而是一个“左侧网页登录态浏览器 + 右侧自动化工具控制台”的网页采集工作台。

左侧负责真实网页访问、登录、浏览、人工处理验证和保持会话；右侧负责把网页信息提取、自动滚动扫描、视频候选管理、批量下载入口等工具逐步封装成 React 操作界面。

第二阶段的核心不是完成下载，而是把“发现视频 -> 选择视频 -> 进入队列 -> 遇到验证可暂停并人工处理 -> 继续扫描”的工作流做成可验证闭环。

## 4. 本次任务目标

从现有第一阶段原型出发，实现可以人工验证的视频采集工作台第二阶段原型。

本次完成后，项目应该具备：

1. 左侧地址栏支持智能输入，输入 `google`、`youtube` 等短词可以打开常见网站。
2. 左侧仍然只允许安全网页导航，不允许打开本地文件或高风险协议。
3. 左侧可由右侧控制触发自动下滑扫描。
4. 自动下滑扫描可以暂停、停止，并把状态同步到右侧。
5. 右侧可以扫描当前页面视口并提取视频候选。
6. 右侧可以持续接收自动下滑过程中的视频候选。
7. 视频候选可以勾选、取消勾选、清空、去重。
8. 选中的视频可以加入模拟下载队列。
9. 队列只展示状态，不执行真实文件下载。
10. 检测到疑似 robot/captcha/登录验证/人工处理需求时，自动化暂停，用户在左侧手动处理后可从右侧继续。
11. 代码结构为后续真实下载器、yt-dlp、浏览器下载、逆向直链接入预留扩展边界。
12. 日志能帮助定位导航、滚动、提取、去重、队列状态、暂停原因和错误，同时不泄露敏感信息。

## 5. 本次任务必须交付

Codex 必须把任务落到工程代码里，不要只改文档。

交付内容包括：

1. 智能地址输入与导航规范化。
2. 右侧控制区重设计，支持扫描、自动下滑、停止、暂停/继续、清空候选、加入队列。
3. 视频候选数据模型与渲染列表。
4. 当前视口视频候选扫描能力。
5. 自动下滑扫描能力。
6. 候选去重、勾选、状态更新。
7. 模拟下载队列，不落盘、不调用真实下载器。
8. robot/captcha/登录验证等人工处理场景的暂停状态。
9. preload / IPC / 主进程接口扩展，并保持安全边界。
10. README 或工程说明补充第二阶段启动、验证、限制说明。
11. 本文件任务状态、完成说明、当前问题和下一步建议更新。

## 6. 本次不要做

本次任务不要做以下事情：

1. 不要执行真实文件下载。
2. 不要接入 yt-dlp。
3. 不要实现浏览器“另存为”下载。
4. 不要逆向 YouTube 或其他网站未开放接口。
5. 不要绕过 robot/captcha/登录验证。
6. 不要做账号池。
7. 不要做代理池。
8. 不要做数据库。
9. 不要做长期任务队列或后台服务。
10. 不要做复杂插件系统。
11. 不要保存、导出、打印 cookies、token、账号密码、完整请求头。
12. 不要执行 `git commit`、`git push`、发布、部署或任何写入远端仓库/发布环境的操作。

## 7. 智能导航规则

下一次实现时，左侧地址栏应按以下规则处理输入：

1. 已带 `http://` 或 `https://`：按原 URL 打开。
2. 输入包含点号但无协议，例如 `example.com`：自动补 `https://`。
3. 单词输入如 `google`：优先按域名打开。
4. 内置常见站点映射：
   - `google` -> `https://www.google.com`
   - `youtube` -> `https://www.youtube.com`
   - `bilibili` -> `https://www.bilibili.com`
   - `x` -> `https://x.com`
   - `twitter` -> `https://x.com`
5. 其他单词默认打开 `https://www.{word}.com`。
6. 输入包含空格：作为搜索词打开 Google 搜索。
7. 继续禁止 `file:`、`javascript:`、`data:`、`blob:`、`chrome:` 等本地或高风险协议从地址栏直接打开。
8. 导航失败时在右侧日志显示原因，并保留用户输入，方便修正。

## 8. 右侧控制区设计

右侧控制区应从第一阶段的简单按钮扩展为视频采集操作台。

顶部状态区：

1. 当前页面 URL / host。
2. 页面标题。
3. 扫描状态：idle、scanning、paused、stopped、error。
4. 候选数量。
5. 已选数量。
6. 队列数量。

操作区：

1. 扫描当前视口。
2. 自动下滑扫描。
3. 停止扫描。
4. 暂停/继续。
5. 清空候选。
6. 将已选候选加入队列。

候选列表：

1. 支持勾选/取消勾选。
2. 显示标题。
3. 显示来源页面。
4. 显示缩略图 URL 或缩略图占位。
5. 显示视频链接或页面链接。
6. 显示来源站点 provider。
7. 显示提取方式。
8. 显示置信度。
9. 显示状态。

队列区：

1. 队列只做状态模拟，不下载文件。
2. 队列项来源于已选候选。
3. 队列项状态包括：`selected`、`queued`、`paused_for_manual_action`、`ready_for_future_download`、`failed_to_extract`。
4. 后续真实下载器接入前，不生成本地视频文件，不写下载目录。

日志区：

1. 显示滚动开始、滚动轮次、停止原因。
2. 显示候选提取数量、去重数量、队列变化。
3. 显示暂停原因，例如疑似 robot/captcha/登录验证/用户手动暂停。
4. 显示错误摘要。
5. 不记录 cookies、token、账号密码、完整请求头。

## 9. 视频候选数据模型

下一次实现应至少定义以下候选视频数据字段：

1. `id`：本地生成的稳定候选 ID。
2. `sourcePageUrl`：候选来自的页面 URL。
3. `provider`：来源站点，例如 `youtube`、`bilibili`、`generic`。
4. `title`：页面可见标题或推断标题。
5. `pageUrl`：视频详情页或卡片链接。
6. `mediaUrl`：从 `video`、`source` 或其他可见 DOM 中拿到的媒体 URL；没有则为空。
7. `thumbnailUrl`：缩略图 URL；没有则为空。
8. `durationText`：页面可见时长文本；没有则为空。
9. `extractionMethod`：提取方式，例如 `dom-video`、`dom-source`、`video-card-link`、`provider-adapter`。
10. `confidence`：候选置信度，建议为 0 到 1 的数字。
11. `status`：候选状态，例如 `discovered`、`selected`、`queued`、`paused_for_manual_action`、`ready_for_future_download`、`failed_to_extract`。

候选去重原则：

1. 优先按 `mediaUrl` 去重。
2. 没有 `mediaUrl` 时按 `pageUrl` 去重。
3. 两者都没有时按 `sourcePageUrl + title + thumbnailUrl` 去重。
4. 去重不应静默丢弃全部信息，应在日志中记录新增数量和重复数量。

## 10. 媒体提取范围

本阶段只做浏览器辅助发现，不做真实下载。

提取来源：

1. DOM 中的 `video` 元素。
2. DOM 中的 `source` 元素。
3. 常见视频卡片链接。
4. 页面内可见标题。
5. 页面内可见缩略图。
6. 页面内可见时长文本。

自动下滑：

1. 由主进程控制 `BrowserView` 页面脚本执行。
2. 支持配置或内置默认滚动间隔。
3. 支持最大滚动轮数。
4. 支持停止条件：用户停止、页面高度不再变化、达到最大轮数、检测到人工处理需求、页面脚本执行失败。
5. 每轮滚动后执行一次候选提取并合并结果。

站点策略：

1. YouTube 等站点本阶段只做页面可见信息发现，不下载，不绕过限制。
2. 检测到 robot/captcha/登录验证页面或明显人工处理需求时，进入 `paused_for_manual_action`。
3. 用户在左侧浏览器完成操作后，可在右侧点击继续。
4. “逆向未开放地址/直链下载”记录为后续路线，本阶段只预留数据结构和 adapter 边界，不实现逆向。

## 11. IPC 与安全桥接目标

下一次实现应扩展 preload / IPC / 主进程能力，但 React 渲染层仍不直接访问 Node.js、文件系统、cookies、session 文件路径。

建议能力：

1. 智能导航。
2. 获取 session 状态摘要。
3. 扫描当前页面视频候选。
4. 启动自动下滑扫描。
5. 停止自动下滑扫描。
6. 暂停并等待人工处理。
7. 继续扫描。
8. 更新候选选择状态。
9. 清空候选。
10. 建立模拟下载队列。

安全要求：

1. 页面脚本执行只能通过主进程受控方法触发。
2. 不暴露任意 `executeJavaScript` 给 React。
3. 不暴露文件系统路径给 React，除非是明确脱敏的状态摘要。
4. 不打印敏感信息。
5. 不把候选数据写入 Git 追踪文件。

## 12. 本地资源与 GitHub 安全边界

允许进入 Git 的内容：

1. 源码。
2. 文档。
3. 工程配置。
4. 示例配置和不含秘密的默认配置。

必须留在本地或被 `.gitignore` 保护的内容：

1. Electron/Chromium session profile。
2. cookies。
3. token。
4. 账号密码。
5. 登录态导出文件。
6. 真实运行配置。
7. 日志文件。
8. 下载缓存。
9. 下载文件。
10. 临时文件。

本阶段不执行真实下载，因此不应产生真实视频文件。如果为了模拟队列需要保存状态，优先只保存在 React 内存状态；如确需本地持久化，必须先在代码和文档中明确路径，并确保被 `.gitignore` 忽略。

## 13. 日志与调试要求

本次任务需要扩展基础日志，但不需要完整监控系统。

要求：

1. 保持 info、warn、error 级别或等价能力。
2. 记录智能导航输入处理结果。
3. 记录自动下滑开始、轮次、停止原因。
4. 记录候选提取数量、去重数量、队列数量。
5. 记录 robot/captcha/登录验证/人工处理暂停原因。
6. 记录页面脚本执行失败、IPC 调用失败、导航失败。
7. 日志不能记录 cookies、token、账号密码、完整请求头。

## 14. 验收标准

任务完成后，应满足：

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. 应用可以正常启动。
4. 左侧输入 `google` 能打开 `https://www.google.com` 或明确映射后的 Google 地址。
5. 左侧输入 `youtube` 能打开 `https://www.youtube.com`。
6. 左侧输入 `example.com` 能补全为 `https://example.com`。
7. 左侧输入包含空格的查询词能打开 Google 搜索。
8. 高风险协议输入被拒绝并显示错误。
9. 右侧可以扫描当前视口并显示视频候选。
10. 右侧可以启动自动下滑扫描并持续合并候选。
11. 右侧可以停止扫描。
12. 右侧可以勾选候选并加入模拟队列。
13. 队列中不产生真实下载文件。
14. 检测到疑似 robot/captcha/登录验证时，自动化暂停并提示用户在左侧手动处理。
15. 用户手动处理后可以继续扫描。
16. 日志可用于定位导航、滚动、提取、去重、队列和暂停问题。
17. README 或工程说明已更新第二阶段使用方式和限制。
18. `ProjPlan.md` 已更新任务状态、完成说明、当前问题和下一步建议。
19. Codex 未执行 commit、push、发布或部署。

## 15. 完成说明

已完成第二阶段视频采集工作台原型。

1. 修改/新增文件：
   - `ProjPlan.md`
   - `README.md`
   - `src/shared/ipcChannels.ts`
   - `src/shared/types.ts`
   - `src/main/navigation.ts`
   - `src/main/mediaScanner.ts`
   - `src/main/webViewController.ts`
   - `src/main/ipc.ts`
   - `src/preload/index.ts`
   - `src/renderer/vite-env.d.ts`
   - `src/renderer/App.tsx`
   - `src/renderer/styles.css`
2. 主要模块职责：
   - `src/main/navigation.ts`：实现智能地址输入，支持短词站点映射、域名补全、Google 搜索和高风险协议拒绝。
   - `src/main/mediaScanner.ts`：受控执行页面脚本，提取 `video`、`source`、常见视频卡片链接、标题、缩略图和时长文本，并检测疑似人工处理需求。
   - `src/main/webViewController.ts`：控制 `BrowserView`、session 摘要、当前页扫描、自动下滑扫描、暂停/停止/继续状态。
   - `src/main/ipc.ts` 与 `src/preload/index.ts`：扩展安全 IPC，不向 React 暴露任意脚本执行能力。
   - `src/renderer/App.tsx`：右侧视频采集控制台、状态统计、候选列表、勾选、模拟队列和日志。
   - `src/shared/*`：新增候选视频、扫描状态、队列项、session 摘要等共享类型。
3. 启动方式：
   - 首次安装：`npm install`
   - 开发启动：`npm run dev`
   - 构建后启动：`npm run start`
4. 智能导航验证：
   - 输入 `google` 应打开 `https://www.google.com`。
   - 输入 `youtube` 应打开 `https://www.youtube.com`。
   - 输入 `example.com` 应补全为 `https://example.com`。
   - 输入包含空格的查询词应打开 Google 搜索。
   - 输入 `file:`、`javascript:`、`data:` 等高风险协议应被拒绝，并在日志中显示错误。
5. 视频候选扫描验证：
   - 打开包含 `video`、`source` 或常见视频卡片链接的页面。
   - 点击右侧 `Scan`，候选列表应显示标题、来源、链接、提取方式、置信度和状态。
6. 自动下滑扫描验证：
   - 点击右侧 `Auto`，左侧页面自动下滑。
   - 每轮扫描会合并候选并记录日志。
   - 点击 `Stop` 可以停止扫描。
7. 勾选和模拟队列验证：
   - 勾选候选后点击 `Queue`。
   - 候选进入右侧队列，状态变为 `queued`。
   - 本阶段不会生成真实下载文件，不调用下载器，不写下载目录。
8. robot/captcha/登录验证暂停与继续验证：
   - 当页面文本疑似包含 robot、captcha、human verification、sign-in verification 等人工处理需求时，扫描状态进入 paused。
   - 用户在左侧浏览器完成操作后，可点击 `Resume` 继续扫描。
   - 本阶段不绕过验证。
9. 日志位置：
   - 主进程日志输出在启动命令所在终端。
   - 右侧 `Logs` 区显示渲染进程操作日志、扫描轮次、候选数量、去重数量、队列变化和暂停原因。
10. `.gitignore` 保护内容：
   - `node_modules/`
   - `dist/`、`build/`、`out/`、`release/`
   - `.env*` 真实配置
   - `.local/`、`runtime/`、`user-data/`、`downloads/`、`cache/`、`tmp/`、`temp/`
   - `*.log`、`logs/`
   - 编辑器和系统噪音文件
11. 已验证：
   - `npm run typecheck` 通过。
   - `npm run build` 通过。
   - `npm run start` 烟测通过：窗口创建、BrowserView 创建、默认页加载、IPC handler 注册成功。
12. 当前问题：
   - 视频候选提取是通用 DOM 启发式，不保证覆盖每个网站的动态媒体资源。
   - YouTube 等站点只做页面可见信息发现，不做下载、不绕过验证。
   - 队列是 React 内存状态，关闭应用后不会保留。
   - 第三方网站登录态仍取决于网站自身 session 策略。
13. 下一步建议：
   - 下一次任务可以选择一条真实下载路线：yt-dlp、浏览器下载、或特定站点 adapter/直链研究。
   - 建议先用真实目标页面人工验收候选提取质量，再决定是否做站点专项 adapter。

## 16. 给 Codex 的执行提示

请阅读本文件，并只执行本文档描述的当前任务：第二阶段视频采集工作台原型。

本次重点是把“智能导航、视频发现、候选选择、模拟队列、人工暂停恢复”做成可验证闭环。不要真实下载，不要接入下载器，不要逆向未开放接口，不要绕过验证。

禁止执行 `git commit`、`git push`、发布、部署或任何写入远端仓库/发布环境的操作。完成后只需要汇报修改了哪些文件、如何验证、当前问题和建议提交信息；最终是否提交由用户人工审查后决定。
