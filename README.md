# CrawlWebElectron

Electron + React 的网页采集工作台第一阶段原型。左侧用 Electron `BrowserView` 承载真实网页，右侧是 React 自动化控制面板。

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

1. 左侧地址栏输入 `https://example.com` 或其他 `http/https` 页面并打开。
2. 使用后退、前进、刷新验证基础浏览能力。
3. 在可登录网站中登录后关闭应用，再重新启动，Electron 持久化 session 会尽量保留登录态。
4. 点击右侧 `URL`、`Title`、`Links`、`Ping`，检查结果区输出当前页面 URL、标题、链接列表和 IPC 返回值。
5. 查看启动终端，主进程会输出窗口创建、网页加载、IPC 调用和脚本执行错误等日志。

## 模块职责

- `src/main/main.ts`：Electron 应用生命周期入口。
- `src/main/appWindow.ts`：创建承载 React 外壳的主窗口。
- `src/main/webViewController.ts`：创建和控制左侧 `BrowserView`，负责导航、会话 partition、页面状态和链接提取。
- `src/main/ipc.ts`：注册主进程 IPC 处理器。
- `src/main/navigation.ts`：规范化并限制导航 URL。
- `src/main/logger.ts`：提供基础日志和敏感字段脱敏。
- `src/preload/index.ts`：通过 `contextBridge` 暴露最小安全 API。
- `src/renderer/App.tsx`：左右分栏界面、导航栏、控制面板和结果展示。
- `src/shared/`：主进程、preload、renderer 共用的 IPC 名称和类型。

## 安全边界

允许进入 Git 的内容：源码、文档、工程配置、示例配置。

必须留在本地并被 `.gitignore` 保护的内容：`node_modules/`、构建产物、日志、`.env*` 真实配置、本地运行目录、缓存、下载文件、用户数据和临时文件。React renderer 不直接读取本地敏感文件，网页会话由 Electron 持久化 partition 管理。

导航入口只允许 `http`、`https` 和默认 `about:blank`，避免从 UI 打开 `file:`、`javascript:`、`data:` 等高风险 URL。
