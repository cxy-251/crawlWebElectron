export type LocatorSpec =
  | { type: "css"; value: string; note?: string }
  | { type: "text"; value: string; exact?: boolean; note?: string }
  | { type: "role"; role: string; name?: string; note?: string }
  | { type: "placeholder"; value: string; note?: string }
  | { type: "nearText"; text: string; target: "input" | "textarea" | "button" | "contenteditable"; note?: string }
  | { type: "contentEditable"; nearText?: string; note?: string };

export type KuaishouPageType =
  | "unknown"
  | "login"
  | "creator_home"
  | "upload_entry"
  | "upload_edit"
  | "uploading"
  | "waiting_publish"
  | "published"
  | "error";

export type KuaishouElementKey =
  | "loginRequiredHints"
  | "draftContinueButton"
  | "uploadEntryButton"
  | "fileInput"
  | "captionEditor"
  | "coverButton"
  | "coverFileInput"
  | "pkCoverSwitch"
  | "chapterButton"
  | "authorServiceSelect"
  | "benefitSelect"
  | "hotspotInput"
  | "authorStatementInput"
  | "collectionSelect"
  | "locationRegionSelect"
  | "locationAddressInput"
  | "allowSameFrameCheckbox"
  | "allowDownloadCheckbox"
  | "showNearbyCheckbox"
  | "visibilityPublicRadio"
  | "visibilityFriendsRadio"
  | "visibilityPrivateRadio"
  | "publishTimeToggle"
  | "publishTimeInput"
  | "publishNowRadio"
  | "scheduledPublishRadio"
  | "bestTimeButton"
  | "uploadProgressHints"
  | "uploadCompleteHints"
  | "publishButton"
  | "errorToast";

export type KuaishouElementProfile = {
  id: string;
  platform: "kuaishou";
  name: string;
  version: number;
  uploadUrlCandidates: string[];
  elements: Record<KuaishouElementKey, LocatorSpec[]>;
  createdAt: number;
  updatedAt: number;
};

export type KuaishouPageCapabilities = {
  hasEditableContent: boolean;
  hasDraftContinueButton: boolean;
  hasCaptionEditor: boolean;
  hasPublishTimeInput: boolean;
  hasFileInput: boolean;
  hasUploadEntryButton: boolean;
  hasCoverSettings: boolean;
  hasPkCoverSwitch: boolean;
  hasChapterButton: boolean;
  hasAuthorServiceSelect: boolean;
  hasBenefitSelect: boolean;
  hasHotspotInput: boolean;
  hasAuthorStatementInput: boolean;
  hasCollectionSelect: boolean;
  hasLocationRegionSelect: boolean;
  hasLocationAddressInput: boolean;
  hasInteractionSettings: boolean;
  hasVisibilitySettings: boolean;
  hasPublishTimingSettings: boolean;
  hasUploadProgress: boolean;
  hasUploadComplete: boolean;
  hasPublishButton: boolean;
  hasErrorToast: boolean;
  loginRequired: boolean;
};

export type KuaishouPageDetection = {
  platform: "kuaishou";
  pageType: KuaishouPageType;
  url: string;
  title: string;
  confidence: number;
  capabilities: KuaishouPageCapabilities;
  matchedHints: Array<{
    key: string;
    matchedCount: number;
    locator?: LocatorSpec;
  }>;
};

export type KuaishouPageActionErrorCode =
  | "ELEMENT_NOT_FOUND"
  | "PAGE_NOT_EDITABLE"
  | "MANUAL_ACTION_REQUIRED"
  | "OPTION_NOT_FOUND"
  | "OPTION_AMBIGUOUS"
  | "TIME_PICKER_NOT_FOUND"
  | "TIME_WRITE_MISMATCH";

export type KuaishouPageActionErrorDetails = {
  code: KuaishouPageActionErrorCode;
  message: string;
  step: "applyFormState";
  locatorKey?: KuaishouElementKey;
  field?: KuaishouWebEditableField;
  requestedValue?: string;
  currentPageValue?: string;
  candidates?: KuaishouOption[];
  pageType: KuaishouPageType;
  currentUrl: string;
  capabilities: KuaishouPageCapabilities;
  locatorAttempts: unknown[];
};

export type KuaishouVisibility = "public" | "friends" | "private";

export type KuaishouPublishTimingMode = "immediate" | "scheduled";

export type KuaishouPublishMode = "manual_confirm" | "auto_publish";

export type KuaishouUploadIntent = "new_video" | "continue_current" | "current_intake";

export type KuaishouDraftPolicy = "pause" | "continue";

export type KuaishouWebEditableFields = {
  caption: string;
  pkCoverEnabled?: boolean;
  chaptersText?: string;
  authorServiceType?: string;
  linkedBenefit?: string;
  hotspot?: string;
  authorStatement?: string;
  collectionName?: string;
  locationRegion?: string;
  locationAddress?: string;
  allowSameFrame: boolean;
  allowDownload: boolean;
  showInNearby: boolean;
  visibility: KuaishouVisibility;
  publishTimingMode: KuaishouPublishTimingMode;
  scheduledPublishTime?: string;
  useBestTimeSuggestion?: boolean;
};

export type KuaishouWebEditableField = keyof KuaishouWebEditableFields;

export type KuaishouOptionField =
  | "authorServiceType"
  | "linkedBenefit"
  | "hotspot"
  | "authorStatement"
  | "collectionName"
  | "locationRegion"
  | "locationAddress";

export type KuaishouOption = {
  label: string;
  value: string;
  rawText: string;
};

export type KuaishouOptionsResult = {
  field: KuaishouOptionField;
  query: string;
  selectedValue?: string;
  options: KuaishouOption[];
  readAt: number;
};

export type KuaishouLocalTaskField = "videoPath" | "coverPath" | "publishMode";

export type KuaishouFormField = KuaishouLocalTaskField | KuaishouWebEditableField;

export type KuaishouPageSnapshot = {
  platform: "kuaishou";
  pageType: KuaishouPageType;
  url: string;
  fields: Partial<KuaishouWebEditableFields>;
  readAt: number;
};

export type KuaishouFormState = KuaishouWebEditableFields & {
  videoPath: string;
  coverPath?: string;
  publishMode: KuaishouPublishMode;
  dirtyFields: KuaishouFormField[];
  lastUpdatedBy: "ui" | "page" | "task";
  updatedAt: number;
};

export type KuaishouUploadTaskInput = {
  platform: "kuaishou";
  accountId: string;
  videoPath: string;
  caption: string;
  coverPath?: string;
  pkCoverEnabled?: boolean;
  chaptersText?: string;
  authorServiceType?: string;
  linkedBenefit?: string;
  hotspot?: string;
  authorStatement?: string;
  collectionName?: string;
  locationRegion?: string;
  locationAddress?: string;
  allowSameFrame?: boolean;
  allowDownload?: boolean;
  showInNearby?: boolean;
  visibility?: KuaishouVisibility;
  publishTimingMode?: KuaishouPublishTimingMode;
  scheduledPublishTime?: string;
  useBestTimeSuggestion?: boolean;
  publishMode: KuaishouPublishMode;
  elementProfileId?: string;
  timeoutMs?: number;
  dirtyFields?: KuaishouWebEditableField[];
  uploadIntent?: KuaishouUploadIntent;
  draftPolicy?: KuaishouDraftPolicy;
};

export type TaskArtifact = {
  id: string;
  taskId: string;
  type: "screenshot" | "dom_snapshot" | "error_report";
  filePath: string;
  createdAt: number;
};

export type KuaishouUploadTaskResult = {
  ok: boolean;
  taskId: string;
  platform: "kuaishou";
  status:
    | "created"
    | "waiting_login"
    | "opening_upload_page"
    | "uploading"
    | "editing"
    | "waiting_upload_complete"
    | "waiting_publish_confirm"
    | "waiting_manual_action"
    | "published"
    | "failed"
    | "cancelled";
  currentUrl?: string;
  pageType?: KuaishouPageType;
  elementProfileId: string;
  error?: {
    code: string;
    message: string;
    step: string;
  };
  artifacts?: TaskArtifact[];
};

export type ElementTestResult = {
  ok: boolean;
  locatorKey: KuaishouElementKey;
  matchedCount: number;
  attempts: Array<{
    locator: LocatorSpec;
    matchedCount: number;
    error?: string;
  }>;
};

export type TaskLog = {
  id: string;
  taskId: string;
  level: "info" | "warn" | "error";
  step: string;
  message: string;
  dataJson?: string;
  createdAt: number;
};
