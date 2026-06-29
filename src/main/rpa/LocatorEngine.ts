import type { WebContents } from "electron";
import type { LocatorSpec } from "../../shared/kuaishou/types";

export type LocatorAttempt = {
  locator: LocatorSpec;
  matchedCount: number;
  error?: string;
};

export type LocatorResolution = {
  locator: LocatorSpec | null;
  matchedCount: number;
  attempts: LocatorAttempt[];
};

function locatorScript(specs: LocatorSpec[], action: string, value?: string): string {
  return `
    (() => {
      const specs = ${JSON.stringify(specs)};
      const action = ${JSON.stringify(action)};
      const value = ${JSON.stringify(value || "")};
      const clean = (text) => String(text || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const candidatesFor = (spec) => {
        if (spec.type === "css") return Array.from(document.querySelectorAll(spec.value));
        if (spec.type === "placeholder") return Array.from(document.querySelectorAll("input,textarea")).filter((el) => clean(el.getAttribute("placeholder")).includes(spec.value));
        if (spec.type === "contentEditable") return Array.from(document.querySelectorAll("[contenteditable='true'],[contenteditable='plaintext-only']")).filter((el) => !spec.nearText || clean(el.closest("section,div,form,body")?.innerText).includes(spec.nearText));
        if (spec.type === "text") {
          const all = Array.from(document.querySelectorAll("button,a,span,div,label,p"));
          return all.filter((el) => spec.exact ? clean(el.innerText || el.textContent) === spec.value : clean(el.innerText || el.textContent).includes(spec.value));
        }
        if (spec.type === "role") {
          const all = Array.from(document.querySelectorAll("[role],button,a,input,textarea"));
          return all.filter((el) => {
            const role = el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" ? "link" : el.tagName === "INPUT" ? "textbox" : "");
            const name = clean(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.getAttribute("value") || el.getAttribute("placeholder"));
            return role === spec.role && (!spec.name || name.includes(spec.name));
          });
        }
        if (spec.type === "nearText") {
          const tag = spec.target === "contenteditable" ? "[contenteditable='true'],[contenteditable='plaintext-only']" : spec.target;
          return Array.from(document.querySelectorAll(tag)).filter((el) => clean(el.closest("section,div,form,body")?.innerText).includes(spec.text));
        }
        return [];
      };
      const attempts = [];
      let matched = null;
      for (const spec of specs) {
        try {
          const items = candidatesFor(spec);
          attempts.push({ locator: spec, matchedCount: items.length });
          if (!matched && items.length > 0) matched = { spec, element: items[0], count: items.length };
        } catch (error) {
          attempts.push({ locator: spec, matchedCount: 0, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (action === "resolve") return { locator: matched?.spec || null, matchedCount: matched?.count || 0, attempts };
      if (!matched) return { ok: false, text: "", visible: false, attempts, matchedCount: 0 };
      const el = matched.element;
      if (action === "exists") return { ok: true, attempts, matchedCount: matched.count };
      if (action === "visible") return { ok: visible(el), visible: visible(el), attempts, matchedCount: matched.count };
      if (action === "click") {
        el.click();
        return { ok: true, attempts, matchedCount: matched.count };
      }
      if (action === "fill" || action === "type") {
        if (el.isContentEditable) {
          el.textContent = value;
        } else if ("value" in el) {
          el.value = action === "type" ? String(el.value || "") + value : value;
        } else {
          el.textContent = value;
        }
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, attempts, matchedCount: matched.count };
      }
      if (action === "textContent") {
        return { ok: true, text: clean(el.value || el.innerText || el.textContent), attempts, matchedCount: matched.count };
      }
      return { ok: true, attempts, matchedCount: matched.count };
    })()
  `;
}

export class LocatorEngine {
  constructor(private readonly webContents: WebContents) {}

  async resolve(specs: LocatorSpec[]): Promise<LocatorResolution> {
    return this.webContents.executeJavaScript(locatorScript(specs, "resolve"), true) as Promise<LocatorResolution>;
  }

  async perform<T = { ok: boolean; matchedCount: number; attempts: LocatorAttempt[] }>(
    specs: LocatorSpec[],
    action: string,
    value?: string
  ): Promise<T> {
    return this.webContents.executeJavaScript(locatorScript(specs, action, value), true) as Promise<T>;
  }
}

