import { ExternalLink, Filter, MessageCircle, RefreshCw, Search, SquareStack } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  BossZhipinBatchMode,
  BossZhipinBatchResult,
  BossZhipinDetection,
  BossZhipinFilterOptionsResult,
  BossZhipinFilterResult,
  BossZhipinFilters,
  BossZhipinJobInfo,
  BossZhipinMessageRunResult,
  BrowserAutomationActionResult
} from "../../../main/browser-automation/types";
import { Button } from "../../shared/components/Button";
import { Card } from "../../shared/components/Card";
import { Input } from "../../shared/components/Input";

const DEFAULT_BOSS_URL = "https://www.zhipin.com/web/geek/job";

type BrowserState = {
  url: string;
  title: string;
};

const filterFields: Array<{ key: keyof BossZhipinFilters; label: string; placeholder: string }> = [
  { key: "location", label: "地区", placeholder: "如：北京" },
  { key: "jobType", label: "求职类型", placeholder: "如：全职" },
  { key: "salary", label: "薪资待遇", placeholder: "如：20-40K" },
  { key: "experience", label: "工作经验", placeholder: "如：3-5年" },
  { key: "education", label: "学历要求", placeholder: "如：本科" },
  { key: "companySize", label: "公司规模", placeholder: "如：100-499人" }
];

const emptyFilterOptions: Record<keyof BossZhipinFilters, string[]> = {
  location: [],
  jobType: ["全职", "兼职", "实习"],
  salary: ["薪资不限", "3K以下", "3-5K", "5-10K", "10-20K", "20-50K", "50K以上"],
  experience: ["经验不限", "在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"],
  education: ["学历不限", "初中及以下", "中专/中技", "高中", "大专", "本科", "硕士", "博士"],
  companySize: ["规模不限", "0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"]
};

export function BossZhipinCommunicationPanel() {
  const [targetUrl, setTargetUrl] = useState(DEFAULT_BOSS_URL);
  const [browserState, setBrowserState] = useState<BrowserState>({ url: "", title: "" });
  const [filters, setFilters] = useState<BossZhipinFilters>({});
  const [maxJobs, setMaxJobs] = useState(10);
  const [maxConversations, setMaxConversations] = useState(20);
  const [singleClickResult, setSingleClickResult] = useState<BrowserAutomationActionResult | null>(null);
  const [detection, setDetection] = useState<BossZhipinDetection | null>(null);
  const [filterOptions, setFilterOptions] = useState<BossZhipinFilterOptionsResult | null>(null);
  const [filterResult, setFilterResult] = useState<BossZhipinFilterResult | null>(null);
  const [currentJob, setCurrentJob] = useState<BossZhipinJobInfo | null>(null);
  const [batchResult, setBatchResult] = useState<BossZhipinBatchResult | null>(null);
  const [messageRunResult, setMessageRunResult] = useState<BossZhipinMessageRunResult | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void refreshState();
  }, []);

  async function runAction<T>(label: string, action: () => Promise<T>): Promise<T | null> {
    setBusyLabel(label);
    setError("");
    try {
      return await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      return null;
    } finally {
      setBusyLabel("");
    }
  }

  async function refreshState() {
    const state = await runAction("刷新中", () => window.appApi.browser.getState());
    if (state) {
      setBrowserState(state);
    }
    const pageDetection = await runAction("识别页面中", () => window.appApi.browserAutomation.boss.detectPage());
    if (pageDetection) {
      setDetection(pageDetection);
    }
  }

  async function openBossPage() {
    const state = await runAction("打开中", () => window.appApi.browserAutomation.boss.openBossPage(targetUrl));
    if (state) {
      setBrowserState(state);
      setSingleClickResult(null);
      setDetection(null);
      setFilterOptions(null);
      setFilterResult(null);
      setCurrentJob(null);
      setBatchResult(null);
      setMessageRunResult(null);
      void refreshState();
    }
  }

  async function openMessagesPage() {
    const state = await runAction("打开消息中", () => window.appApi.browserAutomation.boss.openMessagesPage());
    if (state) {
      setBrowserState(state);
      setSingleClickResult(null);
      setDetection(null);
      setCurrentJob(null);
      setBatchResult(null);
      setMessageRunResult(null);
      void refreshState();
    }
  }

  async function clickImmediateChat() {
    const actionResult = await runAction("点击中", () => window.appApi.browserAutomation.boss.clickFirstImmediateChat());
    if (actionResult) {
      setSingleClickResult(actionResult);
      setBrowserState({
        url: actionResult.currentUrl,
        title: actionResult.title
      });
    }
  }

  async function applyFilters() {
    const result = await runAction("应用筛选中", () => window.appApi.browserAutomation.boss.applyFilters(cleanFilters(filters)));
    if (result) {
      setFilterResult(result);
      setBrowserState({
        url: result.currentUrl,
        title: result.title
      });
    }
  }

  async function readFilterOptions() {
    const result = await runAction("读取候选中", () => window.appApi.browserAutomation.boss.readFilterOptions());
    if (result) {
      setFilterOptions(result);
      setBrowserState({
        url: result.currentUrl,
        title: result.title
      });
    }
  }

  async function collectCurrentJob() {
    const job = await runAction("采集中", () => window.appApi.browserAutomation.boss.collectCurrentJob());
    if (job) {
      setCurrentJob(job);
    }
  }

  async function runBatch(mode: BossZhipinBatchMode) {
    const labels: Record<BossZhipinBatchMode, string> = {
      collect: "批量采集中",
      chat: "批量沟通中",
      collect_and_chat: "采集并沟通中"
    };
    const result = await runAction(labels[mode], () =>
      window.appApi.browserAutomation.boss.runBatch({
        filters: cleanFilters(filters),
        maxJobs,
        mode,
        applyFilters: false,
        continueOnFilterFailure: true
      })
    );
    if (result) {
      setBatchResult(result);
      setBrowserState({
        url: result.currentUrl,
        title: result.title
      });
      setCurrentJob(result.items.at(-1) || null);
      setDetection(result.detection);
    }
  }

  async function collectMessageJobs() {
    const result = await runAction("采集消息关联岗位中", () =>
      window.appApi.browserAutomation.boss.collectMessageJobs({
        maxConversations
      })
    );
    if (result) {
      setMessageRunResult(result);
      setBrowserState({
        url: result.currentUrl,
        title: result.title
      });
      setDetection(result.detection);
      setCurrentJob([...result.items].reverse().find((item) => item.job)?.job || null);
    }
  }

  function updateFilter(field: keyof BossZhipinFilters, value: string) {
    setFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  const busy = busyLabel.length > 0;

  return (
    <div className="space-y-4">
      <Card title="Boss 直聘">
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase text-slate-500" htmlFor="boss-url">
            目标页面
          </label>
          <Input id="boss-url" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void openBossPage()} disabled={busy}>
              <ExternalLink size={16} />
              打开 Boss 直聘
            </Button>
            <Button onClick={() => void openMessagesPage()} disabled={busy}>
              <MessageCircle size={16} />
              打开 Boss 消息
            </Button>
            <Button onClick={() => void refreshState()} disabled={busy}>
              <RefreshCw size={16} />
              刷新当前页面状态
            </Button>
            <Button onClick={() => void clickImmediateChat()} disabled={busy}>
              <MessageCircle size={16} />
              点击一个立即沟通
            </Button>
          </div>
          {busy ? <p className="text-sm text-slate-500">{busyLabel}</p> : null}
          {detection ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <InfoRow label="状态" value={pageTypeLabel(detection.pageType)} />
              <InfoRow label="可批量" value={detection.canRunBatch ? "可以" : "不可以"} />
              {detection.riskMessage ? <p className="mt-2 text-amber-700">{detection.riskMessage}</p> : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="筛选条件">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3">
            {filterFields.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">{field.label}</span>
                {field.key === "location" ? (
                  <>
                    <Input
                      value={filters[field.key] || ""}
                      placeholder={field.placeholder}
                      list={`boss-${field.key}-options`}
                      onChange={(event) => updateFilter(field.key, event.target.value)}
                    />
                    <datalist id={`boss-${field.key}-options`}>
                      {(filterOptions?.options.location || []).map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <select
                    value={filters[field.key] || ""}
                    onChange={(event) => updateFilter(field.key, event.target.value)}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                  >
                    <option value="">不修改</option>
                    {(filterOptions?.options[field.key] || emptyFilterOptions[field.key]).map((option) => (
                      <option key={`${field.key}-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">处理岗位数</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={maxJobs}
                onChange={(event) => setMaxJobs(Math.max(1, Number(event.target.value) || 1))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void readFilterOptions()} disabled={busy}>
              <Filter size={16} />
              读取筛选候选
            </Button>
            <Button onClick={() => void applyFilters()} disabled={busy}>
              <Filter size={16} />
              应用筛选
            </Button>
            <Button onClick={() => void collectCurrentJob()} disabled={busy}>
              <Search size={16} />
              采集当前岗位
            </Button>
          </div>
          {filterOptions ? (
            <p className={filterOptions.ok ? "text-sm text-emerald-700" : "text-sm text-amber-700"}>{filterOptions.message}</p>
          ) : null}
          {filterResult ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className={filterResult.ok ? "text-emerald-700" : "text-amber-700"}>{filterResult.message}</p>
              {filterResult.applied.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {filterResult.applied.map((item) => (
                    <li key={`${item.field}-${item.value}`} className={item.ok ? "text-slate-700" : "text-amber-700"}>
                      {item.value}：{item.message}
                      {!item.ok && item.candidates?.length ? (
                        <p className="mt-1 text-xs text-slate-500">候选：{item.candidates.slice(0, 12).join(" / ")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="批量运行">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            批量按钮会使用当前左侧页面状态运行；可以先手动设置筛选条件，再直接执行。涉及沟通的批量模式会自动选择“留在此页”，并为降低账号风险限制单次处理数量。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void runBatch("collect")} disabled={busy}>
              <Search size={16} />
              批量采集
            </Button>
            <Button onClick={() => void runBatch("chat")} disabled={busy}>
              <MessageCircle size={16} />
              批量沟通
            </Button>
            <Button variant="primary" onClick={() => void runBatch("collect_and_chat")} disabled={busy}>
              <SquareStack size={16} />
              采集并沟通
            </Button>
          </div>
        </div>
      </Card>

      <Card title="消息页岗位采集">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">从 Boss 消息列表按当前顺序处理会话，打开关联岗位并采集岗位信息，不发送消息。</p>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">消息会话数</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={maxConversations}
                onChange={(event) => setMaxConversations(Math.max(1, Number(event.target.value) || 1))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void openMessagesPage()} disabled={busy}>
              <MessageCircle size={16} />
              打开 Boss 消息
            </Button>
            <Button variant="primary" onClick={() => void collectMessageJobs()} disabled={busy}>
              <SquareStack size={16} />
              采集消息关联岗位
            </Button>
          </div>
          {messageRunResult ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <InfoRow label="采集" value={String(messageRunResult.collectedCount)} />
                <InfoRow label="失败" value={String(messageRunResult.failedCount)} />
              </div>
              <InfoRow label="停止" value={messageRunResult.stopReason} />
              <InfoRow label="文件" value={messageRunResult.outputPath || "-"} />
              {messageRunResult.items.slice(-5).map((item) => (
                <div key={`${item.index}-${item.conversationKey}`} className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="font-medium text-slate-900">
                    {item.index}. {item.conversationTitle || "未识别会话"}
                  </p>
                  <p className="text-slate-600">{item.job ? [item.job.title, item.job.company].filter(Boolean).join(" · ") : item.errorMessage}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="当前页面">
        <div className="space-y-2 text-sm">
          <InfoRow label="标题" value={browserState.title || "未读取"} />
          <InfoRow label="地址" value={browserState.url || "未读取"} />
        </div>
      </Card>

      <Card title="采集结果">
        {currentJob ? (
          <div className="space-y-3 text-sm">
            <div className="space-y-2">
              <InfoRow label="岗位" value={currentJob.title || "-"} />
              <InfoRow label="公司" value={currentJob.company || "-"} />
              <InfoRow label="薪资" value={currentJob.salary || "-"} />
              <InfoRow label="薪资原文" value={currentJob.salaryRaw || "-"} />
              <InfoRow label="薪资解码" value={salaryStatusLabel(currentJob.salaryDecodeStatus)} />
              <InfoRow label="地点" value={currentJob.location || "-"} />
              <InfoRow label="经验" value={currentJob.experience || "-"} />
              <InfoRow label="学历" value={currentJob.education || "-"} />
              <InfoRow label="规模" value={currentJob.companySize || "-"} />
              <InfoRow label="行业" value={currentJob.industry || "-"} />
              <InfoRow label="标签" value={currentJob.tags?.length ? currentJob.tags.join(" / ") : "-"} />
            </div>
            <TextBlock title="岗位职责 / 工作内容" text={currentJob.responsibilities} />
            <TextBlock title="任职要求" text={currentJob.requirements} />
            <TextBlock title="福利待遇" text={currentJob.benefits} />
            <TextBlock title="公司介绍" text={currentJob.companyInfo} />
            <TextBlock title="JD 原文" text={currentJob.jdText || currentJob.rawText} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">暂无岗位采集结果</p>
        )}
      </Card>

      <Card title="循环运行">
        {batchResult ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="模式" value={batchModeLabel(batchResult.mode)} />
              <InfoRow label="采集" value={String(batchResult.collectedCount)} />
              <InfoRow label="沟通" value={String(batchResult.chatClickedCount)} />
            </div>
            {batchResult.warnings.length > 0 ? <p className="text-amber-700">警告：{batchResult.warnings.join("；")}</p> : null}
            <InfoRow label="停止" value={batchResult.stopReason} />
            <InfoRow label="文件" value={batchResult.outputPath || "-"} />
            {batchResult.items.length > 0 ? (
              <div className="space-y-2">
                {batchResult.items.slice(-5).map((item) => (
                  <div key={`${item.index}-${item.signature}`} className="rounded-md border border-slate-200 p-2">
                    <p className="font-medium text-slate-900">
                      {item.index}. {item.title || "未识别岗位"}
                    </p>
                    <p className="text-slate-600">{[item.company, item.salary].filter(Boolean).join(" · ") || "-"}</p>
                    <p className={item.chatClicked ? "text-emerald-700" : "text-amber-700"}>{item.chatMessage}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">暂无循环运行结果</p>
        )}
      </Card>

      <Card title="最近操作">
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {singleClickResult ? (
          <div className="space-y-2 text-sm">
            <InfoRow label="状态" value={singleClickResult.ok ? "成功" : "未完成"} />
            <InfoRow label="点击" value={singleClickResult.clicked ? "已点击" : "未点击"} />
            <InfoRow label="候选数" value={String(singleClickResult.matchedCount)} />
            <p className={singleClickResult.ok ? "text-emerald-700" : "text-amber-700"}>{singleClickResult.message}</p>
          </div>
        ) : !error ? (
          <p className="text-sm text-slate-500">暂无单次点击结果</p>
        ) : null}
      </Card>
    </div>
  );
}

function cleanFilters(filters: BossZhipinFilters): BossZhipinFilters {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""])
      .filter(([, value]) => value)
  ) as BossZhipinFilters;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="break-words text-slate-900">{value}</span>
    </div>
  );
}

function pageTypeLabel(pageType: BossZhipinDetection["pageType"]): string {
  const labels: Record<BossZhipinDetection["pageType"], string> = {
    job_list: "职位列表",
    job_detail: "职位详情",
    message_list: "消息列表",
    message_chat: "消息会话",
    login: "需要登录",
    verification: "需要验证",
    forbidden_403: "访问受限",
    unknown: "未知"
  };
  return labels[pageType];
}

function batchModeLabel(mode: BossZhipinBatchMode): string {
  const labels: Record<BossZhipinBatchMode, string> = {
    collect: "只采集",
    chat: "只沟通",
    collect_and_chat: "采集并沟通"
  };
  return labels[mode];
}

function salaryStatusLabel(status: BossZhipinJobInfo["salaryDecodeStatus"]): string {
  const labels: Record<BossZhipinJobInfo["salaryDecodeStatus"], string> = {
    decoded: "已解码",
    raw: "保留原文",
    unsupported: "无法可信解码",
    empty: "未识别"
  };
  return labels[status];
}

function TextBlock({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-semibold text-slate-500">{title}</p>
      <p className="max-h-56 overflow-auto whitespace-pre-wrap text-slate-800">{text}</p>
    </div>
  );
}
