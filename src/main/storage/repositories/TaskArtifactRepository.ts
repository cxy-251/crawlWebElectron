import type { Database } from "../Database";
import crypto from "node:crypto";
import type { TaskArtifact } from "../../video-upload/types";

export class TaskArtifactRepository {
  constructor(private readonly db: Database) {}

  add(taskId: string, type: TaskArtifact["type"], filePath: string): TaskArtifact {
    const artifact: TaskArtifact = {
      id: crypto.randomUUID(),
      taskId,
      type,
      filePath,
      createdAt: Date.now()
    };
    this.db
      .prepare("INSERT INTO task_artifacts (id, task_id, type, file_path, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(artifact.id, artifact.taskId, artifact.type, artifact.filePath, artifact.createdAt);
    return artifact;
  }

  list(taskId: string): TaskArtifact[] {
    const rows = this.db
      .prepare("SELECT id, task_id, type, file_path, created_at FROM task_artifacts WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId) as Array<{ id: string; task_id: string; type: TaskArtifact["type"]; file_path: string; created_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      filePath: row.file_path,
      createdAt: row.created_at
    }));
  }
}
