import type { Database } from "../Database";
import type { KuaishouPageType, KuaishouUploadTaskInput, KuaishouUploadTaskResult } from "../../../shared/kuaishou/types";

type TaskRow = {
  id: string;
  platform: "kuaishou";
  status: KuaishouUploadTaskResult["status"];
  current_url?: string;
  page_type?: KuaishouPageType;
  element_profile_id: string;
  error_code?: string;
  error_message?: string;
};

export class UploadTaskRepository {
  constructor(private readonly db: Database) {}

  create(taskId: string, input: KuaishouUploadTaskInput, elementProfileId: string): KuaishouUploadTaskResult {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO upload_tasks (
          id, platform, account_id, video_path, caption, cover_path, publish_time, publish_mode,
          element_profile_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        taskId,
        input.platform,
        input.accountId,
        input.videoPath,
        input.caption,
        input.coverPath || null,
        input.scheduledPublishTime || null,
        input.publishMode,
        elementProfileId,
        "created",
        now,
        now
      );

    return { ok: true, taskId, platform: "kuaishou", status: "created", elementProfileId };
  }

  updateStatus(
    taskId: string,
    status: KuaishouUploadTaskResult["status"],
    patch: { currentUrl?: string; pageType?: KuaishouPageType; errorCode?: string; errorMessage?: string } = {}
  ): void {
    this.db
      .prepare(
        `UPDATE upload_tasks
         SET status = ?, current_url = COALESCE(?, current_url), page_type = COALESCE(?, page_type),
             error_code = ?, error_message = ?, updated_at = ?, finished_at = CASE WHEN ? IN ('published','failed','cancelled') THEN ? ELSE finished_at END
         WHERE id = ?`
      )
      .run(
        status,
        patch.currentUrl || null,
        patch.pageType || null,
        patch.errorCode || null,
        patch.errorMessage || null,
        Date.now(),
        status,
        Date.now(),
        taskId
      );
  }

  get(taskId: string): KuaishouUploadTaskResult | null {
    const row = this.db
      .prepare(
        "SELECT id, platform, status, current_url, page_type, element_profile_id, error_code, error_message FROM upload_tasks WHERE id = ?"
      )
      .get(taskId) as TaskRow | undefined;

    if (!row) return null;

    return {
      ok: row.status !== "failed" && row.status !== "cancelled" && row.status !== "waiting_manual_action",
      taskId: row.id,
      platform: row.platform,
      status: row.status,
      currentUrl: row.current_url,
      pageType: row.page_type,
      elementProfileId: row.element_profile_id,
      error: row.error_code
        ? {
            code: row.error_code,
            message: row.error_message || row.error_code,
            step: row.status
          }
        : undefined
    };
  }
}
