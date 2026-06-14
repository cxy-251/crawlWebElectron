import fs from "node:fs";
import crypto from "node:crypto";
import type { BrowserWorkspace } from "../../browser/BrowserWorkspace";
import { PageArtifactService } from "../../rpa/PageArtifactService";
import { RpaDriver } from "../../rpa/RpaDriver";
import type { ElementProfileRepository } from "../../storage/repositories/ElementProfileRepository";
import type { TaskArtifactRepository } from "../../storage/repositories/TaskArtifactRepository";
import type { TaskLogRepository } from "../../storage/repositories/TaskLogRepository";
import type { UploadTaskRepository } from "../../storage/repositories/UploadTaskRepository";
import type {
  KuaishouDraftPolicy,
  KuaishouFormState,
  KuaishouPageDetection,
  KuaishouUploadTaskInput,
  KuaishouUploadTaskResult,
  KuaishouUploadIntent
} from "../types";
import { isKuaishouPageActionError, KuaishouPageBinding } from "./KuaishouPageBinding";
import { KuaishouPageDetector } from "./KuaishouPageDetector";

type Repositories = {
  elementProfileRepository: ElementProfileRepository;
  uploadTaskRepository: UploadTaskRepository;
  taskLogRepository: TaskLogRepository;
  taskArtifactRepository: TaskArtifactRepository;
};

type PageStateSummary = {
  elapsedMs: number;
  pageType: KuaishouPageDetection["pageType"];
  url: string;
  capabilities: Pick<
    KuaishouPageDetection["capabilities"],
    | "loginRequired"
    | "hasDraftContinueButton"
    | "hasUploadEntryButton"
    | "hasFileInput"
    | "hasUploadProgress"
    | "hasEditableContent"
    | "hasUploadComplete"
    | "hasPublishButton"
  >;
};

type PageStateWaitResult =
  | {
      ok: true;
      detection: KuaishouPageDetection;
      history: PageStateSummary[];
    }
  | {
      ok: false;
      detection?: KuaishouPageDetection;
      history: PageStateSummary[];
      lastError?: string;
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

      if (uploadIntent === "current_intake") {
        if (!detection.capabilities.hasFileInput) {
          return this.fail(taskId, profile.id, "UPLOAD_INTAKE_NOT_FOUND", "当前页面没有检测到视频文件选择入口。", "file_input_located", {
            detection
          });
        }
        if (detection.capabilities.hasEditableContent) {
          return this.fail(taskId, profile.id, "PAGE_NOT_EDITABLE", "当前已经在发布参数编辑页，不应执行上传视频入口动作。", "file_input_located", {
            detection
          });
        }
        this.log(taskId, "info", "current_intake_confirmed", "当前页面已有视频文件选择入口，直接设置视频文件", {
          pageType: detection.pageType,
          currentUrl: detection.url,
          capabilities: detection.capabilities
        });
      } else if (uploadIntent === "new_video") {
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
          const waited = await this.waitForPageState(
            taskId,
            detector,
            "upload_page_opened",
            "等待上传页从加载状态进入可识别状态",
            (nextDetection) => this.isKnownUploadSurface(nextDetection),
            {
              timeoutMs: Math.min(input.timeoutMs || 300000, 60000)
            }
          );
          if (!waited.ok) {
            return this.fail(
              taskId,
              profile.id,
              "UPLOAD_INTAKE_NOT_FOUND",
              "打开上传页面后，页面没有进入登录、草稿、上传入口、文件选择或编辑状态。",
              "upload_page_opened",
              waited
            );
          }
          detection = waited.detection;
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
      const beforeAttachUrl = await driver.currentUrl();
      this.log(taskId, "info", "video_file_attach_started", "开始设置视频文件", {
        videoPath: input.videoPath,
        beforeAttachUrl,
        fileInputCount
      });
      try {
        await fileInput.setFiles([input.videoPath]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(taskId, "error", "video_file_attach_failed", "设置视频文件失败", {
          error: message,
          fileInputCount,
          beforeAttachUrl
        });
        return this.fail(taskId, profile.id, "FILE_ATTACH_FAILED", `设置视频文件失败：${message}`, "video_file_attached");
      }
      this.log(taskId, "info", "video_file_attached", "已设置视频文件");

      const attachResponded = await this.waitForUploadResponse(taskId, detector, beforeAttachUrl, input.timeoutMs || 300000);
      if (!attachResponded.ok) {
        return this.fail(
          taskId,
          profile.id,
          "FILE_ATTACH_FAILED",
          "已设置视频文件，但页面没有进入上传中或发布参数编辑页。",
          "video_file_attached",
          attachResponded
        );
      }
      this.log(taskId, "info", "video_file_attach_verified", "页面已响应视频文件设置", {
        pageType: attachResponded.detection.pageType,
        currentUrl: attachResponded.detection.url,
        capabilities: attachResponded.detection.capabilities
      });

      this.repositories.uploadTaskRepository.updateStatus(taskId, "waiting_upload_complete");
      this.log(taskId, "info", "edit_page_wait_started", "等待上传完成并进入发布参数编辑页");
      const editPageWait = await this.waitForPageState(
        taskId,
        detector,
        "edit_page_detected",
        "等待上传中状态结束并出现发布参数编辑控件",
        (nextDetection) => !nextDetection.capabilities.hasUploadProgress && nextDetection.capabilities.hasEditableContent,
        {
          timeoutMs: input.timeoutMs || 300000
        }
      );
      if (!editPageWait.ok) {
        detection = editPageWait.detection || (await detector.detectPage().catch(() => detection));
        const code = detection.capabilities.hasUploadProgress ? "UPLOAD_TIMEOUT" : "EDIT_PAGE_NOT_READY";
        return this.fail(
          taskId,
          profile.id,
          code,
          code === "UPLOAD_TIMEOUT" ? "视频仍在上传或处理中，尚未进入发布参数编辑页。" : "上传后没有检测到发布参数编辑控件。",
          "edit_page_detected",
          editPageWait
        );
      }

      detection = editPageWait.detection;
      if (detection.capabilities.hasUploadProgress) {
        return this.fail(taskId, profile.id, "UPLOAD_TIMEOUT", "视频仍在上传或处理中，尚未进入发布参数编辑页。", "edit_page_detected", {
          detection
        });
      }
      if (!detection.capabilities.hasEditableContent) {
        return this.fail(taskId, profile.id, "EDIT_PAGE_NOT_READY", "上传后没有检测到发布参数编辑控件。", "edit_page_detected", {
          detection
        });
      }

      this.repositories.uploadTaskRepository.updateStatus(taskId, "editing");
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
      const uploadCompleteWait = await this.waitForPageState(
        taskId,
        detector,
        "upload_complete_detected",
        "等待上传完成或发布按钮可用",
        (nextDetection) =>
          !nextDetection.capabilities.hasUploadProgress &&
          (nextDetection.capabilities.hasUploadComplete || nextDetection.capabilities.hasPublishButton || nextDetection.capabilities.hasEditableContent),
        {
          timeoutMs: input.timeoutMs || 300000
        }
      );
      if (!uploadCompleteWait.ok) {
        const lastDetection = uploadCompleteWait.detection || (await detector.detectPage().catch(() => detection));
        return this.fail(
          taskId,
          profile.id,
          lastDetection.capabilities.hasUploadProgress ? "UPLOAD_TIMEOUT" : "EDIT_PAGE_NOT_READY",
          lastDetection.capabilities.hasUploadProgress ? "视频仍在上传或处理中，尚未进入发布确认状态。" : "没有检测到上传完成或发布按钮。",
          "upload_complete_detected",
          uploadCompleteWait
        );
      }

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
      const detector = new KuaishouPageDetector(driver, profile);
      const binding = new KuaishouPageBinding(driver, profile, () => detector.detectPage());
      const publishButton = await binding.publishButton();
      const count = await publishButton.count();
      if (count === 0) {
        return this.fail(taskId, profile.id, "PUBLISH_BUTTON_NOT_FOUND", "没有找到发布按钮", "publish_clicked");
      }
      const beforePublishUrl = await driver.currentUrl();
      await publishButton.click();
      this.log(taskId, "info", "publish_clicked", "已点击发布按钮");
      const publishResponse = await this.waitForPageState(
        taskId,
        detector,
        "publish_response_detected",
        "等待发布提交后页面离开当前编辑态",
        (detection) =>
          detection.url !== beforePublishUrl ||
          (!detection.capabilities.hasPublishButton && !detection.capabilities.hasEditableContent) ||
          detection.pageType === "published",
        {
          timeoutMs: 30000
        }
      );
      const publishDetection = publishResponse.ok ? publishResponse.detection : publishResponse.detection;
      if (!publishResponse.ok) {
        this.log(taskId, "warn", "publish_response_wait_timeout", "发布按钮已点击，但页面没有在等待时间内离开编辑态；仍按已点击发布处理", {
          beforePublishUrl,
          lastDetection: publishResponse.detection,
          history: publishResponse.history
        });
      }
      this.repositories.uploadTaskRepository.updateStatus(taskId, "published", {
        currentUrl: publishDetection?.url || (await driver.currentUrl()),
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
    step: string,
    details?: unknown
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
      },
      details
    });
    this.repositories.taskArtifactRepository.add(taskId, "error_report", errorReport);
    this.repositories.uploadTaskRepository.updateStatus(taskId, "failed", {
      currentUrl,
      errorCode: code,
      errorMessage: message
    });
    this.log(taskId, "error", "task_failed", message, { code, step, screenshot, domSnapshot, errorReport, details });
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

    const initialBlock = await this.newVideoBlockingResult(taskId, elementProfileId, current, draftPolicy, "initial_state_checked");
    if (initialBlock) return { result: initialBlock };

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
      const waited = await this.waitForPageState(
        taskId,
        detector,
        "upload_page_opened",
        "等待发布页从 loading 状态进入真实上传入口状态",
        (nextDetection) => this.isKnownUploadSurface(nextDetection),
        {
          timeoutMs: 60000
        }
      );
      if (!waited.ok) {
        return {
          result: await this.fail(
            taskId,
            elementProfileId,
            "UPLOAD_INTAKE_NOT_FOUND",
            "打开发布作品页后，页面仍未出现登录、草稿、上传入口、文件选择或编辑状态。",
            "upload_page_opened",
            waited
          )
        };
      }
      current = waited.detection;
      this.log(taskId, "info", "upload_page_open_done", "新视频上传入口已打开", {
        pageType: current.pageType,
        currentUrl: current.url,
        capabilities: current.capabilities
      });
    }

    const openedBlock = await this.newVideoBlockingResult(taskId, elementProfileId, current, draftPolicy, "upload_page_opened");
    if (openedBlock) return { result: openedBlock };

    if (!current.capabilities.hasFileInput && current.capabilities.hasUploadEntryButton) {
      this.log(taskId, "info", "upload_entry_click_started", "点击上传入口按钮");
      const uploadEntryButton = await binding.uploadEntryButton();
      await uploadEntryButton.click();
      const waited = await this.waitForPageState(
        taskId,
        detector,
        "upload_entry_clicked",
        "等待上传入口点击后出现文件选择或进入后续状态",
        (nextDetection) =>
          nextDetection.capabilities.loginRequired ||
          nextDetection.capabilities.hasDraftContinueButton ||
          nextDetection.capabilities.hasFileInput ||
          nextDetection.capabilities.hasEditableContent ||
          nextDetection.capabilities.hasUploadProgress,
        {
          timeoutMs: 60000
        }
      );
      if (!waited.ok) {
        return {
          result: await this.fail(
            taskId,
            elementProfileId,
            "UPLOAD_INTAKE_NOT_FOUND",
            "点击上传入口后，没有检测到视频文件选择入口或后续页面状态。",
            "upload_entry_clicked",
            waited
          )
        };
      }
      current = waited.detection;
      this.log(taskId, "info", "upload_entry_click_done", "上传入口按钮点击完成", {
        pageType: current.pageType,
        currentUrl: current.url,
        capabilities: current.capabilities
      });
    }

    const clickedBlock = await this.newVideoBlockingResult(taskId, elementProfileId, current, draftPolicy, "upload_entry_clicked");
    if (clickedBlock) return { result: clickedBlock };

    if (!current.capabilities.hasFileInput) {
      return {
        result: await this.fail(
          taskId,
          elementProfileId,
          "UPLOAD_INTAKE_NOT_FOUND",
          "没有找到新视频上传文件选择入口。",
          "file_input_located",
          {
            detection: current
          }
        )
      };
    }

    return { detection: current };
  }

  private async newVideoBlockingResult(
    taskId: string,
    elementProfileId: string,
    detection: KuaishouPageDetection,
    draftPolicy: KuaishouDraftPolicy,
    step: string
  ): Promise<KuaishouUploadTaskResult | null> {
    if (detection.capabilities.loginRequired) {
      return this.waitForLoginResult(taskId, detection);
    }

    if (detection.capabilities.hasDraftContinueButton && draftPolicy !== "continue") {
      return this.manualAction(
        taskId,
        elementProfileId,
        "DRAFT_CONFLICT",
        "检测到未发布草稿。批量上传新视频已暂停，请在左侧页面处理草稿后重试。",
        "draft_conflict_detected",
        detection
      );
    }

    if (detection.capabilities.hasEditableContent && draftPolicy !== "continue") {
      return this.manualAction(
        taskId,
        elementProfileId,
        "DRAFT_CONFLICT",
        "当前页面已有可编辑视频内容。批量上传新视频不会覆盖当前草稿，请先人工处理后重试。",
        "editable_draft_detected",
        detection
      );
    }

    if (detection.capabilities.hasUploadProgress && draftPolicy !== "continue") {
      return this.manualAction(
        taskId,
        elementProfileId,
        "DRAFT_CONFLICT",
        "当前页面已有上传中的视频。批量上传新视频已暂停，请等待或在左侧页面处理后重试。",
        step,
        detection
      );
    }

    return null;
  }

  private async waitForLoginResult(taskId: string, detection: KuaishouPageDetection): Promise<KuaishouUploadTaskResult> {
    this.repositories.uploadTaskRepository.updateStatus(taskId, "waiting_login", {
      currentUrl: detection.url,
      pageType: detection.pageType
    });
    this.log(taskId, "warn", "login_checked", "需要先在左侧浏览器手动登录", {
      pageType: detection.pageType,
      currentUrl: detection.url,
      capabilities: detection.capabilities
    });
    return this.result(taskId);
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
    const waited = await this.waitForPageState(
      taskId,
      detector,
      "draft_continue_clicked",
      "等待草稿继续后进入可识别页面状态",
      (nextDetection) =>
        !nextDetection.capabilities.hasDraftContinueButton &&
        (nextDetection.capabilities.loginRequired ||
          nextDetection.capabilities.hasUploadEntryButton ||
          nextDetection.capabilities.hasFileInput ||
          nextDetection.capabilities.hasEditableContent ||
          nextDetection.capabilities.hasUploadProgress ||
          nextDetection.capabilities.hasUploadComplete),
      {
        timeoutMs: 60000
      }
    );
    return waited.ok ? waited.detection : waited.detection || detector.detectPage();
  }

  private async waitForUploadResponse(
    taskId: string,
    detector: KuaishouPageDetector,
    beforeAttachUrl: string,
    timeoutMs: number
  ): Promise<PageStateWaitResult> {
    const waited = await this.waitForPageState(
      taskId,
      detector,
      "video_file_attach_response",
      "等待页面响应视频文件设置",
      (detection) =>
        detection.url !== beforeAttachUrl ||
        detection.capabilities.hasUploadProgress ||
        detection.capabilities.hasEditableContent ||
        detection.capabilities.hasUploadComplete ||
        detection.capabilities.hasPublishButton,
      {
        timeoutMs: Math.min(timeoutMs, 15000),
        settleMs: 300
      }
    );

    if (waited.ok) {
      return waited;
    }

    return waited;
  }

  private async waitForPageState(
    taskId: string,
    detector: KuaishouPageDetector,
    step: string,
    message: string,
    predicate: (detection: KuaishouPageDetection) => boolean,
    options: {
      timeoutMs: number;
      intervalMs?: number;
      settleMs?: number;
    }
  ): Promise<PageStateWaitResult> {
    const startedAt = Date.now();
    const intervalMs = options.intervalMs ?? 750;
    const settleMs = options.settleMs ?? 300;
    const history: PageStateSummary[] = [];
    let lastDetection: KuaishouPageDetection | undefined;
    let lastError = "";

    this.log(taskId, "info", `${step}_wait_started`, message, {
      timeoutMs: options.timeoutMs,
      intervalMs,
      settleMs
    });

    while (Date.now() - startedAt < options.timeoutMs) {
      const elapsedMs = Date.now() - startedAt;

      try {
        const detection = await detector.detectPage();
        lastDetection = detection;
        const summary = this.pageStateSummary(detection, elapsedMs);
        history.push(summary);
        this.log(taskId, "info", "page_state_poll", `状态轮询：${message}`, {
          step,
          ...summary
        });

        if (predicate(detection)) {
          if (settleMs > 0) {
            await this.sleep(settleMs);
          }
          const settledDetection = await detector.detectPage().catch(() => detection);
          const settledSummary = this.pageStateSummary(settledDetection, Date.now() - startedAt);
          history.push(settledSummary);
          this.log(taskId, "info", `${step}_wait_done`, "页面状态已命中", {
            step,
            settledAfterMs: Date.now() - startedAt,
            detection: settledDetection,
            history: this.tailHistory(history)
          });
          return {
            ok: true,
            detection: settledDetection,
            history: this.tailHistory(history)
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.log(taskId, "warn", "page_state_poll_failed", "页面状态轮询失败，将继续等待", {
          step,
          elapsedMs,
          error: lastError
        });
      }

      await this.sleep(intervalMs);
    }

    this.log(taskId, "warn", `${step}_wait_timeout`, "等待页面状态变化超时", {
      step,
      timeoutMs: options.timeoutMs,
      lastDetection,
      lastError,
      history: this.tailHistory(history)
    });

    return {
      ok: false,
      detection: lastDetection,
      history: this.tailHistory(history),
      lastError
    };
  }

  private isKnownUploadSurface(detection: KuaishouPageDetection): boolean {
    const capabilities = detection.capabilities;
    return Boolean(
      capabilities.loginRequired ||
        capabilities.hasDraftContinueButton ||
        capabilities.hasUploadEntryButton ||
        capabilities.hasFileInput ||
        capabilities.hasEditableContent ||
        capabilities.hasUploadProgress
    );
  }

  private pageStateSummary(detection: KuaishouPageDetection, elapsedMs: number): PageStateSummary {
    const capabilities = detection.capabilities;
    return {
      elapsedMs,
      pageType: detection.pageType,
      url: detection.url,
      capabilities: {
        loginRequired: capabilities.loginRequired,
        hasDraftContinueButton: capabilities.hasDraftContinueButton,
        hasUploadEntryButton: capabilities.hasUploadEntryButton,
        hasFileInput: capabilities.hasFileInput,
        hasUploadProgress: capabilities.hasUploadProgress,
        hasEditableContent: capabilities.hasEditableContent,
        hasUploadComplete: capabilities.hasUploadComplete,
        hasPublishButton: capabilities.hasPublishButton
      }
    };
  }

  private tailHistory(history: PageStateSummary[]): PageStateSummary[] {
    return history.slice(-20);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
