export class ToolRegistry {
  listTools() {
    return [
      { id: "video-upload" as const, name: "视频上传", route: "video-upload", enabled: true },
      { id: "browser-automation" as const, name: "浏览器自动化", route: "browser-automation", enabled: true }
    ];
  }
}
