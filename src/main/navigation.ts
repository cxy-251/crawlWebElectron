const PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function normalizeNavigationUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("URL cannot be empty.");
  }

  if (trimmed === "about:blank") {
    return "about:blank";
  }

  const candidate = PROTOCOL_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https pages can be opened from the navigation bar.");
  }

  return parsed.href;
}

