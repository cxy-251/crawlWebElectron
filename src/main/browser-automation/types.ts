export type BrowserAutomationActionResult = {
  ok: boolean;
  clicked: boolean;
  message: string;
  currentUrl: string;
  title: string;
  matchedCount: number;
};

export type BossZhipinPageType =
  | "job_list"
  | "job_detail"
  | "message_list"
  | "message_chat"
  | "login"
  | "verification"
  | "forbidden_403"
  | "unknown";

export type BossZhipinDetection = {
  platform: "boss-zhipin";
  pageType: BossZhipinPageType;
  currentUrl: string;
  title: string;
  riskMessage: string;
  canRunBatch: boolean;
  hasJobList: boolean;
  hasJobDetail: boolean;
  hasMessageList: boolean;
  hasConversation: boolean;
  hasLinkedJobEntry: boolean;
  hasImmediateChatButton: boolean;
};

export type BossZhipinFilters = {
  location?: string;
  jobType?: string;
  salary?: string;
  experience?: string;
  education?: string;
  companySize?: string;
};

export type BossZhipinFilterFieldResult = {
  field: keyof BossZhipinFilters;
  value: string;
  ok: boolean;
  message: string;
  candidates?: string[];
};

export type BossZhipinFilterResult = {
  ok: boolean;
  message: string;
  currentUrl: string;
  title: string;
  applied: BossZhipinFilterFieldResult[];
};

export type BossZhipinFilterOptionsResult = {
  ok: boolean;
  message: string;
  currentUrl: string;
  title: string;
  options: Record<keyof BossZhipinFilters, string[]>;
};

export type BossZhipinBatchMode = "collect" | "chat" | "collect_and_chat";

export type BossZhipinJobInfo = {
  title: string;
  company: string;
  salary: string;
  salaryRaw: string;
  salaryDecoded: string;
  salaryDecodeStatus: "decoded" | "raw" | "unsupported" | "empty";
  location: string;
  experience: string;
  education: string;
  companySize: string;
  industry: string;
  tags: string[];
  jdText: string;
  responsibilities: string;
  requirements: string;
  benefits: string;
  companyInfo: string;
  sections: Record<string, string>;
  sourceUrl: string;
  collectedAt: string;
  rawText: string;
  signature: string;
};

export type BossZhipinJobItem = BossZhipinJobInfo & {
  index: number;
  chatClicked: boolean;
  chatMessage: string;
};

export type BossZhipinBatchConfig = {
  filters?: BossZhipinFilters;
  maxJobs?: number;
  mode?: BossZhipinBatchMode;
  applyFilters?: boolean;
  continueOnFilterFailure?: boolean;
};

export type BossZhipinBatchResult = {
  ok: boolean;
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: BossZhipinBatchMode;
  filters: BossZhipinFilters;
  maxJobs: number;
  detection: BossZhipinDetection;
  warnings: string[];
  filterResult: BossZhipinFilterResult | null;
  stopReason: string;
  outputPath: string;
  items: BossZhipinJobItem[];
  collectedCount: number;
  chatClickedCount: number;
  currentUrl: string;
  title: string;
};

export type BossZhipinMessageJobItem = {
  index: number;
  ok: boolean;
  conversationTitle: string;
  conversationPreview: string;
  conversationKey: string;
  messageUrl: string;
  job: BossZhipinJobInfo | null;
  errorMessage: string;
  collectedAt: string;
};

export type BossZhipinMessageRunConfig = {
  maxConversations?: number;
};

export type BossZhipinMessageRunResult = {
  ok: boolean;
  runId: string;
  startedAt: string;
  finishedAt: string;
  maxConversations: number;
  detection: BossZhipinDetection;
  warnings: string[];
  stopReason: string;
  outputPath: string;
  items: BossZhipinMessageJobItem[];
  collectedCount: number;
  failedCount: number;
  currentUrl: string;
  title: string;
};
