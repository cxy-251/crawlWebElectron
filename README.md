# CrawlWebElectron

Electron + React 的网页采集工作台原型。左侧用 Electron `BrowserView` 承载真实网页，右侧是 React 视频采集控制台。

第二阶段已经支持智能地址输入、当前页面视频候选扫描、自动下滑扫描、候选勾选和模拟下载队列。本阶段不执行真实文件下载。

## 启动

```bash
npm install
npm run dev
```

开发模式会启动 Vite renderer，并在 Electron 主进程中加载 `http://127.0.0.1:5173`。

如果 Electron 二进制下载很慢，可以临时使用镜像安装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

也可以构建后启动：

```bash
npm run start
```

## 验证

1. 左侧地址栏输入 `google`，应打开 `https://www.google.com`。
2. 输入 `youtube`，应打开 `https://www.youtube.com`。
3. 输入 `example.com`，应补全为 `https://example.com`。
4. 输入包含空格的搜索词，应打开 Google 搜索。
5. 输入 `file:///tmp/a.txt` 或 `javascript:alert(1)`，应被拒绝并在右侧日志显示错误。
6. 点击右侧 `Scan`，扫描当前页面的 `video`、`source` 和常见视频卡片链接。
7. 点击 `Auto`，左侧页面会自动下滑并持续合并候选。
8. 点击 `Pause`、`Resume`、`Stop` 验证扫描状态切换。
9. 勾选候选后点击 `Queue`，候选会进入模拟队列，不会产生下载文件。
10. 如果页面出现 robot/captcha/登录验证等人工处理需求，自动化会暂停；用户在左侧处理后点击 `Resume`。

## 模块职责

- `src/main/main.ts`：Electron 应用生命周期入口。
- `src/main/appWindow.ts`：创建承载 React 外壳的主窗口。
- `src/main/webViewController.ts`：创建和控制左侧 `BrowserView`，负责导航、会话 partition、页面状态、媒体扫描和自动下滑控制。
- `src/main/mediaScanner.ts`：受控执行页面扫描脚本，提取视频候选并读取滚动状态。
- `src/main/ipc.ts`：注册主进程 IPC 处理器。
- `src/main/navigation.ts`：智能地址输入、搜索和安全协议限制。
- `src/main/logger.ts`：提供基础日志和敏感字段脱敏。
- `src/preload/index.ts`：通过 `contextBridge` 暴露最小安全 API。
- `src/renderer/App.tsx`：左右分栏界面、地址栏、视频采集控制台、候选列表、模拟队列和日志。
- `src/shared/`：主进程、preload、renderer 共用的 IPC 名称和类型。

## 安全边界

允许进入 Git 的内容：源码、文档、工程配置、示例配置。

必须留在本地并被 `.gitignore` 保护的内容：`node_modules/`、构建产物、日志、`.env*` 真实配置、本地运行目录、缓存、下载文件、用户数据和临时文件。

网页登录态由 Electron 持久化 partition `persist:crawl-web-electron` 管理。cookies、localStorage、IndexedDB 和缓存等 Chromium/Electron profile 数据保存在系统应用数据目录，例如 macOS 上的 `~/Library/Application Support/CrawlWebElectron`，不在仓库中。

React renderer 不直接读取本地敏感文件，不直接访问 Node.js，不暴露任意 `executeJavaScript`。页面脚本执行由主进程受控触发。

## 当前限制

- 模拟队列只记录候选状态，不下载文件。
- 未接入 yt-dlp。
- 未实现浏览器“另存为”下载。
- 未逆向网站未开放接口。
- 不绕过 robot/captcha/登录验证；需要人工处理时会暂停并等待用户操作。
