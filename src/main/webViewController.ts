import { BrowserView, BrowserWindow } from "electron";
import type {
  BrowserBounds,
  LinkInfo,
  PageState,
  ScrollScanOptions,
  ScrollScanState,
  SessionSummary,
  FormSyncPayload,
  VideoScanResult
} from "../shared/types";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { logger, safeUrl } from "./logger";
import { getScrollMetrics, scanVideoCandidates, scrollPage } from "./mediaScanner";
import { normalizeNavigationUrl } from "./navigation";
import { CDPHelper } from "./uploader/cdpHelper";

const DEFAULT_URL = "https://example.com";
const SESSION_PARTITION = "persist:crawl-web-electron";
const DEFAULT_SCROLL_OPTIONS = {
  intervalMs: 1200,
  maxRounds: 12
};

function clampBounds(bounds: BrowserBounds): BrowserBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  };
}

function linkLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(500, Math.round(limit)));
}

export class WebViewController {
  private readonly view: BrowserView;
  private isLoading = false;
  private scanState: ScrollScanState = {
    status: "idle",
    round: 0,
    maxRounds: 0,
    reason: "Ready"
  };
  private scanRunId = 0;
  private lastScrollOptions: Required<ScrollScanOptions> = DEFAULT_SCROLL_OPTIONS;

  constructor(private readonly window: BrowserWindow) {
    this.view = new BrowserView({
      webPreferences: {
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    this.window.setBrowserView(this.view);
    this.view.setAutoResize({ width: false, height: false });

    // Anti-Detection: Remove Electron signature
    const session = this.view.webContents.session;
    const defaultUA = session.getUserAgent();
    const safeUA = defaultUA.replace(/Electron\/[\d.]+ /g, "").replace(/crawl-web-electron\/[\d.]+ /g, "");
    session.setUserAgent(safeUA);

    this.configureWebContents();

    logger.info("browser-view", "created", { partition: SESSION_PARTITION });
    void this.navigate(DEFAULT_URL).catch((error: Error) => {
      logger.error("browser-view", "failed to load default page", { error: error.message });
    });
  }

  setBounds(bounds: BrowserBounds): void {
    const safeBounds = clampBounds(bounds);
    this.view.setBounds(safeBounds);
  }

  getState(): PageState {
    const webContents = this.view.webContents;

    return {
      url: webContents.getURL(),
      title: webContents.getTitle(),
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      isLoading: this.isLoading
    };
  }

  getSessionSummary(): SessionSummary {
    return {
      partition: SESSION_PARTITION,
      persistent: true,
      storage: "Chromium/Electron profile data: cookies, localStorage, IndexedDB and cache.",
      locationHint: "System application data directory; not stored in this Git repository."
    };
  }

  async navigate(input: string): Promise<PageState> {
    const url = normalizeNavigationUrl(input);
    logger.info("browser-view", "navigate", { url });
    await this.view.webContents.loadURL(url);
    return this.getState();
  }

  goBack(): PageState {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      logger.info("browser-view", "go back");
      this.view.webContents.navigationHistory.goBack();
    }

    return this.getState();
  }

  goForward(): PageState {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      logger.info("browser-view", "go forward");
      this.view.webContents.navigationHistory.goForward();
    }

    return this.getState();
  }

  reload(): PageState {
    logger.info("browser-view", "reload", { url: this.view.webContents.getURL() });
    this.view.webContents.reload();
    return this.getState();
  }

  async getCookies(filter: Electron.CookiesGetFilter = {}): Promise<Electron.Cookie[]> {
    logger.info("browser-view", "get-cookies", filter as Record<string, unknown>);
    return this.view.webContents.session.cookies.get(filter);
  }

  async executeJavaScript(code: string): Promise<unknown> {
    logger.info("browser-view", "execute-js", { codeLength: code.length });
    return this.view.webContents.executeJavaScript(code);
  }

  getUrl(): string {
    return this.view.webContents.getURL();
  }

  getTitle(): string {
    return this.view.webContents.getTitle();
  }

  async extractLinks(limit?: number): Promise<LinkInfo[]> {
    const safeLimit = linkLimit(limit);
    logger.info("browser-view", "extract links", { limit: safeLimit, url: this.getUrl() });

    const script = `
      (() => Array
        .from(document.querySelectorAll("a[href]"))
        .slice(0, ${safeLimit})
        .map((anchor) => {
          const label = anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || anchor.href;
          return {
            text: String(label || "").trim().replace(/\\s+/g, " ").slice(0, 160),
            href: anchor.href
          };
        }))()
    `;

    try {
      const result = await this.view.webContents.executeJavaScript(script, true);

      if (!Array.isArray(result)) {
        return [];
      }

      return result
        .filter((item): item is LinkInfo => Boolean(item && typeof item.text === "string" && typeof item.href === "string"))
        .slice(0, safeLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("browser-view", "extract links failed", { error: message, url: this.getUrl() });
      throw error;
    }
  }

  async scanCurrentPage(): Promise<VideoScanResult> {
    logger.info("media", "scan current page", { url: this.getUrl() });

    try {
      const result = await scanVideoCandidates(this.view.webContents);
      logger.info("media", "scan completed", {
        url: result.sourcePageUrl,
        candidates: result.candidates.length,
        duplicates: result.duplicateHintCount,
        manualActionDetected: result.manualActionDetected
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("media", "scan failed", { error: message, url: this.getUrl() });
      throw error;
    }
  }

  async mountVideo(filePath: string): Promise<void> {
    const cdp = new CDPHelper(this.view.webContents);
    try {
      cdp.attach();
      await cdp.setFileInputFiles('input[type="file"]', [filePath]);
    } finally {
      cdp.detach();
    }
  }

  async syncForm(payload: FormSyncPayload): Promise<void> {
    const platform = payload.platform;
    logger.info("media", `Form sync received for ${platform}. Triggering real DOM updates...`, { payload });
    this.currentPublishPayload = payload; // Store it for interception

    if (platform === "kuaishou") {
      void this.runKuaishouDiagnostics().catch(() => {});
    }

    // 4. DOM Injection logic
    let script = "";
    if (platform === "kuaishou") {
      script = `
        (async () => {
          try {
            let needEnter = false;
            let cdpTypeAction = null;
            
            // 1. Find Schedule Time (定时发布)
            const radioLabels = Array.from(document.querySelectorAll('label, .radio, .ant-radio-wrapper'));
            let scheduleTime = '${payload.publishTime || ""}';
            
            if (scheduleTime && /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$/.test(scheduleTime)) {
              scheduleTime += ':00'; // Append seconds if missing
            }
            const isValidDate = /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(scheduleTime);

            if (scheduleTime && isValidDate) {
              const scheduleRadio = radioLabels.find(l => l.innerText.includes('定时发布'));
              if (scheduleRadio) scheduleRadio.click();
              
              // Wait for React/Vue to render the time input
              await new Promise(r => setTimeout(r, 1000));
              
              const timeInput = document.querySelector('input[placeholder*="时间"], input[placeholder*="日期"]');
              if (timeInput) {
                timeInput.focus();
                timeInput.click(); // Open picker dropdown
                await new Promise(r => setTimeout(r, 500));
                
                timeInput.removeAttribute('readonly');
                
                // Write native value
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                if (nativeSetter) nativeSetter.call(timeInput, scheduleTime);
                else timeInput.value = scheduleTime;
                
                timeInput.dispatchEvent(new Event('input', { bubbles: true }));
                timeInput.dispatchEvent(new Event('change', { bubbles: true }));

                // Vue component instance injection for reactive state update (highly robust fallback)
                try {
                  let component = null;
                  let curr = timeInput;
                  for (let i = 0; i < 5; i++) {
                    if (curr && curr.__vue__) {
                      component = curr.__vue__;
                      break;
                    }
                    curr = curr ? curr.parentElement : null;
                  }
                  if (component) {
                    component.userInput = scheduleTime;
                    if (typeof component.handleInputChange === 'function') {
                      component.handleInputChange(scheduleTime);
                    } else if (typeof component.handleChange === 'function') {
                      component.handleChange(scheduleTime);
                    }
                    component.$emit('input', scheduleTime);
                    component.$emit('change', scheduleTime);
                  }
                } catch(e) {
                  console.error("Vue component date inject error:", e);
                }

                // Global Vue Form instance state update
                try {
                  const allEls = document.querySelectorAll('*');
                  for (let el of allEls) {
                    if (el.__vue__) {
                      const v = el.__vue__;
                      const formObj = v.form || v.publishForm || v.formData || v.model;
                      if (formObj && (formObj.publishTime !== undefined || formObj.scheduleTime !== undefined || formObj.publishDate !== undefined)) {
                        if (formObj.publishTime !== undefined) formObj.publishTime = scheduleTime;
                        if (formObj.scheduleTime !== undefined) formObj.scheduleTime = scheduleTime;
                        if (formObj.publishDate !== undefined) formObj.publishDate = scheduleTime;
                      }
                    }
                  }
                } catch(e) {}
                
                needEnter = true;

                // Also try clicking Confirm ("确定") button inside Picker panel if it appears
                setTimeout(() => {
                  const confirmBtn = Array.from(document.querySelectorAll('.el-button, .ant-btn-primary, .confirm__btn, button')).find(b => b.innerText && b.innerText.trim() === '确定' && !b.classList.contains('is-disabled') && !b.disabled);
                  if (confirmBtn) {
                    confirmBtn.click();
                  }
                }, 500);
              }
            } else if (!scheduleTime) {
              const nowRadio = radioLabels.find(l => l.innerText.includes('立即发布') || l.innerText.includes('直接发布'));
              if (nowRadio) nowRadio.click();
            }

            // 2. Find and Toggle Local City Switch (作品展示在同城页)
            let localLabel = Array.from(document.querySelectorAll('label.ant-checkbox-wrapper, label.el-checkbox')).find(el => el.innerText && el.innerText.includes('作品展示在同城页'));
            if (!localLabel) {
              // Try expanding "发布设置"
              const pubSettings = Array.from(document.querySelectorAll('span, div, p, button')).find(el => el.innerText && el.innerText.trim() === '发布设置');
              if (pubSettings) {
                pubSettings.click();
                await new Promise(r => setTimeout(r, 400));
              }
              // Try expanding "互动设置"
              const interactSettings = Array.from(document.querySelectorAll('span, div, p, button')).find(el => el.innerText && el.innerText.trim() === '互动设置');
              if (interactSettings) {
                interactSettings.click();
                await new Promise(r => setTimeout(r, 400));
              }
              // Re-search
              localLabel = Array.from(document.querySelectorAll('label.ant-checkbox-wrapper, label.el-checkbox')).find(el => el.innerText && el.innerText.includes('作品展示在同城页'));
            }

            if (localLabel) {
              const input = localLabel.querySelector('input[type="checkbox"]');
              if (input) {
                const localInvisible = ${payload.localInvisible === true};
                const isChecked = input.checked;
                // CORRECTED LOGIC: If we want to hide (localInvisible = true) and it is checked, we click to uncheck.
                // If we want to show (localInvisible = false) and it is unchecked, we click to check.
                if ((localInvisible && isChecked) || (!localInvisible && !isChecked)) {
                  localLabel.click();
                }
              }
            }

            // 3. Find and select Target Playlist/Collection (作品合集) - Proximity Selector Fix
            const targetCollection = '${payload.collection || ""}';
            if (targetCollection) {
              let selectElem = null;
              const allEls = Array.from(document.querySelectorAll('*'));
              let labelIdx = -1;
              
              // 找到最后一个内含“加入合集”文本的叶子节点或特征节点
              for(let i = 0; i < allEls.length; i++) {
                const el = allEls[i];
                if (el.innerText && el.innerText.trim() === '加入合集' && 
                   (!el.children || el.children.length === 0 || el.tagName === 'LABEL' || (el.className && typeof el.className === 'string' && el.className.includes('_label_')))) {
                  labelIdx = i;
                }
              }
              
              // 从这个节点往后按 DOM 顺序遍历，找到的第一个下拉框大概率就是对应的合集选择器
              if (labelIdx !== -1) {
                for(let i = labelIdx + 1; i < allEls.length; i++) {
                  const el = allEls[i];
                  if (el.classList && (el.classList.contains('ant-select-selector') || el.classList.contains('ant-select') || el.classList.contains('el-select') || el.getAttribute('role') === 'combobox')) {
                    selectElem = el;
                    break;
                  }
                }
              }
              
              if (selectElem) {
                selectElem.click(); // Open dropdown
                await new Promise(r => setTimeout(r, 1000)); // Wait for options to render
                
                const optionElements = Array.from(document.querySelectorAll('.ant-select-item-option-content, .ant-select-item-option, .el-select-dropdown__item, .album-list-item, .collection-item'));
                const targetOption = optionElements.find(el => el.innerText && el.innerText.trim() === targetCollection);
                if (targetOption) {
                  targetOption.click();
                } else {
                  // Safe close dropdown if not found
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                }
              }
            }
            
            return { needEnter };
          } catch(e) {
            console.error("Kuaishou sync script error:", e);
            return { error: e.toString() };
          }
        })();
      `;
      const result = await this.view.webContents.executeJavaScript(script);
      if (result && result.needEnter) {
        logger.info("media", "Triggering physical Enter key via CDP...");
        this.view.webContents.focus(); // Focus the BrowserView first to target active input
        const cdp = new CDPHelper(this.view.webContents);
        try {
          cdp.attach();
          await this.view.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
            type: "rawKeyDown", windowsVirtualKeyCode: 13, key: "Enter", code: "Enter"
          });
          await new Promise(r => setTimeout(r, 100));
          await this.view.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp", windowsVirtualKeyCode: 13, key: "Enter", code: "Enter"
          });
        } catch (err) {
          logger.warn("media", "Failed to dispatch Enter key via CDP", { error: String(err) });
        } finally {
          cdp.detach();
        }
      }
      logger.info("media", "Kuaishou React DOM sync completed!", { result });
      return;
    } else if (platform === "douyin") {
      script = `
        (() => {
          try {
            const scheduleTime = '${payload.publishTime || ""}';
            const allRadios = Array.from(document.querySelectorAll('.radio-container, label.radio, label'));
            if (scheduleTime) {
              const scheduleRadio = allRadios.find(l => l.innerText.includes('定时发布'));
              if (scheduleRadio) scheduleRadio.click();
              
              const timeInput = document.querySelector('input[placeholder*="日期"], input[placeholder*="时间"]');
              if (timeInput) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                if (nativeInputValueSetter) nativeInputValueSetter.call(timeInput, scheduleTime);
                timeInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } else {
              const nowRadio = allRadios.find(l => l.innerText.includes('立即发布') || l.innerText.includes('直接发布'));
              if (nowRadio) nowRadio.click();
            }

            const localInvisible = ${payload.localInvisible === true};
            const localSwitch = Array.from(document.querySelectorAll('label, div, span')).find(el => el.innerText && el.innerText.includes('同城') && el.querySelector('input[type="checkbox"], input[type="radio"]'));
            if (localSwitch) {
               const checkbox = localSwitch.querySelector('input');
               if (checkbox) {
                 const isOn = checkbox.checked;
                 if ((localInvisible && isOn) || (!localInvisible && !isOn)) checkbox.click();
               }
            }
          } catch(e) {}
        })();
      `;
    }

    if (script) {
      await this.view.webContents.executeJavaScript(script);
      logger.info("media", `DOM sync script injected for ${platform}`);
    }
  }

  private currentPublishPayload?: FormSyncPayload;

  async submitUpload(platform: string = "douyin"): Promise<void> {
    const cdp = new CDPHelper(this.view.webContents);
    const payload = this.currentPublishPayload;

    if (!payload) {
      logger.warn("media", "No payload found to intercept. Please SYNC DATA first.");
    }

    try {
      // 1. Setup the Fetch Interceptor for the publish API endpoints
      // Note: These URL patterns are examples. You will need to put the exact API endpoints for each platform here.
      const patterns = platform === "douyin" ? ["*://*.douyin.com/*/post/*"] :
                       platform === "kuaishou" ? ["*://*.kuaishou.com/*/publish/*"] :
                       ["*://*/api/publish/*"]; // generic fallback

      await cdp.enableFetchInterceptor(patterns, (url, postData, resolve) => {
        logger.info("media", `Intercepted Publish Request! URL: ${url}`);
        
        if (postData) {
          try {
            // DUMP the payload so the AI can read it!
            const fs = require('fs');
            const path = require('path');
            const dumpPath = path.join(require('os').homedir(), 'kuaishou_payload_dump.json');
            fs.writeFileSync(dumpPath, JSON.stringify({ url, postData: JSON.parse(postData) }, null, 2));
            logger.info("media", `Payload dumped to ${dumpPath}`);
            
            // 2. Parse original payload
            const data = JSON.parse(postData);
            
            // 3. Inject our custom data
            if (payload) {
              data.title = payload.title || data.title;
              data.description = payload.description || data.description;
              if (payload.publishTime) data.schedule_time = payload.publishTime;
              if (payload.collection) data.collection_name = payload.collection;
              if (payload.localInvisible) data.hide_from_local = true;
            }

            // 4. Resolve the request with the heavily modified Payload!
            const modifiedPostData = JSON.stringify(data);
            resolve(modifiedPostData);
          } catch (err) {
            logger.error("media", "Failed to parse/modify publish payload", { error: String(err) });
            resolve(); // let it pass unmodified
          }
        } else {
          resolve();
        }
      });

      // 5. Trigger the website's native Publish button so it fires the XHR request we just intercepted
      let script = "";
      if (platform === "douyin") {
        script = `(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('发布') && !b.innerText.includes('取消')); if (btn) btn.click(); })();`;
      } else if (platform === "bilibili") {
        script = `(() => { const btn = Array.from(document.querySelectorAll('.submit-add, button')).find(b => b.innerText && b.innerText.includes('立即投稿')); if (btn) btn.click(); })();`;
      } else {
        script = `(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('发布') || b.innerText.includes('Publish') || b.innerText.includes('Post'))); if (btn) btn.click(); })();`;
      }
      
      await this.view.webContents.executeJavaScript(script);
      
    } catch (err) {
      logger.error("media", "Failed to setup XHR interceptor", { error: String(err) });
    }
  }

  async getFormContext(platform: string): Promise<{ username: string, avatar: string, playlists: string[], ksDump?: any } | null> {
    try {
      let script = "";
      if (platform === "kuaishou") {
        script = `
          (async () => {
            const nameEl = document.querySelector('.user-name, .name, .user-info span');
            const imgEl = document.querySelector('.avatar img, .user-avatar img');
            
            // Try to find and temporarily open the playlist dropdown to read collection names
            let playlists = [];
            try {
              let selectElem = null;
              const allEls = Array.from(document.querySelectorAll('*'));
              let labelIdx = -1;
              for(let i = 0; i < allEls.length; i++) {
                const el = allEls[i];
                if (el.innerText && el.innerText.trim() === '加入合集' && 
                   (!el.children || el.children.length === 0 || el.tagName === 'LABEL' || (el.className && typeof el.className === 'string' && el.className.includes('_label_')))) {
                  labelIdx = i;
                }
              }
              if (labelIdx !== -1) {
                for(let i = labelIdx + 1; i < allEls.length; i++) {
                  const el = allEls[i];
                  if (el.classList && (el.classList.contains('ant-select-selector') || el.classList.contains('ant-select') || el.classList.contains('el-select') || el.getAttribute('role') === 'combobox')) {
                    selectElem = el;
                    break;
                  }
                }
              }
              
              if (selectElem) {
                selectElem.click(); // Open dropdown
                await new Promise(r => setTimeout(r, 800)); // Wait for render
                
                const optionElements = Array.from(document.querySelectorAll('.ant-select-item-option-content, .ant-select-item-option, .el-select-dropdown__item span, .album-list-item, .collection-item'));
                playlists = Array.from(new Set(optionElements.map(el => el.innerText.trim()).filter(Boolean)));
                
                // Safe close dropdown
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
              }
            } catch (err) {}

            if (playlists.length === 0) {
              const lists = Array.from(document.querySelectorAll('.album-list-item, .collection-item, .el-select-dropdown__item span, .ant-select-item-option-content'));
              playlists = Array.from(new Set(lists.map(el => el.innerText.trim()).filter(Boolean)));
            }
            
            // Vue store fallback dump
            let ksDump = null;
            try {
              const allEls = document.querySelectorAll('*');
              for(let el of allEls) {
                if(el.__vue__) {
                   if (el.__vue__.$store && el.__vue__.$store.state) {
                     ksDump = JSON.parse(JSON.stringify(el.__vue__.$store.state));
                     break;
                   } else if (el.__vue__.form || el.__vue__.publishForm) {
                     ksDump = JSON.parse(JSON.stringify(el.__vue__.form || el.__vue__.publishForm));
                     break;
                   }
                }
              }
            } catch(e) {}

            return {
              username: nameEl ? nameEl.innerText.trim() : 'Unknown User',
              avatar: imgEl ? imgEl.src : '',
              playlists,
              ksDump
            };
          })();
        `;
      } else if (platform === "douyin") {
        script = `
          (() => {
            const nameEl = document.querySelector('.creator-name, .user-name');
            const imgEl = document.querySelector('.creator-avatar img, .avatar img');
            const lists = Array.from(document.querySelectorAll('.collection-item, .select-item, [class*="collection"]'));
            const playlists = Array.from(new Set(lists.map(el => el.innerText.trim()).filter(Boolean)));
            return {
              username: nameEl ? nameEl.innerText.trim() : 'Unknown User',
              avatar: imgEl ? imgEl.src : '',
              playlists
            };
          })();
        `;
      } else {
        script = `
          (() => {
            return { username: 'Unknown User', avatar: '', playlists: [] };
          })();
        `;
      }
      
      const result = await this.view.webContents.executeJavaScript(script);
      return result || null;
    } catch (err) {
      logger.error("media", "Failed to get user info", { error: String(err) });
      return null;
    }
  }

  getScrollScanState(): ScrollScanState {
    return this.scanState;
  }

  startScrollScan(options?: ScrollScanOptions): ScrollScanState {
    if (this.scanState.status === "scanning") {
      logger.warn("media", "scroll scan already running");
      return this.scanState;
    }

    const safeOptions = this.normalizeScrollOptions(options);
    this.lastScrollOptions = safeOptions;
    this.scanRunId += 1;
    this.scanState = {
      status: "scanning",
      round: 0,
      maxRounds: safeOptions.maxRounds,
      reason: "Scanning"
    };

    logger.info("media", "scroll scan started", safeOptions);
    this.emitScanState();
    void this.runScrollScan(this.scanRunId, safeOptions);
    return this.scanState;
  }

  stopScrollScan(reason = "Stopped by user"): ScrollScanState {
    if (this.scanState.status === "idle" || this.scanState.status === "stopped") {
      return this.scanState;
    }

    this.scanRunId += 1;
    this.scanState = {
      ...this.scanState,
      status: "stopped",
      reason
    };
    logger.info("media", "scroll scan stopped", { reason });
    this.emitScanState();
    return this.scanState;
  }

  pauseScrollScan(reason = "Paused for manual action"): ScrollScanState {
    if (this.scanState.status !== "scanning") {
      return this.scanState;
    }

    this.scanRunId += 1;
    this.scanState = {
      ...this.scanState,
      status: "paused",
      reason
    };
    logger.warn("media", "scroll scan paused", { reason });
    this.emitScanState();
    return this.scanState;
  }

  resumeScrollScan(): ScrollScanState {
    if (this.scanState.status !== "paused" && this.scanState.status !== "stopped") {
      return this.scanState;
    }

    logger.info("media", "scroll scan resumed");
    return this.startScrollScan(this.lastScrollOptions);
  }

  destroy(): void {
    this.stopScrollScan("Window closed");

    if (!this.window.isDestroyed()) {
      this.window.removeBrowserView(this.view);
    }

    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close();
    }
  }

  private configureWebContents(): void {
    const webContents = this.view.webContents;

    webContents.setWindowOpenHandler(({ url }) => {
      logger.info("browser-view", "redirecting new window into current view", { url });
      void this.navigate(url).catch((error: Error) => {
        logger.warn("browser-view", "blocked new-window navigation", { error: error.message, url });
      });

      return { action: "deny" };
    });

    webContents.on("did-start-loading", () => {
      this.isLoading = true;
      logger.info("browser-view", "start loading", { url: webContents.getURL() });
      this.emitState();
    });

    webContents.on("did-stop-loading", () => {
      this.isLoading = false;
      logger.info("browser-view", "stop loading", { url: webContents.getURL() });
      this.emitState();
    });

    webContents.on("did-finish-load", () => {
      logger.info("browser-view", "finished load", { url: webContents.getURL(), title: webContents.getTitle() });
      this.emitState();

      if (webContents.getURL().includes("kuaishou.com")) {
        setTimeout(() => {
          this.runKuaishouDiagnostics().catch((err) => {
            logger.error("diag", "failed during did-finish-load", { error: String(err) });
          });
        }, 3000);
      }
    });

    webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) {
        return;
      }

      logger.warn("browser-view", "load failed", {
        errorCode,
        error: errorDescription,
        url: safeUrl(validatedURL)
      });
      this.emitState();
    });

    webContents.on("page-title-updated", () => {
      this.emitState();
    });

    webContents.on("did-navigate", (_event, url) => {
      logger.info("browser-view", "navigated", { url });
      this.emitState();
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      logger.info("browser-view", "in-page navigation", { url });
      this.emitState();
    });
  }

  private normalizeScrollOptions(options?: ScrollScanOptions): Required<ScrollScanOptions> {
    return {
      intervalMs: Math.max(400, Math.min(5000, Math.round(options?.intervalMs || DEFAULT_SCROLL_OPTIONS.intervalMs))),
      maxRounds: Math.max(1, Math.min(50, Math.round(options?.maxRounds || DEFAULT_SCROLL_OPTIONS.maxRounds)))
    };
  }

  private async runScrollScan(runId: number, options: Required<ScrollScanOptions>): Promise<void> {
    let previous = await this.safeScrollMetrics();
    let stableRounds = 0;

    for (let round = 1; round <= options.maxRounds; round += 1) {
      if (runId !== this.scanRunId || this.scanState.status !== "scanning") {
        return;
      }

      this.scanState = {
        ...this.scanState,
        round,
        reason: `Scanning round ${round} of ${options.maxRounds}`
      };
      this.emitScanState();

      try {
        await scrollPage(this.view.webContents);
        await this.sleep(options.intervalMs);
        const result = await this.scanCurrentPage();

        if (!this.window.isDestroyed()) {
          this.window.webContents.send(IPC_CHANNELS.mediaScrollScanUpdate, {
            round,
            state: this.scanState,
            result
          });
        }

        if (result.manualActionDetected) {
          this.pauseScrollScan(result.manualActionReason || "Manual action required");
          return;
        }

        const current = await this.safeScrollMetrics();

        if (previous && current && current.scrollHeight === previous.scrollHeight && current.scrollY === previous.scrollY) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
        }

        previous = current || previous;

        if (stableRounds >= 2) {
          this.stopScrollScan("Page height stopped changing");
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.scanState = {
          ...this.scanState,
          status: "error",
          reason: message
        };
        logger.error("media", "scroll scan failed", { error: message });
        this.emitScanState();
        return;
      }
    }

    if (runId === this.scanRunId && this.scanState.status === "scanning") {
      this.stopScrollScan("Reached maximum scroll rounds");
    }
  }

  private async safeScrollMetrics(): Promise<{ scrollY: number; innerHeight: number; scrollHeight: number } | null> {
    try {
      return await getScrollMetrics(this.view.webContents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("media", "failed to read scroll metrics", { error: message });
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private emitState(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("browser:state-changed", this.getState());
    }
  }

  private emitScanState(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.mediaScanStateChanged, this.scanState);
    }
  }

  private async runKuaishouDiagnostics(): Promise<void> {
    const url = this.view.webContents.getURL();
    if (!url.includes("kuaishou.com")) return;
    
    logger.info("media", "Running automatic Kuaishou DOM diagnostics...");
    try {
      const script = `
        (() => {
          try {
            const dump = {};
            
            // 1. Text elements search
            const textMatches = [];
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const text = el.innerText || el.textContent || '';
              if (text.includes('同城') || text.includes('合集') || text.includes('发布时间') || text.includes('定时发布')) {
                textMatches.push({
                  tagName: el.tagName,
                  className: el.className,
                  id: el.id,
                  innerText: text.substring(0, 100).trim(),
                  childCount: el.children.length,
                  attributes: Array.from(el.attributes).reduce((acc, attr) => {
                    acc[attr.name] = attr.value;
                    return acc;
                  }, {})
                });
              }
            }
            dump.textMatches = textMatches.slice(0, 100);
            
            // 2. Select, Input, Switch components
            const interactive = [];
            const inputs = document.querySelectorAll('input, select, button, [role="switch"], [role="checkbox"], [role="radio"]');
            for (const el of inputs) {
              interactive.push({
                tagName: el.tagName,
                className: el.className,
                id: el.id,
                type: el.type,
                placeholder: el.getAttribute('placeholder'),
                role: el.getAttribute('role'),
                ariaChecked: el.getAttribute('aria-checked'),
                innerText: (el.innerText || el.textContent || '').substring(0, 50).trim(),
                value: el.value,
                attributes: Array.from(el.attributes).reduce((acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                }, {})
              });
            }
            dump.interactive = interactive;
            
            // 3. Class lists and structure of typical components
            dump.antRadioWrappers = Array.from(document.querySelectorAll('.ant-radio-wrapper, label')).map(el => ({
              className: el.className,
              innerText: el.innerText.trim(),
              hasInput: !!el.querySelector('input')
            }));
            
            dump.switches = Array.from(document.querySelectorAll('.ant-switch, [role="switch"]')).map(el => ({
              className: el.className,
              ariaChecked: el.getAttribute('aria-checked'),
              innerText: el.innerText.trim()
            }));

            // 4. Vue store dump if present
            let storeState = null;
            for(let el of allElements) {
              if(el.__vue__) {
                 if (el.__vue__.$store && el.__vue__.$store.state) {
                   storeState = el.__vue__.$store.state;
                   break;
                 }
              }
            }
            dump.hasVueStore = !!storeState;
            
            return dump;
          } catch (e) {
            return { error: String(e) };
          }
        })();
      `;
      const result = await this.view.webContents.executeJavaScript(script);
      const fs = require('fs');
      const path = require('path');
      const dumpPath = path.join(require('os').homedir(), 'kuaishou_dom_dump.json');
      fs.writeFileSync(dumpPath, JSON.stringify(result, null, 2));
      logger.info("media", "DOM diagnostics completed. Dump saved to " + dumpPath);
    } catch (err) {
      logger.error("media", "Failed to run Kuaishou diagnostics", { error: String(err) });
    }
  }
}
