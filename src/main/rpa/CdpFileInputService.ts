import type { WebContents } from "electron";
import type { LocatorSpec } from "../../shared/kuaishou/types";

function objectScript(specs: LocatorSpec[]): string {
  return `
    (() => {
      const specs = ${JSON.stringify(specs)};
      const clean = (text) => String(text || "").replace(/\\s+/g, " ").trim();
      const candidatesFor = (spec) => {
        if (spec.type === "css") return Array.from(document.querySelectorAll(spec.value));
        if (spec.type === "nearText") return Array.from(document.querySelectorAll(spec.target === "contenteditable" ? "[contenteditable='true']" : spec.target)).filter((el) => clean(el.closest("section,div,form,body")?.innerText).includes(spec.text));
        return [];
      };
      for (const spec of specs) {
        const item = candidatesFor(spec)[0];
        if (item) return item;
      }
      return null;
    })()
  `;
}

export class CdpFileInputService {
  constructor(private readonly webContents: WebContents) {}

  async setFiles(specs: LocatorSpec[], files: string[]): Promise<void> {
    const debuggerApi = this.webContents.debugger;
    let attachedHere = false;

    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
      attachedHere = true;
    }

    try {
      const evaluated = (await debuggerApi.sendCommand("Runtime.evaluate", {
        expression: objectScript(specs),
        objectGroup: "browser-workflow-forge",
        includeCommandLineAPI: false
      })) as { result?: { objectId?: string } };

      const objectId = evaluated.result?.objectId;
      if (!objectId) {
        throw new Error("File input element not found");
      }

      await debuggerApi.sendCommand("DOM.setFileInputFiles", {
        objectId,
        files
      });
      await debuggerApi
        .sendCommand("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function() {
            this.dispatchEvent(new Event("input", { bubbles: true }));
            this.dispatchEvent(new Event("change", { bubbles: true }));
          }`
        })
        .catch(() => undefined);
    } finally {
      await debuggerApi.sendCommand("Runtime.releaseObjectGroup", { objectGroup: "browser-workflow-forge" }).catch(() => undefined);
      if (attachedHere && debuggerApi.isAttached()) {
        debuggerApi.detach();
      }
    }
  }
}
