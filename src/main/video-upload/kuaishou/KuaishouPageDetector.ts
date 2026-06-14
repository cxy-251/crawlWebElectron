import type { LocatorResolution } from "../../rpa/LocatorEngine";
import type { RpaDriver } from "../../rpa/RpaDriver";
import type {
  KuaishouElementKey,
  KuaishouElementProfile,
  KuaishouPageCapabilities,
  KuaishouPageDetection,
  KuaishouPageType
} from "../types";
import { kuaishouInspectPageScript } from "./KuaishouPageDom";

const HINT_KEYS: KuaishouElementKey[] = [
  "loginRequiredHints",
  "draftContinueButton",
  "uploadEntryButton",
  "fileInput",
  "captionEditor",
  "coverButton",
  "pkCoverSwitch",
  "chapterButton",
  "authorServiceSelect",
  "benefitSelect",
  "hotspotInput",
  "authorStatementInput",
  "collectionSelect",
  "locationRegionSelect",
  "locationAddressInput",
  "allowSameFrameCheckbox",
  "allowDownloadCheckbox",
  "showNearbyCheckbox",
  "visibilityPublicRadio",
  "visibilityFriendsRadio",
  "visibilityPrivateRadio",
  "publishTimeToggle",
  "publishTimeInput",
  "publishNowRadio",
  "scheduledPublishRadio",
  "bestTimeButton",
  "uploadProgressHints",
  "uploadCompleteHints",
  "publishButton",
  "errorToast"
];

export class KuaishouPageDetector {
  constructor(
    private readonly driver: RpaDriver,
    private readonly profile: KuaishouElementProfile
  ) {}

  async detectPage(): Promise<KuaishouPageDetection> {
    const [url, title] = await Promise.all([this.driver.currentUrl(), this.driver.title()]);
    const resolutions = new Map<KuaishouElementKey, LocatorResolution>();
    const domInspection = await this.driver.evaluate<{
      capabilities: KuaishouPageCapabilities;
      matchedKeys: string[];
    }>(kuaishouInspectPageScript());

    for (const key of HINT_KEYS) {
      resolutions.set(key, await this.driver.test(this.profile.elements[key] || []));
    }

    const capabilities = this.capabilities(url, resolutions, domInspection.capabilities);
    const pageType = this.detectType(url, capabilities);

    return {
      platform: "kuaishou",
      pageType,
      url,
      title,
      confidence: this.confidence(pageType, capabilities, this.matchedHintCount(resolutions)),
      capabilities,
      matchedHints: [
        ...this.matchedHints(resolutions),
        ...domInspection.matchedKeys.map((key) => ({
          key: `dom:${key}`,
          matchedCount: 1
        }))
      ]
    };
  }

  private capabilities(
    url: string,
    resolutions: Map<KuaishouElementKey, LocatorResolution>,
    domCapabilities: KuaishouPageCapabilities
  ): KuaishouPageCapabilities {
    const hasDraftContinueButton = domCapabilities.hasDraftContinueButton || this.hasMatch(resolutions, "draftContinueButton");
    const hasCaptionEditor = this.hasMatch(resolutions, "captionEditor");
    const hasPublishTimeInput = this.hasMatch(resolutions, "publishTimeInput");
    const hasFileInput = this.hasMatch(resolutions, "fileInput");
    const hasUploadEntryButton = this.hasMatch(resolutions, "uploadEntryButton");
    const hasPublishButton = domCapabilities.hasPublishButton;
    const hasErrorToast = this.hasMatch(resolutions, "errorToast");
    const hasCoverSettings = this.hasMatch(resolutions, "coverButton");
    const hasCollectionSelect = this.hasMatch(resolutions, "collectionSelect");
    const hasInteractionSettings =
      this.hasMatch(resolutions, "allowSameFrameCheckbox") ||
      this.hasMatch(resolutions, "allowDownloadCheckbox") ||
      this.hasMatch(resolutions, "showNearbyCheckbox");
    const hasVisibilitySettings =
      this.hasMatch(resolutions, "visibilityPublicRadio") ||
      this.hasMatch(resolutions, "visibilityFriendsRadio") ||
      this.hasMatch(resolutions, "visibilityPrivateRadio");
    const hasPublishTimingSettings = this.hasMatch(resolutions, "publishNowRadio") || this.hasMatch(resolutions, "scheduledPublishRadio");
    const hasUploadProgress = domCapabilities.hasUploadProgress || (this.isPublishContext(url) && this.hasMatch(resolutions, "uploadProgressHints"));
    const hasUploadComplete =
      domCapabilities.hasUploadComplete ||
      ((domCapabilities.hasCaptionEditor || domCapabilities.hasPublishButton || hasUploadProgress) && this.hasMatch(resolutions, "uploadCompleteHints"));
    const hasEditableContent =
      hasCaptionEditor ||
      hasPublishTimeInput ||
      hasPublishButton ||
      hasCollectionSelect ||
      hasInteractionSettings ||
      hasVisibilitySettings ||
      hasPublishTimingSettings ||
      hasCoverSettings;
    const hasWorkflowHint = hasEditableContent || hasFileInput || hasUploadEntryButton || hasUploadProgress || hasUploadComplete;
    const hasLoginHint = this.hasMatch(resolutions, "loginRequiredHints");
    const loginRequired = /login|passport/i.test(url) || (hasLoginHint && !hasWorkflowHint);

    return this.mergeCapabilities(domCapabilities, {
      hasEditableContent,
      hasDraftContinueButton,
      hasCaptionEditor,
      hasPublishTimeInput,
      hasFileInput,
      hasUploadEntryButton,
      hasCoverSettings,
      hasPkCoverSwitch: this.hasMatch(resolutions, "pkCoverSwitch"),
      hasChapterButton: this.hasMatch(resolutions, "chapterButton"),
      hasAuthorServiceSelect: this.hasMatch(resolutions, "authorServiceSelect"),
      hasBenefitSelect: this.hasMatch(resolutions, "benefitSelect"),
      hasHotspotInput: this.hasMatch(resolutions, "hotspotInput"),
      hasAuthorStatementInput: this.hasMatch(resolutions, "authorStatementInput"),
      hasCollectionSelect,
      hasLocationRegionSelect: this.hasMatch(resolutions, "locationRegionSelect"),
      hasLocationAddressInput: this.hasMatch(resolutions, "locationAddressInput"),
      hasInteractionSettings,
      hasVisibilitySettings,
      hasPublishTimingSettings,
      hasUploadProgress,
      hasUploadComplete,
      hasPublishButton,
      hasErrorToast,
      loginRequired
    });
  }

  private detectType(url: string, capabilities: KuaishouPageCapabilities): KuaishouPageType {
    const lowerUrl = url.toLowerCase();

    if (capabilities.hasErrorToast) return "error";
    if (capabilities.loginRequired) return "login";
    if (capabilities.hasUploadProgress) return "uploading";
    if (capabilities.hasUploadComplete || capabilities.hasPublishButton) return "waiting_publish";
    if (capabilities.hasEditableContent) return "upload_edit";
    if (
      capabilities.hasDraftContinueButton ||
      capabilities.hasFileInput ||
      (capabilities.hasUploadEntryButton && this.isPublishContext(url))
    ) {
      return "upload_entry";
    }
    if (lowerUrl.includes("cp.kuaishou.com")) return "creator_home";
    return "unknown";
  }

  private confidence(pageType: KuaishouPageType, capabilities: KuaishouPageCapabilities, matchedCount: number): number {
    if (pageType === "unknown") return matchedCount > 0 ? 0.45 : 0.2;
    if (capabilities.hasEditableContent || capabilities.hasUploadEntryButton || capabilities.loginRequired) {
      return Math.min(0.95, 0.65 + matchedCount * 0.05);
    }
    return Math.min(0.8, 0.5 + matchedCount * 0.05);
  }

  private hasMatch(resolutions: Map<KuaishouElementKey, LocatorResolution>, key: KuaishouElementKey): boolean {
    return (resolutions.get(key)?.matchedCount || 0) > 0;
  }

  private isPublishContext(url: string): boolean {
    return /\/article\/publish|\/publish\/video|\/creator\/publish|\/upload/i.test(url);
  }

  private mergeCapabilities(base: KuaishouPageCapabilities, patch: KuaishouPageCapabilities): KuaishouPageCapabilities {
    const merged = { ...base };
    for (const key of Object.keys(patch) as Array<keyof KuaishouPageCapabilities>) {
      merged[key] = Boolean(base[key] || patch[key]);
    }
    merged.hasEditableContent =
      merged.hasCaptionEditor ||
      merged.hasPublishTimeInput ||
      merged.hasPublishButton ||
      merged.hasCollectionSelect ||
      merged.hasInteractionSettings ||
      merged.hasVisibilitySettings ||
      merged.hasPublishTimingSettings ||
      merged.hasCoverSettings;
    merged.loginRequired = Boolean(base.loginRequired || patch.loginRequired);
    return merged;
  }

  private matchedHintCount(resolutions: Map<KuaishouElementKey, LocatorResolution>): number {
    return Array.from(resolutions.values()).reduce((sum, resolution) => sum + resolution.matchedCount, 0);
  }

  private matchedHints(resolutions: Map<KuaishouElementKey, LocatorResolution>): KuaishouPageDetection["matchedHints"] {
    return Array.from(resolutions.entries()).flatMap(([key, resolution]) =>
      resolution.attempts
        .filter((attempt) => attempt.matchedCount > 0)
        .map((attempt) => ({
          key,
          locator: attempt.locator,
          matchedCount: attempt.matchedCount
        }))
    );
  }
}
