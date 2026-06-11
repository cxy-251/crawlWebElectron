<!--
Project: CrawlWebElectron
Document: 当前任务计划书（Current Task Plan）
Version: 0.3
Date: 2026-06-07
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

实现第三阶段：整合 `social-auto-upload` 的自动化发布逻辑，彻底脱离 Playwright，使用 Electron CDP 接口（debugger）和 `executeJavaScript` 封装“抖音自动化视频上传”功能到右侧小工具面板，并建立终端级日志实时监控系统。

## 1. 当前任务状态

**Status**: DOING

**当前任务**：第三阶段 - 社交媒体视频自动化发布小工具

**执行者**：Codex / Antigravity

**重要限制**：本次仅实现视频发布功能，绝对不允许使用 Playwright、Puppeteer、Selenium 等任何无头浏览器库。只能修改工作区文件。禁止执行代码提交或发布。

## 2. 已完成基础与当前事实

第一阶段与第二阶段已完成 Electron + React 最小可运行原型，具备左侧 `BrowserView` 智能导航与登录态保持（保存在系统应用数据目录），以及右侧 React 控制台的基础结构。

当前移植目标：`social-auto-upload` 仓库（Python+Playwright）的核心逻辑，主要流程为：导航至创作者中心 -> 扫码等待 -> 触发本地文件上传 -> 填表 -> 点击发布。

## 3. 项目定位

这个应用不仅是“左侧网页登录态浏览器 + 右侧自动化采集工作台”，也是“一站式媒体效率分发中心”。利用 Electron 真实浏览器环境+持久化 Session 解决传统爬虫验证码痛点，结合右侧工具形成全栈闭环。

## 4. 本次任务目标 (第三阶段)

用 TypeScript + Electron Native API 重新实现自动化上传：

1. **核心驱动引擎替换**：
   - 弃用 Playwright。
   - 导航：使用 `webContents.loadURL`。
   - DOM 交互：使用 `webContents.executeJavaScript` 模拟点击、填写标题和话题。
   - **关键难点（文件上传）**：使用 Electron 的 **Chrome DevTools Protocol (CDP)**（即 `webContents.debugger`）来实现静默挂载本地视频文件。

2. **右侧发布控制台 UI**：
   - 新增“发布中心(Publish)” 小工具面板。
   - 表单：文件选择（`<input type="file">` 获取本地绝对路径）、标题、描述、话题标签。
   - 执行区：选择“抖音”并点击“开始上传”。
   - 日志区：右侧面板需要一个类似终端的带颜色日志框。

3. **健壮的日志监控系统（Logging System）**：
   - 主进程执行每一步（如：导航中、挂载文件中、填标题中、发布中、成功）都要通过 IPC 实时推送给渲染进程日志区展示。

4. **异常处理（人在回路）**：
   - 若遇到 DOM 结构变更、验证码、超时，自动将状态置为 `paused`，日志报错并提示用户在左侧窗口进行人工接管。

## 5. 本次任务必须交付

1. **CDP (Chrome DevTools Protocol) 封装层**：
   - 使用 `webContents.debugger.attach()` 封装 `DOM.setFileInputFiles` 方法上传文件。
2. **抖音上传器控制器**：
   - 实现包含从导航到发布的完整流程的 TypeScript 类或函数。
3. **主进程接口扩展**：
   - 新增 `start-upload` 和 `upload-log` 的 IPC 通道与 Preload 暴露。
4. **右侧 React 面板更新**：
   - 新增发布表单组件。
   - 封装日志控制台组件。

## 6. 具体实施技术方案与步骤 (AI 执行指南)

**这是指导 Codex / Antigravity 如何修改代码的详细行动路线：**

### 步骤 1：建立通信与类型 (IPC & Types)
- **目标文件**: `src/shared/types.ts`, `src/shared/ipcChannels.ts`
- **动作**: 
  - 增加日志 Payload 类型，如：`type UploadLog = { level: 'info'|'success'|'error', msg: string, time: number }`。
  - 增加 IPC channel 常量：`START_UPLOAD` (Renderer -> Main) 和 `UPLOAD_LOG` (Main -> Renderer)。

### 步骤 2：封装 Electron Debugger 上传模块
- **目标文件**: `src/main/cdpHelper.ts` (新建)
- **动作**:
  - 获取左侧 `BrowserView` 的 `webContents`。
  - 检查是否附加了 debugger：`if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')`。
  - 实现通过 selector 寻找 node 并挂载文件的逻辑：
    ```typescript
    const doc = await webContents.debugger.sendCommand('DOM.getDocument');
    const node = await webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type="file"][accept*="video"]' });
    await webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [absoluteFilePath] });
    ```

### 步骤 3：实现抖音上传器控制器
- **目标文件**: `src/main/douyinUploader.ts` (新建)
- **动作**:
  - 接收回调函数 `onLog: (log: UploadLog) => void`。
  - **流程控制**：
    1. 调用 `view.webContents.loadURL('https://creator.douyin.com/creator-micro/content/upload')`。
    2. 轮询并使用 `executeJavaScript` 检查 `document.body.innerText` 是否包含“扫码登录”等字眼，若有则触发 `onLog(error)` 并暂停，等待人工操作。
    3. 调用步骤 2 的 `cdpHelper` 挂载视频。
    4. 轮询当前 URL 等待跳转到 `/content/publish` 或 `/content/post/video` 页面。
    5. 组装并执行 `executeJavaScript` 脚本来修改标题 DOM，比如 `document.querySelector('input[type="text"]').value = title;` 并派发 `input` 事件触发 React 响应。
    6. 使用 `document.querySelector('.zone-container[contenteditable="true"]').innerHTML = desc;` 填入描述。
    7. 轮询等待“发布”按钮可点击（`!disabled`），调用 `.click()`。

### 步骤 4：主进程挂载 IPC
- **目标文件**: `src/main/ipc.ts`, `src/preload/index.ts`
- **动作**:
  - 在 preload 暴露 `api.startUpload(payload)` 和 `api.onUploadLog(callback)`。
  - 在 `ipc.ts` 监听 `START_UPLOAD`，并调用 `douyinUploader.ts` 中的主逻辑，将产生的日志通过 `webContents.send('UPLOAD_LOG')` 转发给右侧界面。

### 步骤 5：右侧 React UI 编写
- **目标文件**: `src/renderer/App.tsx`, `src/renderer/components/PublishPanel.tsx` (新建), `src/renderer/components/LogTerminal.tsx` (新建)
- **动作**:
  - 实现 UI 表单，让用户可以选择文件、填写参数。**注意：浏览器安全限制无法直接获得完整的绝对路径，可通过 Electron 原生 `dialog.showOpenDialog` 或在 preload 暴露获取真实路径的 API 来辅助。**
  - 将 `LogTerminal` 组件作为一个黑色背景、自动滚动到底部的区块，实时 append 渲染 IPC 发来的日志对象。

---
*(以下为第一二阶段产生的项目历史规则与约束，作为后续迭代的持续底线)*

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

右侧控制区应从第一阶段的简单按钮扩展为视频采集与发布操作台。

顶部状态区：
1. 当前页面 URL / host。
2. 页面标题。
3. 扫描状态：idle、scanning、paused、stopped、error。
4. 候选数量、已选数量、队列数量。

操作区：
1. 扫描当前视口。
2. 自动下滑扫描。
3. 停止扫描。
4. 暂停/继续。
5. 清空候选。
6. 将已选候选加入队列。

候选列表：
1. 支持勾选/取消勾选。
2. 显示标题、来源页面、缩略图、置信度等。

日志区：
1. 显示滚动开始、停止原因等过程日志。
2. 显示候选提取数量、去重数量。
3. **第三阶段新增：显示自动化发布的全流程日志。**
4. 不记录 cookies、token、账号密码、完整请求头。

## 9. 视频候选数据模型

1. `id`：本地生成的稳定候选 ID。
2. `sourcePageUrl`：候选来自的页面 URL。
3. `provider`：来源站点，例如 `youtube`、`bilibili`、`generic`。
4. `title`：页面可见标题或推断标题。
5. `pageUrl`：视频详情页或卡片链接。
6. `mediaUrl`：从 `video`、`source` 等拿到媒体 URL。
7. `thumbnailUrl`：缩略图 URL。
8. `durationText`：时长。
9. `extractionMethod`：提取方式。
10. `confidence`：置信度。
11. `status`：候选状态，包含 `selected`、`queued`、`paused_for_manual_action`。

## 10. 媒体提取范围

本阶段只做浏览器辅助发现和辅助发布，不做真实下载。
自动下滑由主进程控制 `BrowserView` 执行脚本，探测人工处理需求时进入 `paused_for_manual_action`。

## 11. IPC 与安全桥接目标

渲染层仍不直接访问 Node.js、文件系统、cookies、session。所有相关动作（如上传读取本地文件）必须通过主进程受控方法触发。不暴露任意 `executeJavaScript` 给 React。

## 12. 本地资源与 GitHub 安全边界

必须留在本地或被 `.gitignore` 保护的内容：
1. Electron/Chromium session profile。
2. cookies, token, 账号密码。
3. 真实运行配置。
4. 日志文件、临时缓存。
所有涉及状态保留优先存放内存，如需持久化必须避免进入 Git 追踪。

## 13. 日志与调试要求

1. 保持 info、warn、error 级别或等价能力。
2. 记录导航、下滑、提取、上传发布等重要过程，禁止记录敏感请求信息。

## 14. 验收标准
1. `npm run typecheck` / `build` 通过。
2. 不破坏一二阶段导航和抓取功能。
3. **右侧新增 Publish 界面并能通过弹窗选择文件。**
4. **日志终端能实时收到主进程打印的 CDP 注入和步骤信息。**

## 15. 完成说明
*(由 Codex 完成代码后更新此段内容)*

## 16. 给 AI 的执行提示
请阅读本文件，并执行第三阶段任务（发布功能集成）。不要真实下载，不要逆向未开放接口。禁止执行 `git push` 等发版操作，完成后向用户汇报即可。
