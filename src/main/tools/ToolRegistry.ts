export class ToolRegistry {
  listTools() {
    return [
      { id: "video-upload" as const, name: "视频上传", route: "video-upload", enabled: true },
      { id: "workflows" as const, name: "工作流", route: "workflows", enabled: true }
    ];
  }
}
