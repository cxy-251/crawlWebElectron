import type { RpaDriver } from "../../rpa/RpaDriver";
import type {
  KuaishouElementKey,
  KuaishouElementProfile,
  KuaishouFormState,
  KuaishouOptionField,
  KuaishouOptionsResult,
  KuaishouPageActionErrorCode,
  KuaishouPageActionErrorDetails,
  KuaishouPageDetection,
  KuaishouPageSnapshot,
  KuaishouWebEditableField
} from "../types";
import {
  kuaishouApplyFieldsScript,
  kuaishouInspectPageScript,
  kuaishouReadOptionsScript,
  type KuaishouDomApplyResult,
  type KuaishouDomInspection
} from "./KuaishouPageDom";

const WEB_EDITABLE_FIELDS: KuaishouWebEditableField[] = [
  "caption",
  "pkCoverEnabled",
  "chaptersText",
  "authorServiceType",
  "linkedBenefit",
  "hotspot",
  "authorStatement",
  "collectionName",
  "locationRegion",
  "locationAddress",
  "allowSameFrame",
  "allowDownload",
  "showInNearby",
  "visibility",
  "publishTimingMode",
  "scheduledPublishTime",
  "useBestTimeSuggestion"
];

export class KuaishouPageActionError extends Error {
  constructor(readonly details: KuaishouPageActionErrorDetails) {
    super(details.message);
    this.name = "KuaishouPageActionError";
  }
}

export function isKuaishouPageActionError(error: unknown): error is KuaishouPageActionError {
  return error instanceof KuaishouPageActionError;
}

export class KuaishouPageBinding {
  constructor(
    private readonly driver: RpaDriver,
    private readonly profile: KuaishouElementProfile,
    private readonly detectPage: () => Promise<KuaishouPageDetection>
  ) {}

  async readPageState(): Promise<KuaishouPageSnapshot> {
    const detection = await this.detectPage();
    const inspection = await this.driver.evaluate<KuaishouDomInspection>(kuaishouInspectPageScript());

    return {
      platform: "kuaishou",
      pageType: detection.pageType,
      url: detection.url,
      fields: inspection.fields,
      readAt: Date.now()
    };
  }

  async readOptions(field: KuaishouOptionField, query = ""): Promise<KuaishouOptionsResult> {
    return this.driver.evaluate<KuaishouOptionsResult>(kuaishouReadOptionsScript(field, query));
  }

  async applyFormState(state: KuaishouFormState): Promise<KuaishouPageSnapshot> {
    const detection = await this.detectPage();

    if (!detection.capabilities.hasEditableContent) {
      throw await this.actionError(detection, {
        code: "PAGE_NOT_EDITABLE",
        message: "当前页面不是上传编辑页，请先进入上传编辑页，再写入网页内容。",
        locatorKey: undefined
      });
    }

    const fieldsToApply = state.dirtyFields.filter((field): field is KuaishouWebEditableField =>
      WEB_EDITABLE_FIELDS.includes(field as KuaishouWebEditableField)
    );

    if (fieldsToApply.length === 0) {
      return this.readPageState();
    }

    if (fieldsToApply.includes("caption") && !detection.capabilities.hasCaptionEditor) {
      throw await this.actionError(detection, {
        code: "ELEMENT_NOT_FOUND",
        message: "当前页面没有找到“作品描述”输入框，请先进入上传编辑页，或在高级元素配置里测试 captionEditor。",
        locatorKey: "captionEditor",
        field: "caption"
      });
    }

    const result = await this.driver.evaluate<KuaishouDomApplyResult>(kuaishouApplyFieldsScript(state, fieldsToApply));
    if (!result.ok) {
      const firstError = result.errors[0];
      throw await this.actionError(detection, {
        code: firstError.code,
        message: firstError.message,
        locatorKey: this.locatorKeyForField(firstError.field),
        field: firstError.field,
        requestedValue: firstError.requestedValue,
        currentPageValue: firstError.currentPageValue,
        candidates: firstError.candidates
      });
    }

    return this.readPageState();
  }

  async fileInput() {
    return this.driver.locator(this.profile.elements.fileInput);
  }

  async publishButton() {
    return this.driver.locator(this.profile.elements.publishButton);
  }

  async uploadEntryButton() {
    return this.driver.locator(this.profile.elements.uploadEntryButton);
  }

  async draftContinueButton() {
    return this.driver.locator(this.profile.elements.draftContinueButton);
  }

  async uploadCompleteVisible(): Promise<boolean> {
    const locator = await this.driver.locator(this.profile.elements.uploadCompleteHints);
    return locator.exists();
  }

  async errorText(): Promise<string> {
    const locator = await this.driver.locator(this.profile.elements.errorToast);
    return (await locator.exists()) ? locator.textContent() : "";
  }

  private async actionError(
    detection: KuaishouPageDetection,
    input: {
      code: KuaishouPageActionErrorCode;
      message: string;
      locatorKey?: KuaishouElementKey;
      field?: KuaishouWebEditableField;
      requestedValue?: string;
      currentPageValue?: string;
      candidates?: KuaishouPageActionErrorDetails["candidates"];
    }
  ): Promise<KuaishouPageActionError> {
    const locatorAttempts = input.locatorKey ? (await this.driver.test(this.profile.elements[input.locatorKey])).attempts : [];

    return new KuaishouPageActionError({
      code: input.code,
      message: input.message,
      step: "applyFormState",
      locatorKey: input.locatorKey,
      field: input.field,
      requestedValue: input.requestedValue,
      currentPageValue: input.currentPageValue,
      candidates: input.candidates,
      pageType: detection.pageType,
      currentUrl: detection.url,
      capabilities: detection.capabilities,
      locatorAttempts
    });
  }

  private locatorKeyForField(field: KuaishouWebEditableField): KuaishouElementKey | undefined {
    const map: Partial<Record<KuaishouWebEditableField, KuaishouElementKey>> = {
      caption: "captionEditor",
      pkCoverEnabled: "pkCoverSwitch",
      chaptersText: "chapterButton",
      authorServiceType: "authorServiceSelect",
      linkedBenefit: "benefitSelect",
      hotspot: "hotspotInput",
      authorStatement: "authorStatementInput",
      collectionName: "collectionSelect",
      locationRegion: "locationRegionSelect",
      locationAddress: "locationAddressInput",
      allowSameFrame: "allowSameFrameCheckbox",
      allowDownload: "allowDownloadCheckbox",
      showInNearby: "showNearbyCheckbox",
      visibility: "visibilityPublicRadio",
      publishTimingMode: "publishTimeToggle",
      scheduledPublishTime: "publishTimeInput",
      useBestTimeSuggestion: "bestTimeButton"
    };

    return map[field];
  }
}
