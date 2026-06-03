import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  FileText,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  Terminal
} from "lucide-react";
import type { ReactElement } from "react";
import type { LinkInfo, PageState, PingResult } from "../shared/types";

type ToolResult =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "title"; title: string }
  | { kind: "links"; links: LinkInfo[] }
  | { kind: "ping"; ping: PingResult }
  | { kind: "error"; message: string };

type Activity = {
  id: number;
  level: "info" | "warn" | "error";
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

const MAX_LOGS = 40;

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

export function App(): ReactElement {
  const browserSlotRef = useRef<HTMLDivElement | null>(null);
  const logIdRef = useRef(0);
  const [pageState, setPageState] = useState<PageState>(EMPTY_STATE);
  const [urlInput, setUrlInput] = useState("https://example.com");
  const [result, setResult] = useState<ToolResult>({ kind: "empty" });
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busyTool, setBusyTool] = useState<string | null>(null);

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
    void window.crawlWeb.browser.setBounds({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });
  }, []);

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
        pushLog("info", "Renderer connected to browser state");
      })
      .catch((error: unknown) => {
        pushLog("error", `Initial browser state failed: ${errorMessage(error)}`);
      });

    const unsubscribe = window.crawlWeb.browser.onStateChange((state) => {
      setPageState(state);
      if (state.url) {
        setUrlInput(state.url);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [pushLog]);

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

  const runTool = useCallback(
    async (tool: string, action: () => Promise<ToolResult>) => {
      setBusyTool(tool);

      try {
        const nextResult = await action();
        setResult(nextResult);
        pushLog("info", `${tool} completed`);
      } catch (error) {
        const message = errorMessage(error);
        setResult({ kind: "error", message });
        pushLog("error", `${tool} failed: ${message}`);
      } finally {
        setBusyTool(null);
      }
    },
    [pushLog]
  );

  const navigate = useCallback(async () => {
    await runTool("Navigate", async () => {
      const state = await window.crawlWeb.browser.navigate(urlInput);
      setPageState(state);
      return { kind: "url", url: state.url };
    });
  }, [runTool, urlInput]);

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
          {pageState.isLoading ? <Loader2 className="loading-icon" size={18} /> : null}
        </div>
        <div className="browser-status">
          <span>{hostLabel(pageState.url)}</span>
          <span>{pageState.title || "Untitled"}</span>
        </div>
        <div ref={browserSlotRef} className="browser-slot" />
      </section>

      <aside className="tool-pane" aria-label="自动化控制面板">
        <header className="tool-header">
          <div>
            <p className="eyebrow">Workbench</p>
            <h1>CrawlWebElectron</h1>
          </div>
          <span className={pageState.isLoading ? "state-pill loading" : "state-pill"}>{pageState.isLoading ? "Loading" : "Ready"}</span>
        </header>

        <section className="tool-section">
          <h2>Automation</h2>
          <div className="tool-grid">
            <button
              type="button"
              onClick={() => void runTool("Get URL", async () => ({ kind: "url", url: await window.crawlWeb.browser.getUrl() }))}
            >
              <Globe size={18} />
              <span>URL</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void runTool("Get title", async () => ({ kind: "title", title: await window.crawlWeb.browser.getTitle() }))
              }
            >
              <FileText size={18} />
              <span>Title</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void runTool("Extract links", async () => ({
                  kind: "links",
                  links: await window.crawlWeb.browser.extractLinks(100)
                }))
              }
            >
              <Link2 size={18} />
              <span>Links</span>
            </button>
            <button
              type="button"
              onClick={() => void runTool("IPC ping", async () => ({ kind: "ping", ping: await window.crawlWeb.debug.ping() }))}
            >
              <Bug size={18} />
              <span>Ping</span>
            </button>
          </div>
        </section>

        <section className="tool-section result-section">
          <h2>Result</h2>
          <ResultView result={result} busyTool={busyTool} />
        </section>

        <section className="tool-section log-section">
          <h2>
            <Terminal size={17} />
            Logs
          </h2>
          <div className="log-list">
            {activity.length === 0 ? <p className="muted">No renderer activity yet.</p> : null}
            {activity.map((item) => (
              <div className={`log-row ${item.level}`} key={item.id}>
                <time>{item.at}</time>
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function ResultView({ result, busyTool }: { result: ToolResult; busyTool: string | null }): ReactElement {
  if (busyTool) {
    return (
      <div className="result-box center">
        <Loader2 className="loading-icon" size={20} />
        <span>{busyTool}</span>
      </div>
    );
  }

  if (result.kind === "empty") {
    return <div className="result-box muted">No result selected.</div>;
  }

  if (result.kind === "error") {
    return <div className="result-box error">{result.message}</div>;
  }

  if (result.kind === "url") {
    return <pre className="result-box">{result.url}</pre>;
  }

  if (result.kind === "title") {
    return <pre className="result-box">{result.title || "Untitled"}</pre>;
  }

  if (result.kind === "ping") {
    return <pre className="result-box">{JSON.stringify(result.ping, null, 2)}</pre>;
  }

  return (
    <div className="result-box links-result">
      <div className="result-count">{result.links.length} links</div>
      {result.links.map((link, index) => (
        <div className="link-row" key={`${link.href}-${index}`}>
          <span>{link.text || "(no text)"}</span>
          <a href={link.href} title={link.href}>
            {link.href}
          </a>
        </div>
      ))}
    </div>
  );
}
