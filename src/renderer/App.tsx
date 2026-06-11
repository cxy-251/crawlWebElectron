import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  ClipboardList,
  Globe,
  Info,
  Link2,
  ListPlus,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  LayoutGrid
} from "lucide-react";
import type { ReactElement } from "react";
import { PublishPanel } from "./components/PublishPanel";
import type {
  PageState,
  QueueItem,
  ScrollScanState,
  SessionSummary,
  VideoCandidate,
  VideoCandidateStatus,
  VideoScanResult
} from "../shared/types";

type Activity = {
  id: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  at: string;
};

const EMPTY_STATE: PageState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false
};

const EMPTY_SCAN_STATE: ScrollScanState = {
  status: "idle",
  round: 0,
  maxRounds: 0,
  reason: "Ready"
};

const MAX_LOGS = 60;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "about:blank";
  }
}

function shortUrl(url: string): string {
  if (!url) {
    return "none";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 96);
  } catch {
    return url.slice(0, 96);
  }
}

function statusLabel(status: VideoCandidateStatus): string {
  return status.replace(/_/g, " ");
}

function mergeCandidates(
  current: VideoCandidate[],
  incoming: VideoCandidate[],
  selectedIds: Set<string>,
  queuedIds: Set<string>
): VideoCandidate[] {
  const byId = new Map(current.map((candidate) => [candidate.id, candidate]));

  for (const candidate of incoming) {
    const existing = byId.get(candidate.id);
    const status = queuedIds.has(candidate.id) ? "queued" : selectedIds.has(candidate.id) ? "selected" : existing?.status || candidate.status;

    byId.set(candidate.id, {
      ...existing,
      ...candidate,
      status
    });
  }

  return Array.from(byId.values());
}

export function App(): ReactElement {
  const browserSlotRef = useRef<HTMLDivElement | null>(null);
  const logIdRef = useRef(0);
  const lastBoundsRef = useRef({ x: -1, y: -1, width: -1, height: -1 });
  const [pageState, setPageState] = useState<PageState>(EMPTY_STATE);
  const [urlInput, setUrlInput] = useState("https://example.com");
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [scanState, setScanState] = useState<ScrollScanState>(EMPTY_SCAN_STATE);
  const [candidates, setCandidates] = useState<VideoCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"scraper" | "publish" | "logs">("publish");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const queuedSet = useMemo(() => new Set(queue.map((item) => item.id)), [queue]);
  const selectedCount = selectedIds.length;
  const scanBusy = scanState.status === "scanning";

  const pushLog = useCallback((level: Activity["level"], message: string) => {
    const next: Activity = {
      id: logIdRef.current++,
      level,
      message,
      at: new Date().toLocaleTimeString()
    };

    setActivity((current) => [next, ...current].slice(0, MAX_LOGS));
  }, []);

  const syncBounds = useCallback(() => {
    const element = browserSlotRef.current;

    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (
      x === lastBoundsRef.current.x &&
      y === lastBoundsRef.current.y &&
      width === lastBoundsRef.current.width &&
      height === lastBoundsRef.current.height
    ) {
      return;
    }

    lastBoundsRef.current = { x, y, width, height };
    void window.crawlWeb.browser.setBounds({ x, y, width, height });
  }, []);

  const applyScanResult = useCallback(
    (result: VideoScanResult) => {
      setCandidates((current) => mergeCandidates(current, result.candidates, selectedSet, queuedSet));

      if (result.manualActionDetected) {
        setScanState({
          status: "paused",
          round: scanState.round,
          maxRounds: scanState.maxRounds,
          reason: result.manualActionReason || "Manual action required"
        });
        pushLog("warn", `Paused for manual action: ${result.manualActionReason || "manual action required"}`);
      }

      pushLog(
        "info",
        `Scan found ${result.candidates.length} candidates on ${result.provider}; ${result.duplicateHintCount} duplicates ignored`
      );
    },
    [pushLog, queuedSet, scanState.maxRounds, scanState.round, selectedSet]
  );

  useEffect(() => {
    let disposed = false;

    window.crawlWeb.browser
      .getState()
      .then((state) => {
        if (disposed) {
          return;
        }

        setPageState(state);
        if (state.url) {
          setUrlInput(state.url);
        }
        pushLog("info", "Browser state connected");
      })
      .catch((error: unknown) => {
        pushLog("error", `Initial browser state failed: ${errorMessage(error)}`);
      });

    window.crawlWeb.browser
      .getSessionSummary()
      .then((summary) => {
        if (!disposed) {
          setSessionSummary(summary);
        }
      })
      .catch((error: unknown) => {
        pushLog("warn", `Session summary unavailable: ${errorMessage(error)}`);
      });

    const unsubscribeBrowser = window.crawlWeb.browser.onStateChange((state) => {
      setPageState(state);
      if (state.url) {
        setUrlInput(state.url);
      }
    });
    const unsubscribeScanState = window.crawlWeb.media.onScanStateChange((state) => {
      setScanState(state);
      pushLog(state.status === "error" ? "error" : state.status === "paused" ? "warn" : "info", `Scan ${state.status}: ${state.reason}`);
    });
    const unsubscribeScanUpdate = window.crawlWeb.media.onScrollScanUpdate((update) => {
      setScanState(update.state);
      applyScanResult(update.result);
      pushLog("info", `Scroll round ${update.round} merged`);
    });
    const unsubscribeUploadLog = window.crawlWeb.publish.onUploadLog((log) => {
      pushLog(log.level, `[Publish] ${log.message}`);
    });

    return () => {
      disposed = true;
      unsubscribeBrowser();
      unsubscribeScanState();
      unsubscribeScanUpdate();
      unsubscribeUploadLog();
    };
  }, [applyScanResult, pushLog]);

  useEffect(() => {
    const element = browserSlotRef.current;

    if (!element) {
      return undefined;
    }

    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    requestAnimationFrame(syncBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [syncBounds]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusyAction(label);

      try {
        await action();
      } catch (error) {
        pushLog("error", `${label} failed: ${errorMessage(error)}`);
      } finally {
        setBusyAction(null);
      }
    },
    [pushLog]
  );

  const navigate = useCallback(async () => {
    await runAction("Navigate", async () => {
      const state = await window.crawlWeb.browser.navigate(urlInput);
      setPageState(state);
      setUrlInput(state.url);
      pushLog("info", `Navigated to ${shortUrl(state.url)}`);
    });
  }, [pushLog, runAction, urlInput]);

  const navActions = useMemo(
    () => ({
      back: async () => {
        const state = await window.crawlWeb.browser.back();
        setPageState(state);
        pushLog("info", "Back requested");
      },
      forward: async () => {
        const state = await window.crawlWeb.browser.forward();
        setPageState(state);
        pushLog("info", "Forward requested");
      },
      reload: async () => {
        const state = await window.crawlWeb.browser.reload();
        setPageState(state);
        pushLog("info", "Reload requested");
      }
    }),
    [pushLog]
  );

  const scanCurrentPage = useCallback(async () => {
    await runAction("Scan viewport", async () => {
      const result = await window.crawlWeb.media.scanCurrentPage();
      applyScanResult(result);
    });
  }, [applyScanResult, runAction]);

  const startAutoScan = useCallback(async () => {
    await runAction("Auto scroll", async () => {
      const state = await window.crawlWeb.media.startScrollScan({ intervalMs: 1200, maxRounds: 12 });
      setScanState(state);
      pushLog("info", "Auto scroll scan started");
    });
  }, [pushLog, runAction]);

  const stopAutoScan = useCallback(async () => {
    await runAction("Stop scan", async () => {
      const state = await window.crawlWeb.media.stopScrollScan();
      setScanState(state);
      pushLog("warn", "Auto scroll scan stopped");
    });
  }, [pushLog, runAction]);

  const pauseAutoScan = useCallback(async () => {
    await runAction("Pause scan", async () => {
      const state = await window.crawlWeb.media.pauseScrollScan();
      setScanState(state);
      pushLog("warn", "Scan paused by user");
    });
  }, [pushLog, runAction]);

  const resumeAutoScan = useCallback(async () => {
    await runAction("Resume scan", async () => {
      const state = await window.crawlWeb.media.resumeScrollScan();
      setScanState(state);
      pushLog("info", "Scan resumed");
    });
  }, [pushLog, runAction]);

  const clearCandidates = useCallback(() => {
    setCandidates([]);
    setSelectedIds([]);
    pushLog("warn", "Candidates cleared");
  }, [pushLog]);

  const toggleCandidate = useCallback(
    (candidate: VideoCandidate) => {
      if (queuedSet.has(candidate.id)) {
        pushLog("warn", "Queued candidates cannot be toggled");
        return;
      }

      setSelectedIds((current) => {
        const exists = current.includes(candidate.id);
        return exists ? current.filter((id) => id !== candidate.id) : [...current, candidate.id];
      });
      setCandidates((current) =>
        current.map((item) => {
          if (item.id !== candidate.id) {
            return item;
          }

          return {
            ...item,
            status: item.status === "selected" ? "discovered" : "selected"
          };
        })
      );
    },
    [pushLog, queuedSet]
  );

  const addSelectedToQueue = useCallback(() => {
    const selected = candidates.filter((candidate) => selectedSet.has(candidate.id) && !queuedSet.has(candidate.id));

    if (selected.length === 0) {
      pushLog("warn", "No selected candidates to queue");
      return;
    }

    const addedAt = new Date().toISOString();
    const queueItems = selected.map((candidate): QueueItem => ({
      id: candidate.id,
      candidate: {
        ...candidate,
        status: "queued"
      },
      status: "queued",
      addedAt
    }));

    setQueue((current) => [...current, ...queueItems]);
    setCandidates((current) =>
      current.map((candidate) => (selectedSet.has(candidate.id) ? { ...candidate, status: "queued" } : candidate))
    );
    setSelectedIds([]);
    pushLog("info", `${queueItems.length} candidates queued for future download`);
  }, [candidates, pushLog, queuedSet, selectedSet]);

  return (
    <main className="app-shell">
      <section className="browser-pane" aria-label="网页浏览区">
        <div className="browser-toolbar">
          <button
            className="icon-button"
            type="button"
            title="后退"
            disabled={!pageState.canGoBack}
            onClick={() => void navActions.back()}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="前进"
            disabled={!pageState.canGoForward}
            onClick={() => void navActions.forward()}
          >
            <ArrowRight size={18} />
          </button>
          <button className="icon-button" type="button" title="刷新" onClick={() => void navActions.reload()}>
            <RefreshCw size={18} />
          </button>
          <form
            className="address-form"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate();
            }}
          >
            <Globe size={17} />
            <input
              aria-label="URL"
              value={urlInput}
              spellCheck={false}
              onChange={(event) => setUrlInput(event.target.value)}
            />
            <button className="go-button" type="submit" title="打开">
              <Send size={16} />
            </button>
          </form>
          {pageState.isLoading || busyAction === "Navigate" ? <Loader2 className="loading-icon" size={18} /> : null}
        </div>
        <div className="browser-status">
          <span>{hostLabel(pageState.url)}</span>
          <span>{pageState.title || "Untitled"}</span>
        </div>
        <div ref={browserSlotRef} className="browser-slot" />
      </section>

      <aside className="tool-pane" aria-label="视频采集控制面板">
        <header className="tool-header">
          <div className="tool-header-icon">
            <LayoutGrid size={18} />
          </div>
          <div className="tool-header-title">
            AUTOMATION WEBTOOL UI v4.0 <span style={{ color: '#38bdf8' }}>[GLOBAL DASHBOARD]</span>
          </div>
        </header>
        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === "scraper" ? "active" : ""}`}
            onClick={() => setActiveTab("scraper")}
          >
            <Search size={15} />
            Scraper
          </button>
          <button
            className={`tab-btn ${activeTab === "publish" ? "active" : ""}`}
            onClick={() => setActiveTab("publish")}
          >
            <Send size={15} />
            Publish
          </button>
          <button
            className={`tab-btn ${activeTab === "logs" ? "active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            <Terminal size={15} />
            Logs
          </button>
        </div>

        {activeTab === "scraper" && (
          <>
            <section className="status-strip" aria-label="当前状态">
              <Metric label="Page" value={hostLabel(pageState.url)} />
              <Metric label="Candidates" value={String(candidates.length)} />
              <Metric label="Selected" value={String(selectedCount)} />
              <Metric label="Queue" value={String(queue.length)} />
            </section>

            <section className="session-strip">
              <Info size={15} />
              <span>{sessionSummary ? `Session ${sessionSummary.partition}` : "Session loading"}</span>
              <span>{scanState.reason}</span>
            </section>

            <section className="control-bar" aria-label="扫描操作">
              <button type="button" onClick={() => void scanCurrentPage()} disabled={Boolean(busyAction)}>
                <Search size={17} />
                <span>Scan</span>
              </button>
              <button type="button" onClick={() => void startAutoScan()} disabled={scanBusy || Boolean(busyAction)}>
                <Play size={17} />
                <span>Auto</span>
              </button>
              <button type="button" onClick={() => void stopAutoScan()} disabled={!scanBusy && scanState.status !== "paused"}>
                <Square size={17} />
                <span>Stop</span>
              </button>
              <button type="button" onClick={() => void pauseAutoScan()} disabled={!scanBusy}>
                <Pause size={17} />
                <span>Pause</span>
              </button>
              <button type="button" onClick={() => void resumeAutoScan()} disabled={scanState.status !== "paused"}>
                <Play size={17} />
                <span>Resume</span>
              </button>
              <button type="button" onClick={clearCandidates} disabled={candidates.length === 0}>
                <Trash2 size={17} />
                <span>Clear</span>
              </button>
              <button type="button" onClick={addSelectedToQueue} disabled={selectedCount === 0}>
                <ListPlus size={17} />
                <span>Queue</span>
              </button>
            </section>

            <section className="candidate-section">
              <h2>
                <Link2 size={17} />
                Candidates
              </h2>
              <div className="candidate-list">
                {candidates.length === 0 ? <p className="muted">No candidates.</p> : null}
                {candidates.map((candidate) => (
                  <CandidateRow
                    candidate={candidate}
                    checked={selectedSet.has(candidate.id)}
                    queued={queuedSet.has(candidate.id)}
                    key={candidate.id}
                    onOpen={() => void window.crawlWeb.browser.navigate(candidate.pageUrl)}
                    onToggle={() => toggleCandidate(candidate)}
                  />
                ))}
              </div>
            </section>

            <section className="queue-section">
              <h2>
                <ClipboardList size={17} />
                Queue
              </h2>
              <div className="queue-list">
                {queue.length === 0 ? <p className="muted">No queued candidates.</p> : null}
                {queue.map((item) => (
                  <div className="queue-row" key={item.id}>
                    <span>{item.candidate.title}</span>
                    <strong>{statusLabel(item.status)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === "publish" && (
          <PublishPanel />
        )}

        {activeTab === "logs" && (
          <section className="log-section flex-1 h-full">
            <h2>
              <Terminal size={17} />
              Logs
            </h2>
            <div className="log-list h-full">
              {activity.length === 0 ? <p className="muted">No activity yet.</p> : null}
              {activity.map((item) => (
                <div className={`log-row ${item.level}`} key={item.id}>
                  <time>{item.at}</time>
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CandidateRow({
  candidate,
  checked,
  queued,
  onOpen,
  onToggle
}: {
  candidate: VideoCandidate;
  checked: boolean;
  queued: boolean;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement {
  return (
    <div className={`candidate-row ${queued ? "queued" : ""}`}>
      <button className="check-button" type="button" title={checked ? "取消选择" : "选择"} disabled={queued} onClick={onToggle}>
        {checked || queued ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </button>
      <div className="candidate-main">
        <div className="candidate-title">{candidate.title}</div>
        <div className="candidate-meta">
          <span>{candidate.provider}</span>
          <span>{candidate.extractionMethod}</span>
          <span>{Math.round(candidate.confidence * 100)}%</span>
          <span>{statusLabel(candidate.status)}</span>
        </div>
        <div className="candidate-links">
          <span>{shortUrl(candidate.pageUrl)}</span>
          <span>{candidate.mediaUrl ? shortUrl(candidate.mediaUrl) : "no media url"}</span>
          <span>{candidate.thumbnailUrl ? shortUrl(candidate.thumbnailUrl) : "no thumbnail"}</span>
          {candidate.durationText ? <span>{candidate.durationText}</span> : null}
        </div>
      </div>
      <button className="open-button" type="button" title="在左侧打开" onClick={onOpen}>
        <Globe size={16} />
      </button>
      {candidate.status === "paused_for_manual_action" ? <ShieldAlert className="manual-icon" size={17} /> : null}
    </div>
  );
}
