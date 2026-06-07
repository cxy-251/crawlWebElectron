const DANGEROUS_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;
const SINGLE_WORD_RE = /^[a-z0-9-]+$/i;

const SITE_SHORTCUTS: Record<string, string> = {
  bilibili: "https://www.bilibili.com",
  google: "https://www.google.com",
  twitter: "https://x.com",
  x: "https://x.com",
  youtube: "https://www.youtube.com"
};

function googleSearchUrl(query: string): string {
  const encoded = new URLSearchParams({ q: query });
  return `https://www.google.com/search?${encoded.toString()}`;
}

export function normalizeNavigationUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("URL cannot be empty.");
  }

  if (trimmed === "about:blank") {
    return "about:blank";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const parsed = new URL(trimmed);
    return parsed.href;
  }

  if (DANGEROUS_PROTOCOL_RE.test(trimmed)) {
    throw new Error("Only http and https pages can be opened from the navigation bar.");
  }

  const lower = trimmed.toLowerCase();
  const candidate = (() => {
    if (/\s/.test(trimmed)) {
      return googleSearchUrl(trimmed);
    }

    if (SITE_SHORTCUTS[lower]) {
      return SITE_SHORTCUTS[lower];
    }

    if (DOMAIN_RE.test(trimmed)) {
      return `https://${trimmed}`;
    }

    if (SINGLE_WORD_RE.test(trimmed)) {
      return `https://www.${trimmed}.com`;
    }

    return googleSearchUrl(trimmed);
  })();

  const parsed = new URL(candidate);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https pages can be opened from the navigation bar.");
  }

  return parsed.href;
}
