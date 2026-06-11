import type { WebContents } from "electron";
import { logger } from "../logger";

export class CDPHelper {
  constructor(private readonly webContents: WebContents) { }

  public attach(): void {
    try {
      if (!this.webContents.debugger.isAttached()) {
        this.webContents.debugger.attach("1.3");
        logger.info("cdp", "debugger attached");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("cdp", "failed to attach debugger", { error: msg });
      throw err;
    }
  }

  public detach(): void {
    try {
      if (this.webContents.debugger.isAttached()) {
        this.webContents.debugger.detach();
        logger.info("cdp", "debugger detached");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("cdp", "failed to detach debugger", { error: msg });
    }
  }

  public async setFileInputFiles(selector: string, absoluteFilePaths: string[]): Promise<void> {
    try {
      this.attach();

      // 1. Get the Document Root
      const doc = await this.webContents.debugger.sendCommand("DOM.getDocument");

      // 2. Query for the input element
      const node = await this.webContents.debugger.sendCommand("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector
      });

      if (!node || !node.nodeId) {
        throw new Error(`Element not found for selector: ${selector}`);
      }

      // 3. Set the files
      await this.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
        nodeId: node.nodeId,
        files: absoluteFilePaths
      });

      logger.info("cdp", `Successfully set file input for selector ${selector}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("cdp", `setFileInputFiles failed for selector ${selector}`, { error: msg });
      throw err;
    }
  }

  public async simulateClick(selector: string): Promise<void> {
    try {
      this.attach();
      const doc = await this.webContents.debugger.sendCommand("DOM.getDocument");
      const node = await this.webContents.debugger.sendCommand("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector
      });
      if (!node || !node.nodeId) throw new Error(`Element not found: ${selector}`);
      
      const box = await this.webContents.debugger.sendCommand("DOM.getBoxModel", { nodeId: node.nodeId });
      // Calculate center of the first quad (content box)
      const quad = box.model.content;
      const x = (quad[0] + quad[2]) / 2;
      const y = (quad[1] + quad[5]) / 2;
      
      await this.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed", x, y, button: "left", clickCount: 1
      });
      await this.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased", x, y, button: "left", clickCount: 1
      });
      logger.info("cdp", `Simulated physical click on ${selector} at (${x}, ${y})`);
    } catch (err) {
      logger.warn("cdp", `simulateClick failed for ${selector}`, { error: String(err) });
    }
  }

  public async simulateType(selector: string, text: string): Promise<void> {
    try {
      await this.simulateClick(selector); // Focus the element first
      for (const char of text) {
        await this.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
          type: "char", text: char
        });
        await new Promise(r => setTimeout(r, 50)); // typing delay
      }
      // Press Enter to confirm if it's a date picker
      await this.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: "rawKeyDown", windowsVirtualKeyCode: 13, key: "Enter"
      });
      await this.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp", windowsVirtualKeyCode: 13, key: "Enter"
      });
      logger.info("cdp", `Simulated typing into ${selector}`);
    } catch (err) {
      logger.warn("cdp", `simulateType failed for ${selector}`, { error: String(err) });
    }
  }

  public async enableFetchInterceptor(
    urlPatterns: string[],
    onIntercept: (url: string, postData: string | undefined, resolve: (modifiedData?: string) => void) => void
  ): Promise<void> {
    try {
      this.attach();

      await this.webContents.debugger.sendCommand("Fetch.enable", {
        patterns: urlPatterns.map(pattern => ({ urlPattern: pattern, requestStage: "Request" }))
      });

      this.webContents.debugger.on("message", (event, method, params) => {
        if (method === "Fetch.requestPaused") {
          const { requestId, request } = params as any;
          const url = request.url;
          const postData = request.postData;

          logger.info("cdp", `Intercepted request to ${url}`);

          // Callback to allow modification
          onIntercept(url, postData, async (modifiedData?: string) => {
            try {
              if (modifiedData) {
                // If modified, we must base64 encode the new payload
                const base64Data = Buffer.from(modifiedData).toString("base64");
                await this.webContents.debugger.sendCommand("Fetch.continueRequest", {
                  requestId,
                  postData: base64Data
                });
                logger.info("cdp", `Request continued with modified payload for ${url}`);
              } else {
                await this.webContents.debugger.sendCommand("Fetch.continueRequest", { requestId });
              }
            } catch (err) {
              logger.error("cdp", "Failed to continue request", { error: String(err) });
            }
          });
        }
      });

      logger.info("cdp", "Fetch interceptor enabled for patterns", { patterns: urlPatterns });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("cdp", "Failed to enable fetch interceptor", { error: msg });
      throw err;
    }
  }

  public async enableNetworkObserver(onResponse: (url: string, responseBody: string) => void): Promise<void> {
    try {
      this.attach();
      await this.webContents.debugger.sendCommand("Network.enable");

      this.webContents.debugger.on("message", async (event, method, params) => {
        if (method === "Network.responseReceived") {
          const { requestId, response } = params as any;
          const url = response.url;

          // Check if it's an XHR or Fetch request that we might care about
          if (response.type === "XHR" || response.type === "Fetch") {
            try {
              const bodyResult = await this.webContents.debugger.sendCommand("Network.getResponseBody", { requestId });
              if (bodyResult && bodyResult.body) {
                onResponse(url, bodyResult.body as string);
              }
            } catch (ignore) {
              // Ignore requests that have no body or fail to get body
            }
          }
        }
      });
      logger.info("cdp", "Network observer enabled");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("cdp", "Failed to enable network observer", { error: msg });
      throw err;
    }
  }
}

