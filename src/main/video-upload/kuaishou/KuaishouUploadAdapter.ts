import type { BrowserWorkspace } from "../../browser/BrowserWorkspace";
import { RpaDriver } from "../../rpa/RpaDriver";
import type { ElementProfileRepository } from "../../storage/repositories/ElementProfileRepository";
import type { TaskArtifactRepository } from "../../storage/repositories/TaskArtifactRepository";
import type { TaskLogRepository } from "../../storage/repositories/TaskLogRepository";
import type { UploadTaskRepository } from "../../storage/repositories/UploadTaskRepository";
import type {
  KuaishouFormState,
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
    await this.browserWorkspace.navigation.goto(KUAISHOU_HOME);
  }

  async openUploadPage(): Promise<void> {
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const firstUrl = profile.uploadUrlCandidates[0] || KUAISHOU_HOME;
    await this.browserWorkspace.navigation.goto(firstUrl);
  }

  async continueEditingOrStartNewUpload(): Promise<KuaishouPageDetection> {
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
        await this.waitForPageSettle();
        detection = await detector.detectPage();
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
        await this.waitForPageSettle();
        detection = await detector.detectPage();

        if (!detection.capabilities.hasEditableContent && !detection.capabilities.hasFileInput) {
          console.info("[kuaishou:continue] action fallback_open_upload_page", {
            pageType: detection.pageType,
            url: detection.url
          });
          await this.openUploadPage();
          await this.waitForPageSettle();
          detection = await detector.detectPage();
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
      await this.waitForPageSettle();
      detection = await detector.detectPage();
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
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    return new KuaishouPageDetector(driver, profile).detectPage();
  }

  async readPageState(): Promise<KuaishouPageSnapshot> {
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
    return binding.readPageState();
  }

  async readOptions(field: KuaishouOptionField, query = ""): Promise<KuaishouOptionsResult> {
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
    return binding.readOptions(field, query);
  }

  async applyFormState(state: KuaishouFormState): Promise<KuaishouPageSnapshot> {
    const profile = this.repositories.elementProfileRepository.getActiveKuaishouProfile();
    const driver = new RpaDriver(this.browserWorkspace.webContents);
    const binding = new KuaishouPageBinding(driver, profile, () => new KuaishouPageDetector(driver, profile).detectPage());
    return binding.applyFormState(state);
  }

  async uploadSingleVideo(input: KuaishouUploadTaskInput): Promise<KuaishouUploadTaskResult> {
    return this.service().uploadSingleVideo(input);
  }

  async confirmPublish(taskId: string): Promise<KuaishouUploadTaskResult> {
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

  private async waitForPageSettle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
