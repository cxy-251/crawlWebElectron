import type { BrowserWorkspace } from "../../browser/BrowserWorkspace";
import { RpaDriver } from "../../rpa/RpaDriver";
import type { ElementProfileRepository } from "../../storage/repositories/ElementProfileRepository";
import type { TaskArtifactRepository } from "../../storage/repositories/TaskArtifactRepository";
import type { TaskLogRepository } from "../../storage/repositories/TaskLogRepository";
import type { UploadTaskRepository } from "../../storage/repositories/UploadTaskRepository";
import type {
  KuaishouDiagnosticEvidence,
  ElementTestResult,
  KuaishouDomDiagnostic,
  KuaishouFormState,
  KuaishouElementKey,
  KuaishouOptionField,
  KuaishouOptionsResult,
  KuaishouPageDetection,
  KuaishouPageSnapshot,
  KuaishouUploadTaskInput,
  KuaishouUploadTaskResult
} from "../types";
import { KuaishouPageBinding } from "./KuaishouPageBinding";
import { KuaishouPageDetector } from "./KuaishouPageDetector";
import { KuaishouUploadService } from "./KuaishouUploadService";

const KUAISHOU_HOME = "https://cp.kuaishou.com";

export class KuaishouUploadAdapter {
  constructor(
    private readonly browserWorkspace: BrowserWorkspace,
    private readonly repositories: {
      elementProfileRepository: ElementProfileRepository;
      uploadTaskRepository: UploadTaskRepository;
      taskLogRepository: TaskLogRepository;
      taskArtifactRepository: TaskArtifactRepository;
    }
  ) {}

  async openHome(): Promise<void> {
    await this.ensureKuaishouProfile();
    await this.browserWorkspace.navigation.goto(KUAISHOU_HOME);
  }

  async openUploadPage(): Promise<void> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const firstUrl = profile.uploadUrlCandidates[0] || KUAISHOU_HOME;
    await this.browserWorkspace.navigation.goto(firstUrl);
  }

  async prepareForNextUploadTask(): Promise<KuaishouPageDetection> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const detector = new KuaishouPageDetector(driver, profile);
    await this.openUploadPage();
    return this.waitForPageState(detector, "next_upload_page_opened", (detection) => this.isKnownUploadSurface(detection));
  }

  async continueEditingOrStartNewUpload(): Promise<KuaishouPageDetection> {
    await this.ensureKuaishouProfile();
    console.info("[kuaishou:continue] detect start");
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const detector = new KuaishouPageDetector(driver, profile);
    const binding = new KuaishouPageBinding(driver, profile, () => detector.detectPage());
    let detection = await detector.detectPage();

    console.info("[kuaishou:continue] capabilities", detection.capabilities);

    try {
      if (detection.capabilities.loginRequired) {
        console.info("[kuaishou:continue] action login_required", {
          pageType: detection.pageType,
          url: detection.url
        });
        console.info("[kuaishou:continue] done", {
          pageType: detection.pageType,
          url: detection.url
        });
        return detection;
      }

      if (detection.capabilities.hasDraftContinueButton) {
        console.info("[kuaishou:continue] action continue_draft", {
          pageType: detection.pageType,
          url: detection.url
        });
        const draftContinueButton = await binding.draftContinueButton();
        await draftContinueButton.click();
        detection = await this.waitForPageState(
          detector,
          "draft_continue_clicked",
          (nextDetection) =>
            !nextDetection.capabilities.hasDraftContinueButton &&
            (nextDetection.capabilities.loginRequired ||
              nextDetection.capabilities.hasUploadEntryButton ||
              nextDetection.capabilities.hasFileInput ||
              nextDetection.capabilities.hasEditableContent ||
              nextDetection.capabilities.hasUploadProgress ||
              nextDetection.capabilities.hasUploadComplete)
        );
        if (detection.capabilities.hasEditableContent) {
          await binding.readPageState();
        }
        console.info("[kuaishou:continue] done", {
          pageType: detection.pageType,
          url: detection.url
        });
        return detection;
      }

      if (detection.capabilities.hasEditableContent) {
        console.info("[kuaishou:continue] action continue_edit", {
          pageType: detection.pageType,
          url: detection.url
        });
        await binding.readPageState();
        detection = await detector.detectPage();
        console.info("[kuaishou:continue] done", {
          pageType: detection.pageType,
          url: detection.url
        });
        return detection;
      }

      if (detection.capabilities.hasFileInput) {
        console.info("[kuaishou:continue] action use_current_file_input", {
          pageType: detection.pageType,
          url: detection.url
        });
        console.info("[kuaishou:continue] done", {
          pageType: detection.pageType,
          url: detection.url
        });
        return detection;
      }

      if (detection.capabilities.hasUploadEntryButton) {
        console.info("[kuaishou:continue] action click_upload_entry", {
          pageType: detection.pageType,
          url: detection.url
        });
        const uploadEntryButton = await binding.uploadEntryButton();
        await uploadEntryButton.click();
        detection = await this.waitForPageState(
          detector,
          "upload_entry_clicked",
          (nextDetection) =>
            nextDetection.capabilities.loginRequired ||
            nextDetection.capabilities.hasDraftContinueButton ||
            nextDetection.capabilities.hasFileInput ||
            nextDetection.capabilities.hasEditableContent ||
            nextDetection.capabilities.hasUploadProgress
        );

        if (!detection.capabilities.hasEditableContent && !detection.capabilities.hasFileInput) {
          console.info("[kuaishou:continue] action fallback_open_upload_page", {
            pageType: detection.pageType,
            url: detection.url
          });
          await this.openUploadPage();
          detection = await this.waitForPageState(detector, "fallback_upload_page_opened", (nextDetection) =>
            this.isKnownUploadSurface(nextDetection)
          );
        }

        console.info("[kuaishou:continue] done", {
          pageType: detection.pageType,
          url: detection.url
        });
        return detection;
      }

      console.info("[kuaishou:continue] action open_upload_page", {
        pageType: detection.pageType,
        url: detection.url
      });
      await this.openUploadPage();
      detection = await this.waitForPageState(detector, "upload_page_opened", (nextDetection) => this.isKnownUploadSurface(nextDetection));
      console.info("[kuaishou:continue] done", {
        pageType: detection.pageType,
        url: detection.url
      });
      return detection;
    } catch (error) {
      console.error("[kuaishou:continue] failed", {
        pageType: detection.pageType,
        url: detection.url,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async detectPage(): Promise<KuaishouPageDetection> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    return new KuaishouPageDetector(driver, profile).detectPage();
  }

  async diagnoseDom(): Promise<KuaishouDomDiagnostic> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const detection = await new KuaishouPageDetector(driver, profile).detectPage();
    const keys = Object.keys(profile.elements) as KuaishouElementKey[];
    const elementResults: ElementTestResult[] = [];

    for (const key of keys) {
      const resolution = await driver.test(profile.elements[key] || []);
      elementResults.push({
        ok: resolution.matchedCount > 0,
        locatorKey: key,
        matchedCount: resolution.matchedCount,
        attempts: resolution.attempts
      });
    }

    return {
      platform: "kuaishou",
      profile: {
        id: profile.id,
        name: profile.name,
        version: profile.version,
        updatedAt: profile.updatedAt
      },
      detection,
      elementResults,
      matchedCount: elementResults.filter((result) => result.ok).length,
      missingCount: elementResults.filter((result) => !result.ok).length,
      checkedAt: Date.now()
    };
  }

  async captureDiagnosticEvidence(): Promise<KuaishouDiagnosticEvidence> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const detection = await new KuaishouPageDetector(driver, profile).detectPage();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const [screenshotPath, domSnapshotPath] = await Promise.all([
      driver.screenshot(`kuaishou-diagnostic-${stamp}.png`),
      driver.domSnapshot(`kuaishou-diagnostic-${stamp}.html`)
    ]);

    return {
      platform: "kuaishou",
      detection,
      screenshotPath,
      domSnapshotPath,
      capturedAt: Date.now()
    };
  }

  async readPageState(): Promise<KuaishouPageSnapshot> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
    return binding.readPageState();
  }

  async readOptions(field: KuaishouOptionField, query = ""): Promise<KuaishouOptionsResult> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
    return binding.readOptions(field, query);
  }

  async applyFormState(state: KuaishouFormState): Promise<KuaishouPageSnapshot> {
    await this.ensureKuaishouProfile();
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
    return binding.applyFormState(state);
  }

  async uploadSingleVideo(input: KuaishouUploadTaskInput): Promise<KuaishouUploadTaskResult> {
    await this.ensureKuaishouProfile();
    return this.service().uploadSingleVideo(input);
  }

  async confirmPublish(taskId: string): Promise<KuaishouUploadTaskResult> {
    await this.ensureKuaishouProfile();
    return this.service().confirmPublish(taskId);
  }

  async cancelTask(taskId: string): Promise<KuaishouUploadTaskResult> {
    return this.service().cancelTask(taskId);
  }

  getTask(taskId: string): KuaishouUploadTaskResult | null {
    const task = this.repositories.uploadTaskRepository.get(taskId);
    return task
      ? {
          ...task,
          artifacts: this.repositories.taskArtifactRepository.list(taskId)
        }
      : null;
  }

  private service(): KuaishouUploadService {
    return new KuaishouUploadService(this.browserWorkspace, this.repositories, () => this.openUploadPage());
  }

  private async ensureKuaishouProfile(): Promise<void> {
    await this.browserWorkspace.useProfile("kuaishou");
  }

  private async waitForPageState(
    detector: KuaishouPageDetector,
    label: string,
    predicate: (detection: KuaishouPageDetection) => boolean,
    options: { timeoutMs?: number; intervalMs?: number; settleMs?: number } = {}
  ): Promise<KuaishouPageDetection> {
    const timeoutMs = options.timeoutMs ?? 60000;
    const intervalMs = options.intervalMs ?? 750;
    const settleMs = options.settleMs ?? 300;
    const startedAt = Date.now();
    let lastDetection: KuaishouPageDetection | undefined;
    let lastError = "";

    console.info("[kuaishou:continue] wait start", {
      label,
      timeoutMs,
      intervalMs,
      settleMs
    });

    while (Date.now() - startedAt < timeoutMs) {
      const elapsedMs = Date.now() - startedAt;
      try {
        const detection = await detector.detectPage();
        lastDetection = detection;
        console.info("[kuaishou:continue] wait poll", {
          label,
          elapsedMs,
          pageType: detection.pageType,
          url: detection.url,
          capabilities: this.keyCapabilities(detection)
        });

        if (predicate(detection)) {
          if (settleMs > 0) {
            await this.sleep(settleMs);
          }
          const settledDetection = await detector.detectPage().catch(() => detection);
          console.info("[kuaishou:continue] wait done", {
            label,
            elapsedMs: Date.now() - startedAt,
            pageType: settledDetection.pageType,
            url: settledDetection.url,
            capabilities: this.keyCapabilities(settledDetection)
          });
          return settledDetection;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.warn("[kuaishou:continue] wait poll failed", {
          label,
          elapsedMs,
          error: lastError
        });
      }

      await this.sleep(intervalMs);
    }

    console.warn("[kuaishou:continue] wait timeout", {
      label,
      timeoutMs,
      lastError,
      lastDetection: lastDetection
        ? {
            pageType: lastDetection.pageType,
            url: lastDetection.url,
            capabilities: this.keyCapabilities(lastDetection)
          }
        : undefined
    });
    return lastDetection || detector.detectPage();
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

  private keyCapabilities(detection: KuaishouPageDetection) {
    const capabilities = detection.capabilities;
    return {
      loginRequired: capabilities.loginRequired,
      hasDraftContinueButton: capabilities.hasDraftContinueButton,
      hasUploadEntryButton: capabilities.hasUploadEntryButton,
      hasFileInput: capabilities.hasFileInput,
      hasUploadProgress: capabilities.hasUploadProgress,
      hasEditableContent: capabilities.hasEditableContent,
      hasUploadComplete: capabilities.hasUploadComplete,
      hasPublishButton: capabilities.hasPublishButton
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
