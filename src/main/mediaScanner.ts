import type { WebContents } from "electron";
import crypto from "node:crypto";
import type { VideoCandidate, VideoExtractionMethod, VideoScanResult } from "../shared/types";

type RawVideoCandidate = {
  sourcePageUrl?: string;
  provider?: string;
  title?: string;
  pageUrl?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  durationText?: string;
  extractionMethod?: VideoExtractionMethod;
  confidence?: number;
};

type RawScanResult = {
  sourcePageUrl?: string;
  provider?: string;
  title?: string;
  candidates?: RawVideoCandidate[];
  manualActionDetected?: boolean;
  manualActionReason?: string;
};

type ScrollMetrics = {
  scrollY: number;
  innerHeight: number;
  scrollHeight: number;
};

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function url(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "blob:") {
      return parsed.href;
    }
  } catch {
    return "";
  }

  return "";
}

function confidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function providerFromUrl(sourcePageUrl: string): string {
  try {
    const host = new URL(sourcePageUrl).hostname.replace(/^www\./, "");

    if (host.includes("youtube.")) {
      return "youtube";
    }

    if (host.includes("bilibili.")) {
      return "bilibili";
    }

    if (host.includes("x.com") || host.includes("twitter.")) {
      return "x";
    }

    return host || "generic";
  } catch {
    return "generic";
  }
}

function candidateId(candidate: Omit<VideoCandidate, "id" | "status">): string {
  const seed = candidate.mediaUrl || candidate.pageUrl || `${candidate.sourcePageUrl}|${candidate.title}|${candidate.thumbnailUrl}`;
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function normalizeCandidate(raw: RawVideoCandidate, sourcePageUrl: string, provider: string): VideoCandidate | null {
  const pageUrl = url(raw.pageUrl) || sourcePageUrl;
  const mediaUrl = url(raw.mediaUrl);
  const thumbnailUrl = url(raw.thumbnailUrl);
  const title = text(raw.title, 180) || "Untitled video candidate";
  const extractionMethod = raw.extractionMethod || "video-card-link";

  if (!mediaUrl && !pageUrl && !thumbnailUrl && title === "Untitled video candidate") {
    return null;
  }

  const base = {
    sourcePageUrl,
    provider: text(raw.provider, 80) || provider,
    title,
    pageUrl,
    mediaUrl,
    thumbnailUrl,
    durationText: text(raw.durationText, 40),
    extractionMethod,
    confidence: confidence(raw.confidence)
  };

  return {
    id: candidateId(base),
    ...base,
    status: "discovered"
  };
}

function extractionScript(): string {
  return `
    (() => {
      const sourcePageUrl = location.href;
      const host = location.hostname.replace(/^www\\./, "");
      const provider = host.includes("youtube.") ? "youtube" : host.includes("bilibili.") ? "bilibili" : host || "generic";
      const visibleText = (document.body?.innerText || "").replace(/\\s+/g, " ").trim();
      const lowerText = visibleText.toLowerCase();
      const manualChecks = [
        ["robot", "robot check"],
        ["captcha", "captcha challenge"],
        ["unusual traffic", "unusual traffic challenge"],
        ["verify you are human", "human verification"],
        ["confirm you're not a bot", "bot verification"],
        ["confirm you’re not a bot", "bot verification"],
        ["sign in to confirm", "sign-in verification"],
        ["enable cookies", "cookie verification"],
        ["访问验证", "manual verification"],
        ["人机验证", "manual verification"],
        ["安全验证", "manual verification"]
      ];
      const manualMatch = manualChecks.find(([needle]) => lowerText.includes(needle));
      const abs = (value) => {
        if (!value) return "";
        try { return new URL(value, location.href).href; } catch { return ""; }
      };
      const clean = (value, limit = 160) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
      const nearbyText = (element) => {
        const labels = [
          element.getAttribute?.("aria-label"),
          element.getAttribute?.("title"),
          element.closest?.("a")?.getAttribute?.("aria-label"),
          element.closest?.("a")?.getAttribute?.("title"),
          element.closest?.("article")?.innerText,
          element.closest?.("[role='listitem']")?.innerText,
          element.closest?.("ytd-rich-item-renderer")?.innerText,
          element.closest?.("ytd-video-renderer")?.innerText,
          element.parentElement?.innerText
        ];
        return clean(labels.find(Boolean) || document.title || "Untitled video candidate");
      };
      const durationFrom = (text) => {
        const match = clean(text, 260).match(/\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b/);
        return match ? match[0] : "";
      };
      const candidates = [];
      const push = (item) => {
        if (candidates.length < 240) candidates.push(item);
      };

      Array.from(document.querySelectorAll("video")).forEach((video) => {
        const mediaUrl = abs(video.currentSrc || video.src || video.querySelector("source[src]")?.src);
        const title = nearbyText(video);
        push({
          sourcePageUrl,
          provider,
          title,
          pageUrl: abs(video.closest("a[href]")?.href) || sourcePageUrl,
          mediaUrl,
          thumbnailUrl: abs(video.poster),
          durationText: durationFrom(title),
          extractionMethod: "dom-video",
          confidence: mediaUrl ? 0.95 : 0.7
        });
      });

      Array.from(document.querySelectorAll("source[src]")).forEach((source) => {
        const mediaUrl = abs(source.src);
        if (!mediaUrl || !/(\\.mp4|\\.webm|\\.m3u8|\\.mov|video|mime=video)/i.test(mediaUrl + " " + (source.type || ""))) return;
        const title = nearbyText(source);
        push({
          sourcePageUrl,
          provider,
          title,
          pageUrl: abs(source.closest("a[href]")?.href) || sourcePageUrl,
          mediaUrl,
          thumbnailUrl: abs(source.closest("video")?.poster),
          durationText: durationFrom(title),
          extractionMethod: "dom-source",
          confidence: 0.9
        });
      });

      const cardSelector = [
        "a[href*='watch']",
        "a[href*='/shorts/']",
        "a[href*='/video/']",
        "a[href*='/videos/']",
        "a[href*='/reel/']",
        "a[href*='/embed/']"
      ].join(",");
      Array.from(document.querySelectorAll(cardSelector)).slice(0, 180).forEach((anchor) => {
        const pageUrl = abs(anchor.href);
        if (!pageUrl) return;
        const scope = anchor.closest("article") || anchor.closest("[role='listitem']") || anchor.closest("ytd-rich-item-renderer") || anchor.closest("ytd-video-renderer") || anchor.parentElement || anchor;
        const title = clean(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.innerText || scope?.innerText || document.title);
        const image = scope?.querySelector?.("img[src], img[data-src]");
        const thumbnailUrl = abs(image?.currentSrc || image?.src || image?.getAttribute?.("data-src"));
        push({
          sourcePageUrl,
          provider,
          title,
          pageUrl,
          mediaUrl: "",
          thumbnailUrl,
          durationText: durationFrom(scope?.innerText || title),
          extractionMethod: "video-card-link",
          confidence: thumbnailUrl ? 0.74 : 0.62
        });
      });

      return {
        sourcePageUrl,
        provider,
        title: document.title || "",
        candidates,
        manualActionDetected: Boolean(manualMatch),
        manualActionReason: manualMatch ? manualMatch[1] : ""
      };
    })()
  `;
}

export async function scanVideoCandidates(webContents: WebContents): Promise<VideoScanResult> {
  const raw = (await webContents.executeJavaScript(extractionScript(), true)) as RawScanResult;
  const sourcePageUrl = url(raw.sourcePageUrl) || webContents.getURL();
  const provider = text(raw.provider, 80) || providerFromUrl(sourcePageUrl);
  const seen = new Set<string>();
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .map((candidate) => normalizeCandidate(candidate, sourcePageUrl, provider))
    .filter((candidate): candidate is VideoCandidate => Boolean(candidate))
    .filter((candidate) => {
      if (seen.has(candidate.id)) {
        return false;
      }

      seen.add(candidate.id);
      return true;
    })
    .slice(0, 200);

  return {
    sourcePageUrl,
    provider,
    title: text(raw.title, 180) || webContents.getTitle(),
    candidates,
    duplicateHintCount: Math.max(0, (raw.candidates?.length || 0) - candidates.length),
    manualActionDetected: Boolean(raw.manualActionDetected),
    manualActionReason: text(raw.manualActionReason, 120),
    scannedAt: new Date().toISOString()
  };
}

export async function scrollPage(webContents: WebContents): Promise<ScrollMetrics> {
  return (await webContents.executeJavaScript(
    `
      (() => {
        window.scrollBy({ top: Math.max(600, Math.floor(window.innerHeight * 0.85)), behavior: "smooth" });
        return {
          scrollY: Math.round(window.scrollY),
          innerHeight: Math.round(window.innerHeight),
          scrollHeight: Math.round(document.documentElement.scrollHeight || document.body.scrollHeight || 0)
        };
      })()
    `,
    true
  )) as ScrollMetrics;
}

export async function getScrollMetrics(webContents: WebContents): Promise<ScrollMetrics> {
  return (await webContents.executeJavaScript(
    `
      (() => ({
        scrollY: Math.round(window.scrollY),
        innerHeight: Math.round(window.innerHeight),
        scrollHeight: Math.round(document.documentElement.scrollHeight || document.body.scrollHeight || 0)
      }))()
    `,
    true
  )) as ScrollMetrics;
}
