import fs from "node:fs";
import crypto from "node:crypto";
import type { BrowserWorkspace } from "../../browser/BrowserWorkspace";
import { PageArtifactService } from "../../rpa/PageArtifactService";
import { RpaDriver } from "../../rpa/RpaDriver";
import type { ElementProfileRepository } from "../../storage/repositories/ElementProfileRepository";
import type { TaskArtifactRepository } from "../../storage/repositories/TaskArtifactRepository";
import type { TaskLogRepository } from "../../storage/repositories/TaskLogRepository";
import type { UploadTaskRepository } from "../../storage/repositories/UploadTaskRepository";
import type { KuaishouDraftPolicy, KuaishouFormState, KuaishouUploadTaskInput, KuaishouUploadTaskResult, KuaishouUploadIntent } from "../types";
import { isKuaishouPageActionError, KuaishouPageBinding } from "./KuaishouPageBinding";
import { KuaishouPageDetector } from "./KuaishouPageDetector";

type Repositories = {
  elementProfileRepository: ElementProfileRepository;
  uploadTaskRepository: UploadTaskRepository;
  taskLogRepository: TaskLogRepository;
  taskArtifactRepository: TaskArtifactRepository;
};

export class KuaishouUploadService {
  constructor(
    private readonly browserWorkspace: BrowserWorkspace,
    private readonly repositories: Repositories,
    private readonly openUploadPage: () => Promise<void>
  ) {}

  async uploadSingleVideo(input: KuaishouUploadTaskInput): Promise<KuaishouUploadTaskResult> {
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const taskId = crypto.randomUUID();
    this.repositories.uploadTaskRepository.create(taskId, input, profile.id);
    const uploadIntent: KuaishouUploadIntent = input.uploadIntent || "new_video";
    const draftPolicy: KuaishouDraftPolicy = input.draftPolicy || (uploadIntent === "new_video" ? "pause" : "continue");
    this.log(taskId, "info", "task_created", "上传任务已创建", {
      publishMode: input.publishMode,
      uploadIntent,
      draftPolicy
    });

    try {
      this.log(taskId, "info", "file_checked", "检查视频文件");
      if (!fs.existsSync(input.videoPath)) {
        return this.fail(taskId, profile.id, "FILE_NOT_FOUND", "视频文件不存在", "file_checked");
      }
      this.log(taskId, "info", "file_check_done", "视频文件存在", {
        videoPath: input.videoPath
      });

      const driver = new RpaDriver(this.browserWorkspace.webContents);
      const detector = new KuaishouPageDetector(driver, profile);
      this.log(taskId, "info", "page_detect_started", "开始识别页面");
      let detection = await detector.detectPage();
      this.log(taskId, "info", "page_detect_done", "页面识别完成", {
        pageType: detection.pageType,
        currentUrl: detection.url,
        capabilities: detection.capabilities
      });

      if (detection.capabilities.loginRequired) {
        this.repositories.uploadTaskRepository.updateStatus(taskId, "waiting_login", {
          currentUrl: detection.url,
          pageType: detection.pageType
        });
        this.log(taskId, "warn", "login_checked", "需要先在左侧浏览器手动登录", { pageType: detection.pageType });
        return this.result(taskId);
      }

      const binding = new KuaishouPageBinding(driver, profile, () => detector.detectPage());

      if (uploadIntent === "new_video") {
        const prepared = await this.prepareNewVideoUpload(taskId, profile.id, binding, detector, detection, draftPolicy);
        if ("result" in prepared) {
          return prepared.result;
        }
        detection = prepared.detection;
      } else {
        detection = await this.continueDraftIfNeeded(taskId, binding, detector, detection);

        if (!["upload_edit", "uploading", "waiting_publish"].includes(detection.pageType)) {
          this.repositories.uploadTaskRepository.updateStatus(taskId, "opening_upload_page", {
            currentUrl: detection.url,
            pageType: detection.pageType
          });
          this.log(taskId, "info", "upload_page_open_started", "打开上传页面");
          await this.openUploadPage();
          detection = await detector.detectPage();
          detection = await this.continueDraftIfNeeded(taskId, binding, detector, detection);
          this.log(taskId, "info", "upload_page_open_done", "上传页面已打开", {
            pageType: detection.pageType,
            currentUrl: detection.url
          });
        }
      }

      const fileInput = await binding.fileInput();
      const fileInputCount = await fileInput.count();
      if (fileInputCount === 0) {
        return this.fail(taskId, profile.id, "ELEMENT_NOT_FOUND", "没有找到视频文件 input", "file_input_located");
      }
      this.log(taskId, "info", "file_input_located", "已定位视频文件 input", { matchedCount: fileInputCount });

      this.repositories.uploadTaskRepository.updateStatus(taskId, "uploading", {
        currentUrl: await driver.currentUrl(),
        pageType: detection.pageType
      });
      await fileInput.setFiles([input.videoPath]);
      this.log(taskId, "info", "video_file_attached", "已设置视频文件");

      this.repositories.uploadTaskRepository.updateStatus(taskId, "editing");
      await driver.waitUntil(async () => {
        const nextDetection = await detector.detectPage();
        return nextDetection.capabilities.hasEditableContent || nextDetection.capabilities.hasUploadProgress || nextDetection.capabilities.hasPublishButton;
      }, {
        timeoutMs: input.timeoutMs || 300000,
        intervalMs: 1500
      });

      detection = await detector.detectPage();
      if (!detection.capabilities.hasEditableContent) {
        return this.fail(taskId, profile.id, "PAGE_NOT_EDITABLE", "上传后没有进入可编辑页面", "edit_page_detected");
      }

      this.log(taskId, "info", "edit_page_detected", "已进入上传编辑页", {
        pageType: detection.pageType,
        capabilities: detection.capabilities
      });

      await binding.applyFormState(this.inputToFormState(input));
      this.log(taskId, "info", "publish_settings_applied", "已写入右侧面板中的网页参数");

      if (input.coverPath) {
        if (!fs.existsSync(input.coverPath)) {
          return this.fail(taskId, profile.id, "COVER_SET_FAILED", "封面文件不存在", "cover_set_done");
        }
        this.log(taskId, "warn", "cover_manual_required", "封面文件已选择，但封面弹窗细节当前需要在左侧页面手动确认", {
          coverPath: input.coverPath
        });
      } else {
        this.log(taskId, "info", "cover_skipped", "未设置封面");
      }

      this.repositories.uploadTaskRepository.updateStatus(taskId, "waiting_upload_complete");
      this.log(taskId, "info", "upload_wait_started", "等待上传完成");
      await driver.waitUntil(() => binding.uploadCompleteVisible(), {
        timeoutMs: input.timeoutMs || 300000,
        intervalMs: 1500
      });

      const errorText = await binding.errorText();
      if (errorText) {
        return this.fail(taskId, profile.id, "PLATFORM_ERROR_TOAST", errorText, "upload_complete_detected");
      }

      this.log(taskId, "info", "upload_complete_detected", "上传完成提示已出现");
      this.repositories.uploadTaskRepository.updateStatus(taskId, "waiting_publish_confirm", {
        currentUrl: await driver.currentUrl(),
        pageType: "waiting_publish"
      });
      this.log(taskId, "info", "waiting_manual_publish", "上传完成后停在发布前确认");
      return this.result(taskId);
    } catch (error) {
      if (isKuaishouPageActionError(error)) {
        return this.fail(taskId, profile.id, error.details.code, error.details.message, error.details.step);
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.fail(taskId, profile.id, this.normalizeErrorCode(message), message, "task_failed");
    }
  }

  async confirmPublish(taskId: string): Promise<KuaishouUploadTaskResult> {
    const task = this.repositories.uploadTaskRepository.get(taskId);
    if (!task) {
      return {
        ok: false,
        taskId,
        platform: "kuaishou",
        status: "failed",
        elementProfileId: "unknown",
        error: { code: "UNKNOWN_ERROR", message: "任务不存在", step: "publish_clicked" }
      };
    }

    try {
      const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
      const driver = new RpaDriver(this.browserWorkspace.webContents);
      const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
      const publishButton = await binding.publishButton();
      const count = await publishButton.count();
      if (count === 0) {
        return this.fail(taskId, profile.id, "PUBLISH_BUTTON_NOT_FOUND", "没有找到发布按钮", "publish_clicked");
      }
      await publishButton.click();
      this.log(taskId, "info", "publish_clicked", "已点击发布按钮");
      this.repositories.uploadTaskRepository.updateStatus(taskId, "published", {
        currentUrl: await driver.currentUrl(),
        pageType: "published"
      });
      this.log(taskId, "info", "task_published", "任务已发布");
      return this.result(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
      return this.fail(taskId, profile.id, "PUBLISH_FAILED", message, "task_failed");
    }
  }

  async cancelTask(taskId: string): Promise<KuaishouUploadTaskResult> {
    this.repositories.uploadTaskRepository.updateStatus(taskId, "cancelled", {
      errorCode: "USER_CANCELLED",
      errorMessage: "用户取消任务"
    });
    this.log(taskId, "warn", "task_cancelled", "用户取消任务");
    return this.result(taskId);
  }

  private log(taskId: string, level: "info" | "warn" | "error", step: string, message: string, data?: unknown): void {
    this.repositories.taskLogRepository.add(taskId, level, step, message, data);
  }

  private async fail(
    taskId: string,
    elementProfileId: string,
    code: string,
    message: string,
    step: string
  ): Promise<KuaishouUploadTaskResult> {
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const artifactService = new PageArtifactService(this.browserWorkspace.webContents);
    const currentUrl = await driver.currentUrl().catch(() => "");
    let screenshot = "";
    let domSnapshot = "";

    try {
      screenshot = await artifactService.screenshot(taskId);
      this.repositories.taskArtifactRepository.add(taskId, "screenshot", screenshot);
    } catch {
      screenshot = "";
    }

    try {
      domSnapshot = await artifactService.domSnapshot(taskId);
      this.repositories.taskArtifactRepository.add(taskId, "dom_snapshot", domSnapshot);
    } catch {
      domSnapshot = "";
    }

    const errorReport = artifactService.writeErrorReport(taskId, {
      taskId,
      platform: "kuaishou",
      step,
      currentUrl,
      pageType: "",
      elementProfileId,
      locatorAttempts: [],
      error: {
        code,
        message
      }
    });
    this.repositories.taskArtifactRepository.add(taskId, "error_report", errorReport);
    this.repositories.uploadTaskRepository.updateStatus(taskId, "failed", {
      currentUrl,
      errorCode: code,
      errorMessage: message
    });
    this.log(taskId, "error", "task_failed", message, { code, step, screenshot, domSnapshot, errorReport });
    return this.result(taskId);
  }

  private result(taskId: string): KuaishouUploadTaskResult {
    const task = this.repositories.uploadTaskRepository.get(taskId);
    if (!task) {
      throw new Error("UNKNOWN_ERROR");
    }

    return {
      ...task,
      artifacts: this.repositories.taskArtifactRepository.list(taskId)
    };
  }

  private normalizeErrorCode(message: string): string {
    const known = new Set([
      "ACCOUNT_NOT_FOUND",
      "SESSION_SWITCH_FAILED",
      "PAGE_DETECT_FAILED",
      "LOGIN_REQUIRED",
      "UPLOAD_PAGE_LOAD_FAILED",
      "ELEMENT_NOT_FOUND",
      "ELEMENT_NOT_VISIBLE",
      "FILE_NOT_FOUND",
      "FILE_ATTACH_FAILED",
      "FORM_APPLY_FAILED",
      "PAGE_SYNC_FAILED",
      "PAGE_NOT_EDITABLE",
      "MANUAL_ACTION_REQUIRED",
      "CAPTION_FILL_FAILED",
      "COVER_SET_FAILED",
      "PUBLISH_TIME_SET_FAILED",
      "UPLOAD_TIMEOUT",
      "PLATFORM_ERROR_TOAST",
      "PUBLISH_BUTTON_NOT_FOUND",
      "PUBLISH_FAILED",
      "DRAFT_CONFLICT",
      "UPLOAD_INTAKE_NOT_FOUND",
      "EDIT_PAGE_NOT_READY",
      "PUBLISH_CONFIRM_FAILED",
      "OPTION_NOT_FOUND",
      "OPTION_AMBIGUOUS",
      "TIME_PICKER_NOT_FOUND",
      "TIME_WRITE_MISMATCH",
      "USER_CANCELLED",
      "UNKNOWN_ERROR"
    ]);
    return known.has(message) ? message : "UNKNOWN_ERROR";
  }

  private async prepareNewVideoUpload(
    taskId: string,
    elementProfileId: string,
    binding: KuaishouPageBinding,
    detector: KuaishouPageDetector,
    detection: Awaited<ReturnType<KuaishouPageDetector["detectPage"]>>,
    draftPolicy: KuaishouDraftPolicy
  ): Promise<{ detection: Awaited<ReturnType<KuaishouPageDetector["detectPage"]>> } | { result: KuaishouUploadTaskResult }> {
    let current = detection;

    if (current.capabilities.hasDraftContinueButton && draftPolicy !== "continue") {
      return {
        result: await this.manualAction(
          taskId,
          elementProfileId,
          "DRAFT_CONFLICT",
          "检测到未发布草稿。批量上传新视频已暂停，请在左侧页面处理草稿后重试。",
          "draft_conflict_detected",
          current
        )
      };
    }

    if (current.capabilities.hasEditableContent && draftPolicy !== "continue") {
      return {
        result: await this.manualAction(
          taskId,
          elementProfileId,
          "DRAFT_CONFLICT",
          "当前页面已有可编辑视频内容。批量上传新视频不会覆盖当前草稿，请先人工处理后重试。",
          "editable_draft_detected",
          current
        )
      };
    }

    if (current.capabilities.hasDraftContinueButton && draftPolicy === "continue") {
      current = await this.continueDraftIfNeeded(taskId, binding, detector, current);
    }

    if (!current.capabilities.hasFileInput || current.capabilities.hasEditableContent) {
      this.repositories.uploadTaskRepository.updateStatus(taskId, "opening_upload_page", {
        currentUrl: current.url,
        pageType: current.pageType
      });
      this.log(taskId, "info", "upload_page_open_started", "打开新视频上传入口");
      await this.openUploadPage();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      current = await detector.detectPage();
      this.log(taskId, "info", "upload_page_open_done", "新视频上传入口已打开", {
        pageType: current.pageType,
        currentUrl: current.url,
        capabilities: current.capabilities
      });
    }

    if (current.capabilities.hasDraftContinueButton && draftPolicy !== "continue") {
      return {
        result: await this.manualAction(
          taskId,
          elementProfileId,
          "DRAFT_CONFLICT",
          "打开上传入口后检测到未发布草稿。批量上传新视频已暂停，请在左侧页面处理草稿后重试。",
          "draft_conflict_detected",
          current
        )
      };
    }

    if (current.capabilities.hasEditableContent && draftPolicy !== "continue") {
      return {
        result: await this.manualAction(
          taskId,
          elementProfileId,
          "DRAFT_CONFLICT",
          "打开上传入口后检测到已有可编辑内容。批量上传新视频已暂停，请在左侧页面处理后重试。",
          "editable_draft_detected",
          current
        )
      };
    }

    if (!current.capabilities.hasFileInput && current.capabilities.hasUploadEntryButton) {
      this.log(taskId, "info", "upload_entry_click_started", "点击上传入口按钮");
      const uploadEntryButton = await binding.uploadEntryButton();
      await uploadEntryButton.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      current = await detector.detectPage();
      this.log(taskId, "info", "upload_entry_click_done", "上传入口按钮点击完成", {
        pageType: current.pageType,
        currentUrl: current.url,
        capabilities: current.capabilities
      });
    }

    if (!current.capabilities.hasFileInput) {
      return {
        result: await this.fail(
          taskId,
          elementProfileId,
          "UPLOAD_INTAKE_NOT_FOUND",
          "没有找到新视频上传文件选择入口。",
          "file_input_located"
        )
      };
    }

    return { detection: current };
  }

  private async continueDraftIfNeeded(
    taskId: string,
    binding: KuaishouPageBinding,
    detector: KuaishouPageDetector,
    detection: Awaited<ReturnType<KuaishouPageDetector["detectPage"]>>
  ): Promise<Awaited<ReturnType<KuaishouPageDetector["detectPage"]>>> {
    if (!detection.capabilities.hasDraftContinueButton) {
      return detection;
    }

    this.log(taskId, "info", "draft_continue_detected", "检测到未发布草稿，自动继续编辑草稿", {
      currentUrl: detection.url
    });
    const draftContinueButton = await binding.draftContinueButton();
    await draftContinueButton.click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return detector.detectPage();
  }

  private async manualAction(
    taskId: string,
    elementProfileId: string,
    code: string,
    message: string,
    step: string,
    detection: Awaited<ReturnType<KuaishouPageDetector["detectPage"]>>
  ): Promise<KuaishouUploadTaskResult> {
    this.repositories.uploadTaskRepository.updateStatus(taskId, "waiting_manual_action", {
      currentUrl: detection.url,
      pageType: detection.pageType,
      errorCode: code,
      errorMessage: message
    });
    this.log(taskId, "warn", step, message, {
      code,
      pageType: detection.pageType,
      currentUrl: detection.url,
      capabilities: detection.capabilities
    });
    return {
      ...(await this.result(taskId)),
      ok: false,
      elementProfileId
    };
  }

  private inputToFormState(input: KuaishouUploadTaskInput): KuaishouFormState {
    const dirtyFields: KuaishouFormState["dirtyFields"] = input.dirtyFields
      ? Array.from(new Set(input.dirtyFields))
      : this.inferDirtyFields(input);

    return {
      videoPath: input.videoPath,
      coverPath: input.coverPath || "",
      caption: input.caption || "",
      pkCoverEnabled: input.pkCoverEnabled,
      chaptersText: input.chaptersText || "",
      authorServiceType: input.authorServiceType || "",
      linkedBenefit: input.linkedBenefit || "",
      hotspot: input.hotspot || "",
      authorStatement: input.authorStatement || "",
      collectionName: input.collectionName || "",
      locationRegion: input.locationRegion || "",
      locationAddress: input.locationAddress || "",
      allowSameFrame: input.allowSameFrame ?? true,
      allowDownload: input.allowDownload ?? true,
      showInNearby: input.showInNearby ?? true,
      visibility: input.visibility || "public",
      publishTimingMode: input.publishTimingMode || "immediate",
      scheduledPublishTime: input.scheduledPublishTime || "",
      useBestTimeSuggestion: input.useBestTimeSuggestion || false,
      publishMode: input.publishMode,
      dirtyFields,
      lastUpdatedBy: "task",
      updatedAt: Date.now()
    };
  }

  private inferDirtyFields(input: KuaishouUploadTaskInput): KuaishouFormState["dirtyFields"] {
    const fields: KuaishouFormState["dirtyFields"] = ["caption"];
    const addIfProvided = (field: keyof KuaishouUploadTaskInput, formField = field) => {
      const value = input[field];
      if (value === undefined || value === null) return;
      if (typeof value === "string" && value.length === 0) return;
      fields.push(formField as KuaishouFormState["dirtyFields"][number]);
    };

    addIfProvided("pkCoverEnabled");
    addIfProvided("chaptersText");
    addIfProvided("authorServiceType");
    addIfProvided("linkedBenefit");
    addIfProvided("hotspot");
    addIfProvided("authorStatement");
    addIfProvided("collectionName");
    addIfProvided("locationRegion");
    addIfProvided("locationAddress");
    addIfProvided("allowSameFrame");
    addIfProvided("allowDownload");
    addIfProvided("showInNearby");
    addIfProvided("visibility");
    addIfProvided("publishTimingMode");
    addIfProvided("scheduledPublishTime");
    addIfProvided("useBestTimeSuggestion");
    return Array.from(new Set(fields));
  }
}
