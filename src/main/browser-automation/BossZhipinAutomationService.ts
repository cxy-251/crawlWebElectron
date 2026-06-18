import fs from "node:fs";
import path from "node:path";
import type { BrowserWorkspace } from "../browser/BrowserWorkspace";
import type {
  BossZhipinBatchConfig,
  BossZhipinBatchMode,
  BossZhipinBatchResult,
  BossZhipinDetection,
  BossZhipinFilterOptionsResult,
  BossZhipinFilterResult,
  BossZhipinFilters,
  BossZhipinJobInfo,
  BossZhipinJobItem,
  BossZhipinMessageJobItem,
  BossZhipinMessageRunConfig,
  BossZhipinMessageRunResult,
  BrowserAutomationActionResult
} from "./types";

const DEFAULT_BOSS_URL = "https://www.zhipin.com/web/geek/job";
const DEFAULT_BOSS_MESSAGES_URL = "https://www.zhipin.com/web/geek/chat";
const DEFAULT_MAX_JOBS = 10;
const MAX_JOBS_LIMIT = 100;
const MAX_CHAT_JOBS_LIMIT = 3;
const DEFAULT_MAX_CONVERSATIONS = 20;
const MAX_CONVERSATIONS_LIMIT = 100;

export class BossZhipinAutomationService {
  constructor(private readonly browserWorkspace: BrowserWorkspace) {}

  async openBossPage(url = DEFAULT_BOSS_URL): Promise<{ url: string; title: string }> {
    await this.browserWorkspace.useProfile("boss-zhipin");
    await this.browserWorkspace.navigation.goto(url || DEFAULT_BOSS_URL);
    return this.browserWorkspace.state.getState();
  }

  async openMessagesPage(url = DEFAULT_BOSS_MESSAGES_URL): Promise<{ url: string; title: string }> {
    await this.browserWorkspace.useProfile("boss-zhipin");
    await this.browserWorkspace.navigation.goto(url || DEFAULT_BOSS_MESSAGES_URL);
    return this.browserWorkspace.state.getState();
  }

  async detectPage(): Promise<BossZhipinDetection> {
    const state = this.browserWorkspace.state.getState();
    if (this.browserWorkspace.activeProfile !== "boss-zhipin") {
      return {
        platform: "boss-zhipin",
        pageType: "unknown",
        currentUrl: state.url,
        title: state.title,
      riskMessage: "请先点击“打开 Boss 直聘”，切换到 Boss 专用浏览器环境。",
      canRunBatch: false,
      hasJobList: false,
      hasJobDetail: false,
      hasMessageList: false,
      hasConversation: false,
      hasLinkedJobEntry: false,
      hasImmediateChatButton: false
    };
    }

    const result = await this.executePageScript<unknown>("detectPage", detectionScript());
    return this.normalizeDetection(result);
  }

  async readFilterOptions(): Promise<BossZhipinFilterOptionsResult> {
    const notReady = this.requireBossProfile();
    if (notReady) {
      return {
        ok: false,
        message: notReady.message,
        currentUrl: notReady.currentUrl,
        title: notReady.title,
        options: emptyFilterOptions()
      };
    }

    const result = await this.executePageScript<{ ok?: unknown; message?: unknown; options?: unknown }>("readFilterOptions", filterOptionsScript());
    const state = this.browserWorkspace.state.getState();
    return {
      ok: Boolean(result?.ok),
      message: String(result?.message || "筛选候选读取没有返回结果"),
      currentUrl: state.url,
      title: state.title,
      options: normalizeFilterOptions(result?.options)
    };
  }

  async applyFilters(filters: BossZhipinFilters): Promise<BossZhipinFilterResult> {
    const notReady = this.requireBossProfile();
    if (notReady) {
      return {
        ok: false,
        message: notReady.message,
        currentUrl: notReady.currentUrl,
        title: notReady.title,
        applied: []
      };
    }

    const result = await this.executePageScript<{ ok?: unknown; message?: unknown; applied?: unknown }>("applyFilters", applyFiltersScript(filters));
    const state = this.browserWorkspace.state.getState();
    return {
      ok: Boolean(result?.ok),
      message: String(result?.message || "筛选操作没有返回结果"),
      currentUrl: state.url,
      title: state.title,
      applied: Array.isArray(result?.applied) ? result.applied : []
    };
  }

  async collectCurrentJob(): Promise<BossZhipinJobInfo> {
    const notReady = this.requireBossProfile();
    if (notReady) {
      return this.emptyJobInfo(notReady.currentUrl, notReady.message);
    }

    const result = await this.executePageScript<unknown>("collectCurrentJob", collectCurrentJobScript());
    return this.normalizeJobInfo(result);
  }

  async clickFirstImmediateChat(): Promise<BrowserAutomationActionResult> {
    const notReady = this.requireBossProfile();
    if (notReady) {
      return {
        ok: false,
        clicked: false,
        message: notReady.message,
        currentUrl: notReady.currentUrl,
        title: notReady.title,
        matchedCount: 0
      };
    }

    return this.clickImmediateChat();
  }

  async runImmediateChatBatch(config: BossZhipinBatchConfig): Promise<BossZhipinBatchResult> {
    return this.runBatch({ ...config, mode: "collect_and_chat" });
  }

  async runBatch(config: BossZhipinBatchConfig): Promise<BossZhipinBatchResult> {
    const startedAt = new Date().toISOString();
    const runId = this.runId(startedAt);
    const filters = config.filters || {};
    const mode = this.normalizeBatchMode(config.mode);
    const requestedMaxJobs = Math.max(1, Math.min(MAX_JOBS_LIMIT, Math.floor(Number(config.maxJobs) || DEFAULT_MAX_JOBS)));
    const maxJobs = mode === "collect" ? requestedMaxJobs : Math.min(MAX_CHAT_JOBS_LIMIT, requestedMaxJobs);
    const shouldApplyFilters = config.applyFilters === true;
    const continueOnFilterFailure = config.continueOnFilterFailure !== false;
    const items: BossZhipinJobItem[] = [];
    const warnings: string[] = [];
    let filterResult: BossZhipinFilterResult | null = null;
    let stopReason = "MAX_JOBS_REACHED";
    let detection = await this.detectPage();

    const notReady = this.requireBossProfile();
    if (notReady) {
      stopReason = notReady.message;
    } else {
      if (mode !== "collect" && requestedMaxJobs > maxJobs) {
        warnings.push(`为降低账号风险，本次${mode === "chat" ? "批量沟通" : "采集并沟通"}最多处理 ${maxJobs} 个岗位。`);
      }
      if (shouldApplyFilters && hasAnyFilter(filters)) {
        filterResult = await this.applyFilters(filters);
        if (!filterResult.ok) {
          warnings.push(filterResult.message);
          detection = await this.detectPage();
          if (!continueOnFilterFailure || !detection.canRunBatch) {
            stopReason = filterResult.message;
          }
        }
      }

      while (items.length < maxJobs && !this.isStopReason(stopReason)) {
        detection = await this.detectPage();
        if (!detection.canRunBatch) {
          stopReason = detection.riskMessage || `PAGE_NOT_READY:${detection.pageType}`;
          break;
        }

        const job = await this.collectCurrentJob();
        const chat = mode === "collect" ? noChatResult(detection) : await this.clickImmediateChat();
        items.push({
          ...job,
          index: items.length + 1,
          chatClicked: chat.clicked,
          chatMessage: chat.message
        });

        if (mode !== "collect" && !chat.ok) {
          stopReason = chat.message || "CHAT_ACTION_FAILED";
          break;
        }

        if (items.length >= maxJobs) {
          stopReason = "MAX_JOBS_REACHED";
          break;
        }

        await this.waitBetweenJobs(mode);
        const moved = await this.moveToNextJob(items);
        if (!moved.moved) {
          stopReason = "NO_NEXT_JOB";
          break;
        }
      }
    }

    const state = this.browserWorkspace.state.getState();
    const finishedAt = new Date().toISOString();
    const result: BossZhipinBatchResult = {
      ok: items.length > 0 && (stopReason === "MAX_JOBS_REACHED" || stopReason === "NO_NEXT_JOB"),
      runId,
      startedAt,
      finishedAt,
      mode,
      filters,
      maxJobs,
      detection,
      warnings,
      filterResult,
      stopReason,
      outputPath: this.outputPathForRun(runId),
      items,
      collectedCount: items.length,
      chatClickedCount: items.filter((item) => item.chatClicked).length,
      currentUrl: state.url,
      title: state.title
    };
    this.writeRunResult(result);
    return result;
  }

  async collectMessageJobs(config: BossZhipinMessageRunConfig = {}): Promise<BossZhipinMessageRunResult> {
    const startedAt = new Date().toISOString();
    const runId = this.runId(startedAt);
    const maxConversations = Math.max(
      1,
      Math.min(MAX_CONVERSATIONS_LIMIT, Math.floor(Number(config.maxConversations) || DEFAULT_MAX_CONVERSATIONS))
    );
    const items: BossZhipinMessageJobItem[] = [];
    const warnings: string[] = [];
    let stopReason = "MAX_CONVERSATIONS_REACHED";
    let detection = await this.detectPage();

    const notReady = this.requireBossProfile();
    if (notReady) {
      stopReason = notReady.message;
    } else {
      if (detection.pageType !== "message_list" && detection.pageType !== "message_chat") {
        await this.openMessagesPage();
        await delay(1800);
        detection = await this.detectPage();
      }

      while (items.length < maxConversations && !this.isMessageStopReason(stopReason)) {
        detection = await this.detectPage();
        if (detection.pageType === "login" || detection.pageType === "verification" || detection.pageType === "forbidden_403") {
          stopReason = detection.riskMessage || `PAGE_BLOCKED:${detection.pageType}`;
          break;
        }
        if (detection.pageType !== "message_list" && detection.pageType !== "message_chat") {
          stopReason = `MESSAGE_PAGE_NOT_READY:${detection.pageType}`;
          break;
        }

        const conversation = await this.executePageScript<{
          ok?: boolean;
          message?: string;
          conversationTitle?: string;
          conversationPreview?: string;
          conversationKey?: string;
          messageUrl?: string;
        }>(
          "clickNextMessageConversation",
          clickNextMessageConversationScript(items.map((item) => item.conversationKey).filter(Boolean))
        );

        if (!conversation.ok) {
          stopReason = conversation.message || "NO_MORE_CONVERSATION";
          break;
        }

        await delay(randomInt(1200, 2600));
        const linkedJob = await this.executePageScript<{ ok?: boolean; message?: string }>("openLinkedJobFromMessage", openLinkedJobFromMessageScript());
        if (!linkedJob.ok) {
          items.push(this.messageJobItem(items.length + 1, conversation, null, linkedJob.message || "没有找到关联岗位入口。"));
          await this.openMessagesPage();
          await delay(randomInt(1500, 2800));
          continue;
        }

        await delay(randomInt(1500, 2800));
        const job = await this.collectCurrentJob();
        items.push(this.messageJobItem(items.length + 1, conversation, job, ""));
        await this.openMessagesPage();
        await delay(randomInt(1800, 3200));
      }
    }

    const state = this.browserWorkspace.state.getState();
    const finishedAt = new Date().toISOString();
    const result: BossZhipinMessageRunResult = {
      ok: items.some((item) => item.ok),
      runId,
      startedAt,
      finishedAt,
      maxConversations,
      detection,
      warnings,
      stopReason,
      outputPath: this.outputPathForMessageRun(runId),
      items,
      collectedCount: items.filter((item) => item.ok).length,
      failedCount: items.filter((item) => !item.ok).length,
      currentUrl: state.url,
      title: state.title
    };
    this.writeMessageRunResult(result);
    return result;
  }

  private async clickImmediateChat(): Promise<BrowserAutomationActionResult> {
    const result = await this.executePageScript<{ ok?: unknown; clicked?: unknown; message?: unknown; matchedCount?: unknown }>(
      "clickFirstImmediateChat",
      clickImmediateChatScript()
    );
    const state = this.browserWorkspace.state.getState();

    return {
      ok: Boolean(result?.ok),
      clicked: Boolean(result?.clicked),
      message: String(result?.message || "操作没有返回结果"),
      currentUrl: state.url,
      title: state.title,
      matchedCount: Number(result?.matchedCount || 0)
    };
  }

  private async executePageScript<T>(step: string, script: string): Promise<T> {
    try {
      return (await this.browserWorkspace.webContents.executeJavaScript(script, true)) as T;
    } catch (error) {
      const state = this.browserWorkspace.state.getState();
      const details = {
        code: "SCRIPT_EXECUTION_FAILED",
        step,
        message: error instanceof Error ? error.message : String(error),
        currentUrl: state.url
      };
      const wrapped = new Error(`${details.code}: ${details.message}`);
      (wrapped as Error & { details?: typeof details }).details = details;
      throw wrapped;
    }
  }

  private normalizeDetection(value: unknown): BossZhipinDetection {
    const state = this.browserWorkspace.state.getState();
    const input = value && typeof value === "object" ? (value as Partial<BossZhipinDetection>) : {};
    const pageType = isBossPageType(input.pageType) ? input.pageType : "unknown";
    const hasJobList = Boolean(input.hasJobList);
    const hasJobDetail = Boolean(input.hasJobDetail);
    return {
      platform: "boss-zhipin",
      pageType,
      currentUrl: stringValue(input.currentUrl) || state.url,
      title: stringValue(input.title) || state.title,
      riskMessage: stringValue(input.riskMessage),
      canRunBatch: pageType === "job_list" || pageType === "job_detail",
      hasJobList,
      hasJobDetail,
      hasMessageList: Boolean(input.hasMessageList),
      hasConversation: Boolean(input.hasConversation),
      hasLinkedJobEntry: Boolean(input.hasLinkedJobEntry),
      hasImmediateChatButton: Boolean(input.hasImmediateChatButton)
    };
  }

  private normalizeBatchMode(value: unknown): BossZhipinBatchMode {
    return value === "collect" || value === "chat" || value === "collect_and_chat" ? value : "collect_and_chat";
  }

  private waitBetweenJobs(mode: BossZhipinBatchMode): Promise<void> {
    const [minMs, maxMs] = mode === "collect" ? [5000, 11000] : [90000, 180000];
    return delay(randomInt(minMs, maxMs));
  }

  private async detectBlocker(): Promise<{ blocked: boolean; message: string }> {
    return this.executePageScript<{ blocked: boolean; message: string }>("detectBlocker", blockerDetectionScript());
  }

  private async moveToNextJob(visitedJobs: BossZhipinJobItem[]): Promise<{ moved: boolean; message: string }> {
    const visited = visitedJobs.map((job) => ({
      title: job.title,
      company: job.company,
      salary: job.salary,
      signature: job.signature
    }));
    return this.executePageScript<{ moved: boolean; message: string }>("moveToNextJob", moveToNextJobScript(visited));
  }

  private messageJobItem(
    index: number,
    conversation: {
      conversationTitle?: string;
      conversationPreview?: string;
      conversationKey?: string;
      messageUrl?: string;
    },
    job: BossZhipinJobInfo | null,
    errorMessage: string
  ): BossZhipinMessageJobItem {
    return {
      index,
      ok: Boolean(job),
      conversationTitle: stringValue(conversation.conversationTitle),
      conversationPreview: stringValue(conversation.conversationPreview),
      conversationKey: stringValue(conversation.conversationKey) || [conversation.conversationTitle, conversation.conversationPreview].filter(Boolean).join("|"),
      messageUrl: stringValue(conversation.messageUrl) || this.browserWorkspace.state.getState().url,
      job,
      errorMessage,
      collectedAt: new Date().toISOString()
    };
  }

  private requireBossProfile(): { message: string; currentUrl: string; title: string } | null {
    if (this.browserWorkspace.activeProfile === "boss-zhipin") return null;
    const state = this.browserWorkspace.state.getState();
    return {
      message: "请先点击“打开 Boss 直聘”，切换到 Boss 专用浏览器环境。",
      currentUrl: state.url,
      title: state.title
    };
  }

  private normalizeJobInfo(value: unknown): BossZhipinJobInfo {
    const input = value && typeof value === "object" ? (value as Partial<BossZhipinJobInfo>) : {};
    const salaryRaw = stringValue(input.salaryRaw) || stringValue(input.salary);
    const salaryDecoded = stringValue(input.salaryDecoded);
    const salaryDecodeStatus =
      input.salaryDecodeStatus === "decoded" ||
      input.salaryDecodeStatus === "raw" ||
      input.salaryDecodeStatus === "unsupported" ||
      input.salaryDecodeStatus === "empty"
        ? input.salaryDecodeStatus
        : salaryDecoded
          ? "decoded"
          : salaryRaw
            ? "raw"
            : "empty";
    return {
      title: stringValue(input.title),
      company: stringValue(input.company),
      salary: stringValue(input.salary) || salaryDecoded || salaryRaw,
      salaryRaw,
      salaryDecoded,
      salaryDecodeStatus,
      location: stringValue(input.location),
      experience: stringValue(input.experience),
      education: stringValue(input.education),
      companySize: stringValue(input.companySize),
      industry: stringValue(input.industry),
      tags: Array.isArray(input.tags) ? input.tags.filter((item): item is string => typeof item === "string") : [],
      jdText: stringValue(input.jdText),
      responsibilities: stringValue(input.responsibilities),
      requirements: stringValue(input.requirements),
      benefits: stringValue(input.benefits),
      companyInfo: stringValue(input.companyInfo),
      sections: isStringRecord(input.sections) ? input.sections : {},
      sourceUrl: stringValue(input.sourceUrl) || this.browserWorkspace.state.getState().url,
      collectedAt: stringValue(input.collectedAt) || new Date().toISOString(),
      rawText: stringValue(input.rawText),
      signature: stringValue(input.signature)
    };
  }

  private emptyJobInfo(sourceUrl: string, message: string): BossZhipinJobInfo {
    return {
      title: "",
      company: "",
      salary: "",
      salaryRaw: "",
      salaryDecoded: "",
      salaryDecodeStatus: "empty",
      location: "",
      experience: "",
      education: "",
      companySize: "",
      industry: "",
      tags: [],
      jdText: "",
      responsibilities: "",
      requirements: "",
      benefits: "",
      companyInfo: "",
      sections: {},
      sourceUrl,
      collectedAt: new Date().toISOString(),
      rawText: message,
      signature: message
    };
  }

  private isStopReason(stopReason: string): boolean {
    return stopReason !== "MAX_JOBS_REACHED";
  }

  private isMessageStopReason(stopReason: string): boolean {
    return stopReason !== "MAX_CONVERSATIONS_REACHED";
  }

  private writeRunResult(result: BossZhipinBatchResult): string {
    fs.mkdirSync(path.dirname(result.outputPath), { recursive: true });
    fs.writeFileSync(result.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result.outputPath;
  }

  private writeMessageRunResult(result: BossZhipinMessageRunResult): string {
    fs.mkdirSync(path.dirname(result.outputPath), { recursive: true });
    fs.writeFileSync(result.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result.outputPath;
  }

  private outputPathForRun(runId: string): string {
    const outputDir = path.join(process.cwd(), "local-api-usage", "boss-zhipin-runs");
    return path.join(outputDir, `${runId}.json`);
  }

  private outputPathForMessageRun(runId: string): string {
    const outputDir = path.join(process.cwd(), "local-api-usage", "boss-zhipin-message-runs");
    return path.join(outputDir, `${runId}.json`);
  }

  private runId(startedAt: string): string {
    return `run-${startedAt.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")}`;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasAnyFilter(filters: BossZhipinFilters): boolean {
  return Object.values(filters).some((value) => typeof value === "string" && value.trim().length > 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function isBossPageType(value: unknown): value is BossZhipinDetection["pageType"] {
  return (
    value === "job_list" ||
    value === "job_detail" ||
    value === "message_list" ||
    value === "message_chat" ||
    value === "login" ||
    value === "verification" ||
    value === "forbidden_403" ||
    value === "unknown"
  );
}

function noChatResult(detection: BossZhipinDetection): BrowserAutomationActionResult {
  return {
    ok: true,
    clicked: false,
    message: "仅采集模式，未点击立即沟通。",
    currentUrl: detection.currentUrl,
    title: detection.title,
    matchedCount: detection.hasImmediateChatButton ? 1 : 0
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function emptyFilterOptions(): Record<keyof BossZhipinFilters, string[]> {
  return {
    location: [],
    jobType: ["全职", "兼职", "实习"],
    salary: ["薪资不限", "3K以下", "3-5K", "5-10K", "10-20K", "20-50K", "50K以上"],
    experience: ["经验不限", "在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"],
    education: ["学历不限", "初中及以下", "中专/中技", "高中", "大专", "本科", "硕士", "博士"],
    companySize: ["规模不限", "0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"]
  };
}

function normalizeFilterOptions(value: unknown): Record<keyof BossZhipinFilters, string[]> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<Record<keyof BossZhipinFilters, unknown>>) : {};
  const output = emptyFilterOptions();
  for (const key of Object.keys(output) as Array<keyof BossZhipinFilters>) {
    output[key] = Array.isArray(input[key])
      ? dedupeValues([...output[key], ...input[key].filter((item): item is string => typeof item === "string")])
      : output[key];
  }
  return output;
}

function dedupeValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

const helperSource = String.raw`
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const cleanLine = (text) => String(text || "").replace(/[ \t\f\v]+/g, " ").trim();
  const multilineText = (el) => {
    const source = String(el?.innerText || el?.textContent || "");
    return source
      .split(/\n+/)
      .map((line) => cleanLine(line))
      .filter(Boolean)
      .join("\n");
  };
  const dedupeTexts = (values) => Array.from(new Set(values.filter(Boolean)));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => clean(document.body?.innerText || document.body?.textContent || "");
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const disabled = (el) => {
    if (!el) return true;
    return Boolean(el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled|disable/i.test(String(el.className || "")));
  };
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const textOf = (el) => clean(el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title") || "");
  const setInputValue = (input, value) => {
    if (!input) return false;
    input.focus?.();
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const clickElement = (el) => {
    const target = el?.closest?.("button,a,[role='button'],li,label") || el;
    if (!target || !visible(target) || disabled(target)) return false;
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.click();
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
    return true;
  };
  const blockerMessage = () => {
    const text = bodyText();
    if (/\/403\.html|forbidden/i.test(location.href) || /(403|访问异常|暂时无法访问|账号异常|暂时封禁)/.test(text)) return "Boss 账号或访问环境需要验证/恢复，请先在左侧浏览器处理。";
    if (/(验证码|安全验证|拖动滑块|风险验证)/.test(text)) return "页面需要安全验证，请先在左侧浏览器处理。";
    if (/(请先登录|登录后|扫码登录|账号登录|密码登录)/.test(text)) return "页面需要登录，请先在左侧浏览器处理。";
    return "";
  };
  const shortVisibleTextNodes = (root = document) => {
    const seen = new Set();
    const nodes = [];
    for (const el of all("button,a,li,span,div,[role='button']", root)) {
      if (!visible(el) || disabled(el)) continue;
      const text = textOf(el);
      if (!text || text.length > 48 || seen.has(text)) continue;
      seen.add(text);
      nodes.push({ el, text });
    }
    return nodes;
  };
  const findByText = (text, root = document) => {
    const wanted = clean(text).toLowerCase();
    const nodes = shortVisibleTextNodes(root);
    const exact = nodes.filter((item) => item.text.toLowerCase() === wanted);
    if (exact[0]) return exact[0];
    const contains = nodes.filter((item) => item.text.toLowerCase().includes(wanted));
    return contains.length === 1 ? contains[0] : null;
  };
  const detailRoot = () => {
    const selectors = [
      ".job-detail",
      ".job-detail-container",
      ".job-detail-box",
      ".job-detail-content",
      ".detail-content",
      ".job-sec",
      ".job-detail-panel",
      "main"
    ];
    const candidates = selectors.flatMap((selector) => all(selector)).filter((el) => visible(el) && textOf(el).length > 80);
    return candidates.find((el) => /(职位描述|岗位职责|任职要求|职位详情|工作内容)/.test(textOf(el))) || candidates[0] || document.body;
  };
`;

function detectionScript(): string {
  return `
    (() => {
      ${helperSource}
      const text = bodyText();
      const url = location.href;
      const riskMessage = blockerMessage();
      const hasJobList = all(".job-list-box, .job-list, .search-job-result, .job-card-list, .job-card-wrapper, .job-card-wrap, .job-card-box")
        .some((el) => visible(el) && textOf(el).length > 30);
      const root = detailRoot();
      const hasJobDetail = visible(root) && /(职位描述|岗位职责|任职要求|工作内容|立即沟通)/.test(textOf(root));
      const hasImmediateChatButton = shortVisibleTextNodes(document).some((item) => item.text.includes("立即沟通"));
      const hasMessageList = all(".chat-list, .message-list, .conversation-list, [class*='chat-list'], [class*='message-list'], [class*='conversation']")
        .some((el) => visible(el) && textOf(el).length > 20);
      const hasConversation = /\\/web\\/geek\\/chat/.test(url) || /(沟通|交换联系方式|发送|常用语|对方正在输入|在线)/.test(text);
      const hasLinkedJobEntry = shortVisibleTextNodes(document).some((item) => /(查看职位|职位详情|相关职位|沟通职位|招聘职位|岗位详情)/.test(item.text)) ||
        all("a,[role='button'],button,div,li").some((el) => visible(el) && /(K|薪|经验|本科|大专|职位描述|立即沟通)/.test(textOf(el)) && textOf(el).length < 220);
      let pageType = "unknown";
      if (/\\/403\\.html|forbidden/i.test(url) || /(403|访问异常|暂时无法访问|账号异常|暂时封禁)/.test(text)) {
        pageType = "forbidden_403";
      } else if (/(验证码|安全验证|拖动滑块|风险验证)/.test(text)) {
        pageType = "verification";
      } else if (/(请先登录|登录后|扫码登录|账号登录|密码登录)/.test(text)) {
        pageType = "login";
      } else if (/\\/web\\/geek\\/chat/.test(url) && hasConversation) {
        pageType = "message_chat";
      } else if (/\\/web\\/geek\\/chat/.test(url) || hasMessageList) {
        pageType = "message_list";
      } else if (hasJobDetail) {
        pageType = "job_detail";
      } else if (hasJobList || /\\/web\\/geek\\/jobs?/.test(url)) {
        pageType = "job_list";
      }
      return {
        platform: "boss-zhipin",
        pageType,
        currentUrl: url,
        title: document.title,
        riskMessage,
        canRunBatch: pageType === "job_list" || pageType === "job_detail",
        hasJobList,
        hasJobDetail,
        hasMessageList,
        hasConversation,
        hasLinkedJobEntry,
        hasImmediateChatButton
      };
    })()
  `;
}

function filterOptionsScript(): string {
  return `
    (() => {
      ${helperSource}
      const blocker = blockerMessage();
      if (blocker) {
        return { ok: false, message: blocker, options: ${JSON.stringify(emptyFilterOptions())} };
      }
      const fixedOptions = {
        location: [],
        jobType: ["全职", "兼职", "实习"],
        salary: ["薪资不限", "3K以下", "3-5K", "5-10K", "10-20K", "20-50K", "50K以上"],
        experience: ["经验不限", "在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"],
        education: ["学历不限", "初中及以下", "中专/中技", "高中", "大专", "本科", "硕士", "博士"],
        companySize: ["规模不限", "0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"]
      };
      const currentCity = textOf(all(".city-label, .cur-city-label, [class*='city-label']").find((el) => visible(el))) || "";
      const visibleCities = shortVisibleTextNodes(document)
        .map((item) => item.text)
        .filter((text) => /^(全国|北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|厦门|天津|郑州)$/.test(text));
      return {
        ok: true,
        message: "已读取筛选候选。",
        options: {
          ...fixedOptions,
          location: dedupeTexts([currentCity, ...visibleCities])
        }
      };
    })()
  `;
}

function blockerDetectionScript(): string {
  return `
    (() => {
      ${helperSource}
      const message = blockerMessage();
      return { blocked: Boolean(message), message };
    })()
  `;
}

function applyFiltersScript(filters: BossZhipinFilters): string {
  return `
    (async () => {
      ${helperSource}
      const filters = ${JSON.stringify(filters)};
      const fieldConfig = {
        location: {
          labels: ["城市", "地区", "全国", "北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "苏州", "西安"],
          optionHints: ["热门城市", "选择城市", "城市"],
          options: ["全国", "北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "苏州", "西安", "长沙", "厦门", "天津", "郑州"]
        },
        jobType: {
          labels: ["求职类型", "职位类型", "工作类型", "全职", "兼职", "实习"],
          optionHints: ["全职", "兼职", "实习"],
          options: ["全职", "兼职", "实习"]
        },
        salary: {
          labels: ["薪资待遇", "薪资不限", "薪资"],
          optionHints: ["薪资不限", "3K以下", "3-5K", "5-10K", "10-20K", "20-50K", "50K以上"],
          options: ["薪资不限", "3K以下", "3-5K", "5-10K", "10-20K", "20-50K", "50K以上"]
        },
        experience: {
          labels: ["工作经验", "经验不限", "经验"],
          optionHints: ["经验不限", "在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"],
          options: ["经验不限", "在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"]
        },
        education: {
          labels: ["学历要求", "学历不限", "学历"],
          optionHints: ["学历不限", "初中及以下", "中专/中技", "高中", "大专", "本科", "硕士", "博士"],
          options: ["学历不限", "初中及以下", "中专/中技", "高中", "大专", "本科", "硕士", "博士"]
        },
        companySize: {
          labels: ["公司规模", "规模不限", "规模"],
          optionHints: ["规模不限", "0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"],
          options: ["规模不限", "0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"]
        }
      };
      const applied = [];
      const blocker = blockerMessage();
      if (blocker) {
        return { ok: false, message: blocker, applied };
      }

      const textLooksLikeFilter = (text) => {
        const terms = Object.values(fieldConfig).flatMap((config) => [...config.labels, ...config.options]);
        const matched = terms.filter((term) => text.includes(term)).length;
        return matched >= 2 || /(筛选|薪资|经验|学历|公司规模|求职类型|工作类型|城市|地区)/.test(text);
      };
      const isGlobalNav = (el) => Boolean(el.closest?.("header,.nav,.navbar,[class*='header'],[class*='nav-bar'],[class*='site-nav']"));
      const isJobCard = (el) => Boolean(el.closest?.(".job-card-wrapper,.job-card-body,.job-card,.job-primary,.job-item,.job-list-box,.search-job-result,[class*='job-card']"));
      const rootKey = (el) => {
        const rect = el.getBoundingClientRect();
        return [el.tagName, String(el.className || "").slice(0, 80), Math.round(rect.left), Math.round(rect.top)].join("|");
      };
      const filterRoots = () => {
        const selectors = [
          ".search-condition-wrapper",
          ".condition-box",
          ".job-filter",
          ".filter-select-box",
          ".job-menu",
          ".filter-list",
          ".filter-box",
          ".search-filter",
          ".dropdown-wrap",
          "[class*='condition']",
          "[class*='filter']",
          "[class*='select']"
        ];
        const roots = [];
        const seen = new Set();
        const addRoot = (el) => {
          if (!el || !visible(el) || isGlobalNav(el) || isJobCard(el)) return;
          const rect = el.getBoundingClientRect();
          const text = textOf(el);
          if (rect.width < 120 || rect.height < 16 || rect.top < 55 || rect.top > Math.max(560, window.innerHeight * 0.7)) return;
          if (text.length > 2400 || !textLooksLikeFilter(text)) return;
          const key = rootKey(el);
          if (seen.has(key)) return;
          seen.add(key);
          roots.push(el);
        };
        selectors.flatMap((selector) => all(selector)).forEach(addRoot);
        const optionTerms = Object.values(fieldConfig).flatMap((config) => config.options);
        for (const item of shortVisibleTextNodes(document)) {
          if (!optionTerms.includes(item.text)) continue;
          if (isGlobalNav(item.el) || isJobCard(item.el)) continue;
          const root = item.el.closest?.("[class*='condition'],[class*='filter'],[class*='select'],.dropdown-wrap,section,div");
          addRoot(root);
        }
        return roots;
      };
      const floatingRoots = () => all("div,ul,section")
        .filter((el) => {
          if (!visible(el)) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const text = textOf(el);
          const className = String(el.className || "");
          const looksFloating = /city|dialog|modal|popover|dropdown|select|filter|condition|menu/i.test(className) ||
            style.position === "fixed" ||
            style.position === "absolute";
          return looksFloating && rect.width > 80 && rect.height > 30 && text.length <= 2400 && !isGlobalNav(el);
        })
        .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0));
      const nodesFromRoots = (roots) => {
        const seen = new Set();
        const nodes = [];
        for (const root of roots) {
          for (const item of shortVisibleTextNodes(root)) {
            if (isGlobalNav(item.el) || isJobCard(item.el)) continue;
            const rect = item.el.getBoundingClientRect();
            const key = item.text + "|" + Math.round(rect.left) + "|" + Math.round(rect.top);
            if (seen.has(key)) continue;
            seen.add(key);
            nodes.push(item);
          }
        }
        return nodes;
      };
      const closeOpenLayers = async () => {
        document.activeElement?.blur?.();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        await wait(180);
      };
      const findTrigger = (field) => {
        const config = fieldConfig[field];
        if (field === "location") {
          const cityTrigger = all(".city-label, .cur-city-label, [class*='city-label']")
            .find((el) => visible(el) && textOf(el));
          if (cityTrigger) {
            return { el: cityTrigger, text: textOf(cityTrigger) };
          }
        }
        const roots = filterRoots();
        const triggerTexts = [...config.labels, ...config.options];
        const nodes = nodesFromRoots(roots)
          .filter((item) => triggerTexts.some((label) => item.text === label || (item.text.length <= 24 && item.text.includes(label))))
          .filter((item) => {
            const rect = item.el.getBoundingClientRect();
            return rect.top < Math.max(420, window.innerHeight * 0.55);
          });
        const exact = nodes.find((item) => triggerTexts.includes(item.text));
        return exact || nodes.sort((a, b) => a.text.length - b.text.length)[0] || null;
      };
      const optionCandidates = (field) => {
        const config = fieldConfig[field];
        const roots = [...floatingRoots(), ...filterRoots()];
        const allowed = config.options;
        const labels = Object.values(fieldConfig).flatMap((item) => item.labels);
        const options = nodesFromRoots(roots)
          .filter((item) => !labels.includes(item.text))
          .filter((item) => item.text.length <= 80)
          .filter((item) => field === "location" ? true : allowed.some((option) => item.text === option || item.text.includes(option)));
        const visibleOptions = options.map((item) => item.text);
        return dedupeTexts([...allowed, ...visibleOptions]).slice(0, 60);
      };
      const findOption = (field, value) => {
        const config = fieldConfig[field];
        const popups = floatingRoots().filter((root) => {
          const text = textOf(root);
          return field === "location" ? /(城市|地区|热门城市|选择城市)/.test(text) || text.includes(value) : config.options.some((option) => text.includes(option));
        });
        const roots = popups.length ? popups : filterRoots();
        const nodes = nodesFromRoots(roots)
          .filter((item) => item.text.length <= 80)
          .filter((item) => field === "location" ? true : config.options.some((option) => item.text === option || item.text.includes(option)) || item.text.includes(value));
        const exact = nodes.filter((item) => item.text === value);
        if (exact[0]) return exact[0];
        const normalizedValue = value.toLowerCase();
        const looseExact = nodes.filter((item) => clean(item.text).toLowerCase() === normalizedValue);
        if (looseExact[0]) return looseExact[0];
        const contains = nodes.filter((item) => item.text.includes(value));
        return contains.length === 1 ? contains[0] : null;
      };
      const searchLocationInPopup = async (value) => {
        const inputs = all("input").filter((input) => visible(input));
        const searchInput = inputs.find((input) => {
          const hint = clean([input.placeholder, input.getAttribute("aria-label"), input.getAttribute("title")].filter(Boolean).join(" "));
          return /(城市|地区|地点|搜索|请输入)/.test(hint);
        }) || inputs[0];
        if (!searchInput) return false;
        setInputValue(searchInput, value);
        await wait(650);
        return true;
      };
      const applyOne = async (field, value) => {
        const normalizedValue = clean(value);
        if (!normalizedValue) return null;
        await closeOpenLayers();
        const trigger = findTrigger(field);
        if (field === "location" && trigger?.text === normalizedValue) {
          return { field, value: normalizedValue, ok: true, message: "当前地区已是“" + normalizedValue + "”。" };
        }
        if (field !== "location" && trigger?.text === normalizedValue) {
          return { field, value: normalizedValue, ok: true, message: "当前筛选已是“" + normalizedValue + "”。" };
        }
        if (!trigger || !clickElement(trigger.el)) {
          if (field === "jobType" && normalizedValue === "全职") {
            return { field, value: normalizedValue, ok: true, message: "没有找到求职类型筛选入口；按 Boss 默认全职处理，未额外点击。" };
          }
          return { field, value: normalizedValue, ok: false, message: "没有找到筛选项入口。", candidates: optionCandidates(field) };
        }
        await wait(500);
        if (field === "location") {
          await searchLocationInPopup(normalizedValue);
        }
        let match = findOption(field, normalizedValue);
        if (!match) {
          await wait(700);
          match = findOption(field, normalizedValue);
        }
        if (!match) {
          const candidates = optionCandidates(field);
          const contains = candidates.filter((item) => item.includes(normalizedValue));
          return {
            field,
            value: normalizedValue,
            ok: false,
            message: contains.length > 1 ? "匹配到多个候选，请填写更精确的值。" : "没有找到匹配的筛选候选。",
            candidates
          };
        }
        if (!clickElement(match.el)) {
          return { field, value: normalizedValue, ok: false, message: "找到了候选，但无法点击。", candidates: optionCandidates(field) };
        }
        await wait(700);
        if (field === "location") {
          const confirm = findByText("确定") || findByText("确认") || findByText("完成");
          if (confirm) {
            clickElement(confirm.el);
            await wait(500);
          }
        }
        await closeOpenLayers();
        return { field, value: normalizedValue, ok: true, message: "已选择“" + match.text + "”。" };
      };

      for (const field of Object.keys(fieldConfig)) {
        const result = await applyOne(field, filters[field]);
        if (result) applied.push(result);
      }
      return {
        ok: applied.every((item) => item.ok),
        message: applied.length === 0 ? "没有填写筛选条件。" : applied.every((item) => item.ok) ? "筛选条件已应用。" : "部分筛选条件未能应用。",
        applied
      };
    })()
  `;
}

function collectCurrentJobScript(): string {
  return `
    (() => {
      ${helperSource}
      const root = detailRoot();
      const rawText = multilineText(root);
      const pickText = (selectors) => {
        for (const selector of selectors) {
          const node = all(selector, root).find((el) => visible(el) && textOf(el));
          if (node) return textOf(node);
          const pageNode = all(selector).find((el) => visible(el) && textOf(el));
          if (pageNode) return textOf(pageNode);
        }
        return "";
      };
      const lines = rawText.split("\\n").map((line) => cleanLine(line)).filter(Boolean);
      const normalSalaryPattern = /(\\d+\\s*[Kk]-\\d+\\s*[Kk]|\\d+-\\d+\\s*[Kk](?:·\\d+薪)?|\\d+\\s*[Kk]以上|面议|\\d+[-~]\\d+元\\/天)/;
      const privateSalaryPattern = /[\\ue000-\\uf8ff]/;
      const salaryTextFromElement = (el) => {
        const values = [
          el?.innerText,
          el?.textContent,
          el?.getAttribute?.("aria-label"),
          el?.getAttribute?.("title"),
          el?.getAttribute?.("data-salary")
        ];
        return values.map((value) => clean(value)).find(Boolean) || "";
      };
      const salaryCandidateTexts = () => {
        const selectorCandidates = [
          ".salary",
          ".job-salary",
          ".red",
          "[class*='salary']",
          "[class*='wage']",
          "[class*='pay']"
        ].flatMap((selector) => all(selector, root).concat(all(selector))).map(salaryTextFromElement);
        const lineCandidates = lines.filter((line) => normalSalaryPattern.test(line) || privateSalaryPattern.test(line) || /薪资|待遇|面议/.test(line));
        return dedupeTexts([...selectorCandidates, ...lineCandidates])
          .map((text) => clean(text))
          .filter((text) => text && text.length <= 80);
      };
      const decodeBossSalary = (raw) => {
        const input = clean(raw);
        if (!input) return { text: "", status: "empty" };
        if (privateSalaryPattern.test(input)) {
          return { text: "", status: "unsupported" };
        }
        const normalMatch = input.match(normalSalaryPattern);
        if (normalMatch?.[1]) {
          return { text: normalMatch[1], status: "decoded" };
        }
        return { text: input, status: "raw" };
      };
      const tagTexts = dedupeTexts(shortVisibleTextNodes(root)
        .map((item) => item.text)
        .filter((text) => text.length <= 24)
        .filter((text) => !/(立即沟通|继续沟通|感兴趣|收藏|举报|分享|查看地图|公司主页)/.test(text)));
      const findTag = (pattern) => tagTexts.find((text) => pattern.test(text)) || "";
      const sectionLabels = [
        "职位描述",
        "岗位职责",
        "工作职责",
        "工作内容",
        "职位要求",
        "岗位要求",
        "任职要求",
        "任职资格",
        "加分项",
        "职位福利",
        "薪资福利",
        "福利待遇",
        "公司介绍",
        "团队介绍",
        "工商信息"
      ];
      const sections = {};
      let currentSection = "概览";
      sections[currentSection] = [];
      for (const line of lines) {
        const matchedLabel = sectionLabels.find((label) => line === label || line.startsWith(label + "：") || line.startsWith(label + ":"));
        if (matchedLabel) {
          currentSection = matchedLabel;
          sections[currentSection] = sections[currentSection] || [];
          const rest = cleanLine(line.replace(matchedLabel, "").replace(/^[:：]/, ""));
          if (rest) sections[currentSection].push(rest);
        } else {
          sections[currentSection].push(line);
        }
      }
      const normalizedSections = Object.fromEntries(
        Object.entries(sections)
          .map(([key, value]) => [key, dedupeTexts(value).join("\\n").trim()])
          .filter(([, value]) => value)
      );
      const sectionText = (patterns) => Object.entries(normalizedSections)
        .filter(([key]) => patterns.some((pattern) => pattern.test(key)))
        .map(([, value]) => value)
        .join("\\n\\n")
        .trim();
      const cleanedJd = Object.entries(normalizedSections)
        .filter(([key]) => !/(公司介绍|工商信息)/.test(key))
        .map(([key, value]) => key === "概览" ? value : key + "\\n" + value)
        .join("\\n\\n")
        .trim();
      const likelyHeaderLine = lines.find((line) => /(\\d+\\s*[Kk]|面议)/.test(line)) || "";
      const headerParts = likelyHeaderLine.split(/\\s+/).filter(Boolean);
      const titleFromHeader = headerParts.find((part) => !/(\\d+\\s*[Kk]|面议|经验|本科|大专|硕士|博士|学历|城市|招聘)/.test(part)) || "";
      const companyLine = lines.find((line) => /(已上市|不需要融资|未融资|天使轮|A轮|B轮|C轮|D轮|公司|科技|信息|网络)/.test(line) && line.length <= 80) || "";
      const companyFromLine = companyLine.replace(/(已上市|不需要融资|未融资|天使轮|A轮|B轮|C轮|D轮).*$/, "").trim();
      const pickFromLines = (pattern) => lines.find((line) => pattern.test(line)) || "";
      const locationFromLines = pickFromLines(/(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|远程|全国)([·\\s]|$)/);
      const parseTagFromLines = (pattern) => tagTexts.find((text) => pattern.test(text)) || pickFromLines(pattern);
      const parseExactTag = (values) => {
        return tagTexts.find((text) => values.includes(text)) || lines.find((line) => values.includes(line)) || "";
      };
      const uniqueTags = dedupeTexts(tagTexts.filter((text) => {
        if (text.length > 24) return false;
        return /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|远程|全国|经验|应届|在校|不限|本科|大专|硕士|博士|高中|中专|\\d+-\\d+人|\\d+人以上|少于\\d+人|全职|兼职|实习|五险|双休|年终奖)/.test(text);
      }));
      const title =
        pickText(["h1", ".job-name", ".name", ".job-title", ".detail-title", "[class*='job-name']", "[class*='job-title']"]) ||
        titleFromHeader ||
        clean(document.title.split(/[|_-]/)[0] || "");
      const company =
        pickText([".company-name", ".company-info .name", ".job-company", ".boss-name", "[class*='company-name']", "[class*='company'] .name"]) ||
        companyFromLine;
      const salaryCandidates = salaryCandidateTexts();
      const normalSalaryCandidate = salaryCandidates.find((text) => !privateSalaryPattern.test(text) && normalSalaryPattern.test(text));
      const salaryRaw = clean(normalSalaryCandidate || salaryCandidates[0] || "");
      const decodedSalary = decodeBossSalary(salaryRaw);
      const salaryDecoded = decodedSalary.status === "decoded" ? decodedSalary.text : "";
      const salary = salaryDecoded || salaryRaw;
      const locationText = parseTagFromLines(/(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|远程|全国)/) || locationFromLines;
      const experience = parseExactTag(["经验不限", "在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"]);
      const education = parseExactTag(["学历不限", "初中及以下", "中专/中技", "高中", "大专", "本科", "硕士", "博士"]);
      const companySize = parseTagFromLines(/^(\\d+-\\d+人|\\d+人以上|少于\\d+人|\\d+人)$/);
      const industry = pickText([".industry", ".company-tag", ".job-company-tag", "[class*='industry']"]) || "";
      const responsibilities = sectionText([/岗位职责/, /工作职责/, /工作内容/]);
      const requirements = sectionText([/任职要求/, /任职资格/, /岗位要求/, /职位要求/, /加分项/]);
      const benefits = sectionText([/职位福利/, /薪资福利/, /福利待遇/]);
      const companyInfo = sectionText([/公司介绍/, /团队介绍/, /工商信息/]);
      const jdText = cleanedJd || rawText;
      const signature = [title, company, salary].filter(Boolean).join("|") || rawText.slice(0, 120);
      return {
        title,
        company,
        salary,
        salaryRaw,
        salaryDecoded,
        salaryDecodeStatus: decodedSalary.status,
        location: locationText,
        experience,
        education,
        companySize,
        industry,
        tags: uniqueTags,
        jdText,
        responsibilities,
        requirements,
        benefits,
        companyInfo,
        sections: normalizedSections,
        sourceUrl: window.location.href,
        collectedAt: new Date().toISOString(),
        rawText,
        signature
      };
    })()
  `;
}

function clickImmediateChatScript(): string {
  return `
    (async () => {
      ${helperSource}
      const blocker = blockerMessage();
      if (blocker) {
        return { ok: false, clicked: false, message: blocker, matchedCount: 0 };
      }
      const root = detailRoot();
      const clickableFor = (el) => el.closest?.("button,a,[role='button']") || el;
      const buildCandidates = (searchRoot) => Array.from(searchRoot.querySelectorAll("button,a,[role='button'],span,div"))
        .map((el) => {
          const text = textOf(el);
          const target = clickableFor(el);
          return { el, target, text };
        })
        .filter(({ el, target, text }) => {
          if (!text.includes("立即沟通")) return false;
          if (!visible(el) || !visible(target) || disabled(target)) return false;
          if (target.tagName !== "BUTTON" && target.tagName !== "A" && target.getAttribute("role") !== "button" && text.length > 20) return false;
          return true;
        });
      const nodes = [...buildCandidates(root), ...buildCandidates(document)];
      const uniqueCandidates = [];
      const seen = new Set();
      for (const item of nodes) {
        if (seen.has(item.target)) continue;
        seen.add(item.target);
        uniqueCandidates.push(item);
      }
      uniqueCandidates.sort((a, b) => {
        const aExact = a.text === "立即沟通" ? 0 : 1;
        const bExact = b.text === "立即沟通" ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.text.length - b.text.length;
      });
      const first = uniqueCandidates[0];
      if (!first) {
        return { ok: false, clicked: false, message: "当前页面没有找到可点击的“立即沟通”按钮。", matchedCount: 0 };
      }
      const clicked = clickElement(first.target);
      const handleStayDialog = async () => {
        if (!clicked) return { handled: false, message: "" };
        await wait(700);
        const pageText = bodyText();
        if (!/(留在此页|继续沟通|继续查看|离开此页)/.test(pageText)) {
          return { handled: false, message: "" };
        }
        const nodes = shortVisibleTextNodes(document);
        const stay = nodes.find((item) => item.text === "留在此页" || item.text.includes("留在此页"));
        if (!stay) {
          return { handled: false, message: "检测到沟通确认弹窗，但没有找到“留在此页”按钮。" };
        }
        const stayed = clickElement(stay.el);
        if (stayed) await wait(500);
        return {
          handled: stayed,
          message: stayed ? "已选择“留在此页”。" : "检测到沟通确认弹窗，但点击“留在此页”失败。"
        };
      };
      const stayDialog = await handleStayDialog();
      return {
        ok: clicked && (!stayDialog.message || stayDialog.handled),
        clicked,
        message: clicked
          ? ["已点击第一个可见的“立即沟通”按钮。", stayDialog.message].filter(Boolean).join(" ")
          : "找到了“立即沟通”，但点击失败。",
        matchedCount: uniqueCandidates.length
      };
    })()
  `;
}

function clickNextMessageConversationScript(visitedKeys: string[]): string {
  return `
    (async () => {
      ${helperSource}
      const visitedKeys = ${JSON.stringify(visitedKeys)};
      const isVisited = (key) => visitedKeys.includes(key);
      const conversationContainers = () => all(".chat-list, .message-list, .conversation-list, [class*='chat-list'], [class*='message-list'], [class*='conversation'], aside, main")
        .filter((el) => visible(el));
      const conversationItems = () => {
        const selectors = [
          ".chat-list li",
          ".message-list li",
          ".conversation-list li",
          "[class*='chat-list'] li",
          "[class*='message-list'] li",
          "[class*='conversation'] li",
          "[class*='chat'] [class*='item']",
          "[class*='message'] [class*='item']",
          "li"
        ];
        const seen = new Set();
        const items = [];
        for (const root of conversationContainers()) {
          for (const selector of selectors) {
            for (const el of all(selector, root)) {
              if (!visible(el) || disabled(el)) continue;
              const text = textOf(el);
              if (text.length < 8 || text.length > 500) continue;
              if (/(发送|常用语|表情|图片|简历|上传|筛选条件|职位描述|任职要求)/.test(text)) continue;
              const rect = el.getBoundingClientRect();
              const key = clean(text).slice(0, 160);
              const dedupeKey = key + "|" + Math.round(rect.top);
              if (seen.has(dedupeKey)) continue;
              seen.add(dedupeKey);
              items.push({ el, text, key });
            }
          }
        }
        return items;
      };
      const scrollContainer = () => conversationContainers().find((el) => el.scrollHeight > el.clientHeight + 80) || document.scrollingElement || document.documentElement;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const next = conversationItems().find((item) => !isVisited(item.key));
        if (next && clickElement(next.el)) {
          await wait(1000);
          return {
            ok: true,
            message: "已打开下一个消息会话。",
            conversationTitle: next.text.split(" ").slice(0, 4).join(" "),
            conversationPreview: next.text,
            conversationKey: next.key,
            messageUrl: location.href
          };
        }
        const target = scrollContainer();
        const before = target.scrollTop;
        target.scrollBy?.({ top: Math.max(360, target.clientHeight * 0.75), behavior: "smooth" });
        await wait(900);
        if (target.scrollTop === before) break;
      }

      return { ok: false, message: "没有找到更多未处理消息会话。", messageUrl: location.href };
    })()
  `;
}

function openLinkedJobFromMessageScript(): string {
  return `
    (async () => {
      ${helperSource}
      const blocker = blockerMessage();
      if (blocker) {
        return { ok: false, message: blocker };
      }
      const beforeUrl = location.href;
      const roots = all(".chat-content, .message-content, .dialog-content, [class*='chat'], [class*='message'], main, body")
        .filter((el) => visible(el));
      const candidates = [];
      const seen = new Set();
      for (const root of roots) {
        for (const el of all("a,button,[role='button'],li,div", root)) {
          if (!visible(el) || disabled(el)) continue;
          const text = textOf(el);
          if (!text || text.length > 260) continue;
          if (/(发送|常用语|表情|图片|交换微信|交换电话|打招呼|附件|简历)/.test(text)) continue;
          const looksExplicit = /(查看职位|职位详情|相关职位|沟通职位|招聘职位|岗位详情)/.test(text);
          const looksJobCard = /(K|薪|经验|本科|大专|硕士|博士|职位|岗位|招聘)/.test(text) && /(公司|经验|学历|K|薪)/.test(text);
          if (!looksExplicit && !looksJobCard) continue;
          const target = el.closest?.("a,button,[role='button'],li") || el;
          const key = text.slice(0, 120);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ el: target, text, explicit: looksExplicit });
        }
      }
      candidates.sort((a, b) => Number(b.explicit) - Number(a.explicit) || a.text.length - b.text.length);
      const first = candidates[0];
      if (!first) {
        return { ok: false, message: "当前会话没有找到关联岗位入口。" };
      }
      const clicked = clickElement(first.el);
      if (!clicked) {
        return { ok: false, message: "找到了关联岗位入口，但点击失败。" };
      }
      await wait(1600);
      const root = detailRoot();
      const detailText = textOf(root);
      const opened = location.href !== beforeUrl || /(职位描述|岗位职责|任职要求|工作内容|立即沟通)/.test(detailText);
      return {
        ok: opened,
        message: opened ? "已打开关联岗位。" : "点击关联岗位后没有进入岗位详情。",
        targetText: first.text
      };
    })()
  `;
}

function moveToNextJobScript(visited: Array<{ title: string; company: string; salary: string; signature: string }>): string {
  return `
    (async () => {
      ${helperSource}
      const visited = ${JSON.stringify(visited)};
      const listSelectors = [".job-list-box", ".job-list", ".search-job-result", ".job-list-container", ".job-card-list", "ul", "main", "body"];
      const cardSelectors = [".job-card-wrapper", ".job-card-body", ".job-card", ".job-primary", ".job-item", "li"];
      const isVisited = (text) => visited.some((job) => {
        const title = clean(job.title);
        const company = clean(job.company);
        const salary = clean(job.salary);
        if (title && company && text.includes(title) && text.includes(company)) return true;
        if (title && salary && text.includes(title) && text.includes(salary)) return true;
        return false;
      });
      const containers = () => listSelectors.flatMap((selector) => all(selector)).filter((el) => visible(el));
      const cardsIn = (container) => cardSelectors
        .flatMap((selector) => all(selector, container))
        .filter((el) => visible(el))
        .map((el) => ({ el, text: textOf(el) }))
        .filter((item) => item.text.length > 20 && item.text.length < 600);
      const uniqueCards = () => {
        const seen = new Set();
        const cards = [];
        for (const container of containers()) {
          for (const item of cardsIn(container)) {
            const key = item.text.slice(0, 120);
            if (seen.has(key)) continue;
            seen.add(key);
            cards.push(item);
          }
        }
        return cards;
      };
      const scrollTarget = () => containers().find((el) => el.scrollHeight > el.clientHeight + 80) || document.scrollingElement || document.documentElement;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const cards = uniqueCards();
        const next = cards.find((item) => !isVisited(item.text));
        if (next && clickElement(next.el)) {
          await wait(900);
          return { moved: true, message: "已切换到下一个岗位。" };
        }
        const target = scrollTarget();
        const before = target.scrollTop;
        target.scrollBy?.({ top: Math.max(400, target.clientHeight * 0.8), behavior: "smooth" });
        await wait(900);
        if (target.scrollTop === before) break;
      }
      return { moved: false, message: "没有找到下一个未处理岗位。" };
    })()
  `;
}
