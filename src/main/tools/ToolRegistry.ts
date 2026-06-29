export class ToolRegistry {
  listTools() {
    return [
      { id: "kuaishou" as const, name: "视频上传", route: "kuaishou", enabled: true },
      { id: "workflows" as const, name: "工作流", route: "workflows", enabled: true }
    ];
  }
}
