import type { Database } from "../Database";
import crypto from "node:crypto";
import type { TaskLog } from "../../../shared/kuaishou/types";

type Row = {
  id: string;
  task_id: string;
  level: "info" | "warn" | "error";
  step: string;
  message: string;
  data_json?: string;
  created_at: number;
};

export class TaskLogRepository {
  constructor(private readonly db: Database) {}

  add(taskId: string, level: TaskLog["level"], step: string, message: string, data?: unknown): TaskLog {
    const log: TaskLog = {
      id: crypto.randomUUID(),
      taskId,
      level,
      step,
      message,
      dataJson: data ? JSON.stringify(data) : undefined,
      createdAt: Date.now()
    };
    this.db
      .prepare("INSERT INTO task_logs (id, task_id, level, step, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(log.id, log.taskId, log.level, log.step, log.message, log.dataJson || null, log.createdAt);
    return log;
  }

  list(taskId: string): TaskLog[] {
    const rows = this.db
      .prepare("SELECT id, task_id, level, step, message, data_json, created_at FROM task_logs WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId) as Row[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      level: row.level,
      step: row.step,
      message: row.message,
      dataJson: row.data_json,
      createdAt: row.created_at
    }));
  }
}
