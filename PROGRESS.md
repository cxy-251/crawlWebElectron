# PROGRESS.md

## 快手上传 API 上库前整理记录

### 本轮实际修改文件

- `.gitignore`
- `PROJPLAN.md`
- `CURRENT_ISSUES.md`
- `PROGRESS.md`
- `src/main/api/KuaishouLocalApiServer.ts`
- `src/main/storage/repositories/UploadTaskRepository.ts`
- `src/main/video-upload/types.ts`
- `src/main/video-upload/kuaishou/KuaishouUploadService.ts`

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

`local-api-usage/` 中包含：

```txt
constants.mjs
generate-kuaishou-tasks.mjs
batch-publish-kuaishou.mjs
README.md
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
